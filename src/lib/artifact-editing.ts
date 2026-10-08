// Shared editing/state hook for an artifact model. Both the single-source
// workbench and the project (multi-canvas) view use this so behaviour stays
// identical across entry points.
//
// Real-time co-editing: when a `collabChannel` is passed, every mutation
// still gets computed by the exact same action functions below (they just
// compute a plain "next model" from a plain "current model", unchanged) --
// only what `mutate()` DOES with that result differs. Instead of calling
// setModel directly, it diffs prev/next into a Yjs document
// (applyModelDiffToYDoc, src/lib/yjs-model.ts), which is what's actually
// synced across peers; a Yjs observer then re-derives the plain model
// (locally-caused or from a remote peer, same code path either way) and
// that's what becomes `model` here. Without collabChannel, this hook
// behaves exactly as it always has -- plain local useState, no Yjs, no
// realtime, zero behavior change for the marketing demo or any other
// caller that doesn't opt in.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  type ArtifactModel, type BaseItem, type BMCBlock, type Connection,
  type Step, type Decision, type NFRCategory,
  type RiskItem, type ChangeRequestItem, type CommunicationPlanItem,
  type TestCaseItem, type StakeholderItem,
  type BusinessCase, type RequirementsManagementPlan,
  type DataStoreItem, type ExternalEntityItem,
  type RuleNode, type StateItem,
} from "@/data/samples";
import { applyProposal, type Proposal } from "@/lib/refine";
import { diffModels } from "@/lib/diff";
import { perturb } from "@/lib/extract";
import { modelToYDoc, yDocToModel, applyModelDiffToYDoc } from "@/lib/yjs-model";
import { connectYjsProvider, type YjsProviderHandle } from "@/lib/yjs-provider";
import { summariseEdit, type EditSummary } from "@/lib/describe-edit";

let uid = 1000;

// The counter above is module-scoped and resets to 1000 on every fresh page
// load. A loaded/persisted model can already contain ids minted by an
// earlier session (e.g. "ST-U1005"), so before generating new ids for a
// model we bump the counter past the highest numeric suffix already present
// — otherwise a reopened project's new shapes collide with its old ones.
function bumpUidPast(model: ArtifactModel) {
  const ids: string[] = [];
  if (model.kind === "process") {
    for (const group of [model.actors, model.steps, model.decisions, model.exceptions, model.systems]) {
      for (const item of group) ids.push(item.id);
    }
    for (const c of model.connections ?? []) ids.push(c.id);
    for (const n of model.nonFunctionalRequirements ?? []) ids.push(n.id);
    for (const n of model.testCases ?? []) ids.push(n.id);
    for (const n of model.dataStores ?? []) ids.push(n.id);
    for (const n of model.externalEntities ?? []) ids.push(n.id);
    for (const n of model.decisionTree ?? []) ids.push(n.id);
    for (const n of model.states ?? []) ids.push(n.id);
  } else {
    for (const b of model.blocks) for (const item of b.items) ids.push(item.id);
    for (const s of model.stakeholders ?? []) ids.push(s.id);
  }
  for (const r of model.riskLog ?? []) ids.push(r.id);
  for (const c of model.changeRequests ?? []) ids.push(c.id);
  for (const c of model.communicationPlan ?? []) ids.push(c.id);
  for (const o of model.businessCase?.options ?? []) ids.push(o.id);
  for (const id of ids) {
    const match = /-U(\d+)$/.exec(id);
    if (match) uid = Math.max(uid, parseInt(match[1], 10));
  }
}

const nextId = (prefix: string) => `${prefix}-U${++uid}`;
const newUserItem = (prefix: string, text: string): BaseItem => ({
  id: nextId(prefix), text, confidence: 1, userAdded: true,
});

interface HistoryEntry {
  model: ArtifactModel;
  drifted: boolean;
  /** Name of the action that made this entry, for the few that are better
   *  named than described item by item (a source re-check). Travels with the
   *  entry as it moves between the undo and redo stacks. */
  label?: string;
}
const HISTORY_CAP = 60;
const MERGE_WINDOW_MS = 1000;

/** The model without the item `id`, wherever it lives, and without any
 *  connection that touched it. Pure; shared by delete and crash recovery. */
function removeById(m: ArtifactModel, id: string): ArtifactModel {
  const shared = {
    riskLog: (m.riskLog ?? []).filter(x => x.id !== id),
    changeRequests: (m.changeRequests ?? []).filter(x => x.id !== id),
    communicationPlan: (m.communicationPlan ?? []).filter(x => x.id !== id),
    businessCase: m.businessCase && { ...m.businessCase, options: (m.businessCase.options ?? []).filter(x => x.id !== id) },
  };
  if (m.kind === "process") {
    return {
      ...m, ...shared,
      actors: m.actors.filter(x => x.id !== id),
      steps: m.steps.filter(x => x.id !== id),
      decisions: m.decisions.filter(x => x.id !== id),
      exceptions: m.exceptions.filter(x => x.id !== id),
      systems: m.systems.filter(x => x.id !== id),
      connections: (m.connections ?? []).filter(c => c.fromId !== id && c.toId !== id),
      nonFunctionalRequirements: (m.nonFunctionalRequirements ?? []).filter(x => x.id !== id),
      testCases: (m.testCases ?? []).filter(x => x.id !== id),
      dataStores: (m.dataStores ?? []).filter(x => x.id !== id),
      externalEntities: (m.externalEntities ?? []).filter(x => x.id !== id),
      decisionTree: (m.decisionTree ?? []).filter(x => x.id !== id),
      states: (m.states ?? []).filter(x => x.id !== id),
    };
  }
  return {
    ...m, ...shared,
    blocks: m.blocks.map(b => ({ ...b, items: b.items.filter(i => i.id !== id) })),
    stakeholders: (m.stakeholders ?? []).filter(x => x.id !== id),
  };
}

/** Undo-merge key for an edit that may be arriving once per keystroke.
 *  Only text does that. A patch carrying anything else -- a list of branches,
 *  a number, a flag -- is a deliberate, separate action each time, and two of
 *  them in the same second (add a branch, add another) must stay two undo
 *  steps, so it gets no key. */
function typingKey(prefix: string, patch: object): string | undefined {
  const entries = Object.entries(patch);
  if (entries.length === 0 || !entries.every(([, v]) => typeof v === "string")) return undefined;
  return `${prefix}:${entries.map(([k]) => k).sort().join(",")}`;
}

/** Structural equality for two models. They are plain JSON by construction
 *  (they round-trip through Postgres jsonb and Yjs), and small -- tens of
 *  items -- so serialising both is cheap and exact enough to decide whether
 *  an edit changed anything. */
function sameModel(a: ArtifactModel, b: ArtifactModel): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

export interface ArtifactEditing {
  model: ArtifactModel;
  drifted: boolean;
  lastAddedId: string | null;
  reset: (m: ArtifactModel) => void;
  onSimulateDrift: () => void;
  onClearDrift: () => void;
  onAddActor: (t: string) => string;
  /** `actorId` is who performs the step. Omitted, it falls back to the
   *  previous step's actor -- callers that can ask the person should pass it
   *  rather than let the model assume. An empty string means "nobody yet",
   *  on purpose. */
  onAddStep: (t: string, shape?: Step["shape"], actorId?: string) => string;
  onAddDecision: (t: string, shape?: Decision["shape"]) => string;
  onAddException: (t: string) => string;
  onAddSystem: (t: string) => string;
  onAddNFR: (category: NFRCategory, t: string) => string;
  onAddBMC: (b: BMCBlock["id"], t: string) => string;
  onAddConnection: (fromId: string, toId: string, label?: string) => string;
  onDeleteConnection: (id: string) => void;
  onUpdateConnection: (id: string, patch: Partial<Connection>) => void;

  // BA artifact suite -- available on both Process and BMC models.
  onAddRisk: (t: string) => string;
  onAddChangeRequest: (t: string) => string;
  onAddCommunicationPlanItem: (t: string) => string;
  /** Process-only: a business model has no steps to write test cases against. */
  onAddTestCase: (t: string) => string;
  /** BMC-only: Process instead enriches Actor directly via onUpdateItem. */
  onAddStakeholder: (t: string) => string;
  onUpdateBusinessCase: (patch: Partial<BusinessCase>) => void;
  onAddBusinessCaseOption: (t: string) => string;
  onUpdateRMP: (patch: Partial<RequirementsManagementPlan>) => void;

  /** DFD -- process-only (a DFD's "process" nodes are just steps). */
  onAddDataStore: (t: string) => string;
  onAddExternalEntity: (t: string) => string;
  onAddRuleNode: (t: string) => string;
  onAddState: (t: string) => string;

  onDeleteAny: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<BaseItem> & Record<string, unknown>) => void;
  onApplyRefinement: (p: Proposal) => void;
  /** Recovery: remove the most recently user-added item (used by canvas
   * error boundary to un-brick a project after a bad shape drop). */
  onRemoveLastAdded: () => void;

  /** Step back / forward through edits to the MODEL: items added, removed,
   *  reworded or re-linked, in any tab of the artifact. One user gesture is
   *  one step, even when it takes several model changes to carry out.
   *  Not covered: where nodes sit on a canvas, their size or stacking (view
   *  state, not part of the model). History is dropped when the model is
   *  replaced wholesale or a collaborator's change arrives, because a
   *  whole-model step taken after that would silently undo their work.
   *  Each returns what the step changed, for the caller to tell the person
   *  (the change is often in another tab or off-screen), or null when there
   *  was nothing to step to. */
  onUndo: () => EditSummary | null;
  onRedo: () => EditSummary | null;
  canUndo: boolean;
  canRedo: boolean;
  /** True from the moment a collaborator's change emptied a history that had
   *  something in it, until the next local edit. Lets the caller explain an
   *  otherwise baffling "nothing to undo" seconds after the person edited. */
  undoClearedByPeer: boolean;
}

export interface CollabOptions {
  /** Unique per canvas -- e.g. `project:{projectId}:{kind}`. Everyone with
   *  the same channel name sees each other's live edits. */
  channelName: string;
}

export function useArtifactEditing(initial: ArtifactModel, collab?: CollabOptions): ArtifactEditing {
  const [model, setModel] = useState<ArtifactModel>(() => { bumpUidPast(initial); return initial; });
  const [drifted, setDrifted] = useState(false);
  const [pristine, setPristine] = useState<ArtifactModel>(initial);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  // Always current, synchronously -- both the plain-state and collab paths
  // need to diff/mutate against the LATEST model, not a stale closure.
  const modelRef = useRef(model);
  useEffect(() => { modelRef.current = model; }, [model]);
  const driftedRef = useRef(drifted);
  useEffect(() => { driftedRef.current = drifted; }, [drifted]);

  // Mirror of lastAddedId for code that must read it without a render
  // (crash recovery below); always set through noteLastAdded.
  const lastAddedIdRef = useRef<string | null>(null);
  const noteLastAdded = (id: string | null) => { lastAddedIdRef.current = id; setLastAddedId(id); };

  // Undo/redo. Every edit already funnels through mutate() below, so history
  // is just the model (plus the one companion flag that travels with it) as
  // it stood before each change. Bounded and in memory. Everything here
  // touches only refs and stable setters, so closures captured on the first
  // render (the collab observer, onRemoveLastAdded) stay correct.
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [undoClearedByPeer, setUndoClearedByPeer] = useState(false);
  const syncHistorySize = () => {
    const { past, future } = historyRef.current;
    setHistorySize((cur) => (cur.past === past.length && cur.future === future.length
      ? cur : { past: past.length, future: future.length }));
  };
  // One click is often several model changes: dropping a class shape adds the
  // node then seeds its sections; the starter flow is five calls; adding a
  // decision-tree branch is two. Those all run inside one event handler, so
  // a flag that stays up until the current task's microtasks run groups them
  // under the single "before" snapshot taken by the first.
  const gestureOpenRef = useRef(false);
  // A field that writes on every keystroke would otherwise spend the whole
  // history on one label. Repeat edits to the same target within a second
  // extend the entry already there.
  const lastMergeRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });
  const clearHistory = () => {
    historyRef.current = { past: [], future: [] };
    lastMergeRef.current = { key: null, at: 0 };
    syncHistorySize();
  };
  const recordHistory = (before: ArtifactModel, mergeKey?: string, label?: string) => {
    const now = Date.now();
    const merging = mergeKey != null && mergeKey === lastMergeRef.current.key
      && now - lastMergeRef.current.at < MERGE_WINDOW_MS;
    lastMergeRef.current = { key: mergeKey ?? null, at: now };
    if (gestureOpenRef.current) return;
    // Opened whether or not this change earns its own entry: a keystroke that
    // folds into the previous entry can still be the first of several changes
    // made by one handler, and the rest belong to that same entry too.
    gestureOpenRef.current = true;
    queueMicrotask(() => { gestureOpenRef.current = false; });
    if (merging) return;
    const h = historyRef.current;
    h.past.push({ model: before, drifted: driftedRef.current, label });
    setUndoClearedByPeer(false);
    if (h.past.length > HISTORY_CAP) h.past.shift();
    h.future = [];
    syncHistorySize();
  };

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<YjsProviderHandle | null>(null);

  useEffect(() => {
    if (!collab) return;
    const ydoc = modelToYDoc(modelRef.current);
    ydocRef.current = ydoc;

    const applyFromDoc = (_events: unknown, transaction: Y.Transaction) => {
      const next = yDocToModel(ydoc);
      modelRef.current = next;
      setModel(next);
      // A history entry is a whole model. Stepping to one after someone
      // else's edit has landed would take their change out along with ours,
      // so their arrival ends the undoable run.
      if (!transaction.local) {
        const h = historyRef.current;
        if (h.past.length > 0 || h.future.length > 0) setUndoClearedByPeer(true);
        clearHistory();
      }
    };
    ydoc.getMap("root").observeDeep(applyFromDoc);
    providerRef.current = connectYjsProvider(ydoc, collab.channelName);

    return () => {
      ydoc.getMap("root").unobserveDeep(applyFromDoc);
      providerRef.current?.destroy();
      providerRef.current = null;
      ydocRef.current = null;
    };
    // Only (re)connect if the channel itself changes -- not on every model
    // update, which would tear down and recreate the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab?.channelName]);

  /** Puts `next` in place of `current` by whichever path this hook is on. */
  const applyModel = (current: ArtifactModel, next: ArtifactModel) => {
    if (collab && ydocRef.current) {
      // Patches the Y.Doc; the observer above derives the new plain model
      // and calls setModel -- local edits and remote peer edits both flow
      // through that one path, so they can never disagree with each other.
      applyModelDiffToYDoc(ydocRef.current, current, next);
    } else {
      modelRef.current = next;
      setModel(next);
    }
  };

  const mutate = (
    fn: (m: ArtifactModel) => ArtifactModel,
    opts?: { mergeKey?: string; record?: boolean; label?: string },
  ) => {
    const current = modelRef.current;
    const next = fn(current);
    if (next === current) return;
    // Recorded on BOTH paths: the real project page always runs on the
    // shared document, so history that only worked without it would only
    // ever have worked in the demo. Most actions rebuild the model object
    // even when nothing changed (deleting an id that is not there, re-saving
    // the same text); only a real difference earns an entry, or Undo would
    // sometimes visibly do nothing.
    if (opts?.record !== false && !sameModel(current, next)) recordHistory(current, opts?.mergeKey, opts?.label);
    applyModel(current, next);
  };

  const stepHistory = (from: "past" | "future"): EditSummary | null => {
    const h = historyRef.current;
    const entry = h[from].pop();
    if (!entry) return null;
    const current = modelRef.current;
    const summary: EditSummary = { ...summariseEdit(current, entry.model), label: entry.label };
    h[from === "past" ? "future" : "past"].push({ model: current, drifted: driftedRef.current, label: entry.label });
    lastMergeRef.current = { key: null, at: 0 };
    // Through the same door as any other edit, so state, autosave and (on a
    // project) the shared document all see an ordinary local change.
    applyModel(current, entry.model);
    driftedRef.current = entry.drifted;
    setDrifted(entry.drifted);
    // The "last added" pointer exists so the canvas error boundary can pull
    // out a shape that crashed rendering. After travelling through history
    // it may name something that no longer exists, or the wrong thing.
    noteLastAdded(null);
    syncHistorySize();
    return summary;
  };
  const onUndo = () => stepHistory("past");
  const onRedo = () => stepHistory("future");

  const reset = useCallback((m: ArtifactModel) => {
    bumpUidPast(m);
    modelRef.current = m;
    clearHistory();
    setUndoClearedByPeer(false);
    noteLastAdded(null);
    setModel(m); setPristine(m); setDrifted(false);
    if (collab && ydocRef.current) {
      // Not exercised on the real collaborative project page today (only
      // the single-source demo calls reset, which never passes `collab`),
      // but kept correct rather than silently broken for any future caller.
      applyModelDiffToYDoc(ydocRef.current, yDocToModel(ydocRef.current), m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab]);

  // Re-checking the source: run the same deterministic extractor again
  // (index 1, same source position but a fresh look), then diff the result
  // against the pristine baseline for real -- not a hardcoded set of ids.
  const onSimulateDrift = () => {
    mutate(() => diffModels(pristine, perturb(pristine, 1)), { label: "simulated source change" });
    setDrifted(true);
  };
  const onClearDrift = () => { mutate(() => pristine, { label: "source restore" }); setDrifted(false); };

  const onDeleteAny = (id: string) => mutate((m) => removeById(m, id));

  const onUpdateItem = (id: string, patch: Partial<BaseItem> & Record<string, unknown>) => mutate(m => {
    const apply = <T extends BaseItem>(i: T): T => {
      if (i.id !== id) return i;
      const merged = { ...i, ...patch } as T;
      if (Object.prototype.hasOwnProperty.call(patch, "text")) {
        (merged as BaseItem).userAdded = true;
        (merged as BaseItem).confidence = 1;
        (merged as BaseItem).drift = false;
        (merged as BaseItem).conflict = false;
      }
      return merged;
    };
    const shared = {
      riskLog: (m.riskLog ?? []).map(apply),
      changeRequests: (m.changeRequests ?? []).map(apply),
      communicationPlan: (m.communicationPlan ?? []).map(apply),
      businessCase: m.businessCase && { ...m.businessCase, options: (m.businessCase.options ?? []).map(apply) },
    };
    if (m.kind === "process") {
      return {
        ...m, ...shared,
        actors: m.actors.map(apply),
        steps: m.steps.map(apply),
        decisions: m.decisions.map(apply),
        exceptions: m.exceptions.map(apply),
        systems: m.systems.map(apply),
        nonFunctionalRequirements: (m.nonFunctionalRequirements ?? []).map(apply),
        testCases: (m.testCases ?? []).map(apply),
        dataStores: (m.dataStores ?? []).map(apply),
        externalEntities: (m.externalEntities ?? []).map(apply),
        decisionTree: (m.decisionTree ?? []).map(apply),
        states: (m.states ?? []).map(apply),
      };
    }
    return {
      ...m, ...shared,
      blocks: m.blocks.map(b => ({ ...b, items: b.items.map(apply) })),
      stakeholders: (m.stakeholders ?? []).map(apply),
    };
  }, { mergeKey: typingKey(`item:${id}`, patch) });

  const addWithId = (mk: () => { id: string; run: (m: ArtifactModel) => ArtifactModel }) => {
    const { id, run } = mk();
    mutate(run);
    noteLastAdded(id);
    return id;
  };

  const onRemoveLastAdded = useCallback(() => {
    const id = lastAddedIdRef.current;
    if (!id) return;
    // Recovery, not an edit: it must not become something Undo can reverse
    // (that would put the shape that crashed the canvas straight back), and
    // the history leading up to it may contain that same shape, so it goes.
    mutate((m) => removeById(m, id), { record: false });
    clearHistory();
    noteLastAdded(null);
    // Stable identity for the error boundary; everything reached from here
    // reads refs and stable setters only, so the first render's closures hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAddActor = (t: string) => addWithId(() => {
    const item = newUserItem("AC", t);
    return { id: item.id, run: (m) => m.kind === "process" ? { ...m, actors: [...m.actors, item] } : m };
  });
  const onAddStep = (t: string, shape?: Step["shape"], actorId?: string) => addWithId(() => {
    const item = newUserItem("ST", t);
    return { id: item.id, run: (m) => {
      if (m.kind !== "process") return m;
      // An explicit choice wins when it names a real actor. Otherwise carry
      // on with whoever did the previous step -- a new step far more often
      // continues that person's work than it belongs to whichever actor
      // happens to be first in the list, which is what this used to assume.
      const chosen = actorId !== undefined && (actorId === "" || m.actors.some((a) => a.id === actorId))
        ? actorId : undefined;
      const previous = m.steps.at(-1)?.actorId;
      const fallback = previous && m.actors.some((a) => a.id === previous) ? previous : m.actors[0]?.id;
      // With no actors at all the step is honestly unowned. This used to store
      // the literal "AC1", which names nobody in any real project (real ids
      // look like s0-AC1 or AC-U1001) and only looked like an assignment.
      return { ...m, steps: [...m.steps, { ...item, actorId: chosen ?? fallback ?? "", shape }] };
    } };
  });
  const onAddDecision = (t: string, shape?: Decision["shape"]) => addWithId(() => {
    const item = newUserItem("DC", t);
    const branches = [
      { id: nextId("BR"), label: "Yes", targetId: "—" },
      { id: nextId("BR"), label: "No", targetId: "—" },
    ];
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, decisions: [...m.decisions, { ...item, afterStepId: m.steps.at(-1)?.id ?? "ST1", branches, shape }] } : m };
  });
  const onAddException = (t: string) => addWithId(() => {
    const item = newUserItem("EX", t);
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, exceptions: [...m.exceptions, { ...item }] } : m };
  });
  const onAddSystem = (t: string) => addWithId(() => {
    const item = newUserItem("SY", t);
    return { id: item.id, run: (m) => m.kind === "process" ? { ...m, systems: [...m.systems, item] } : m };
  });
  const onAddNFR = (category: NFRCategory, t: string) => addWithId(() => {
    const item = { ...newUserItem("NFR", t), category };
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, nonFunctionalRequirements: [...(m.nonFunctionalRequirements ?? []), item] } : m };
  });
  const onAddBMC = (bid: BMCBlock["id"], t: string) => addWithId(() => {
    const item = newUserItem(bid.slice(0, 2).toUpperCase(), t);
    return { id: item.id, run: (m) => m.kind === "bmc"
      ? { ...m, blocks: m.blocks.map(b => b.id === bid ? { ...b, items: [...b.items, item] } : b) } : m };
  });

  // BA artifact suite -- riskLog/changeRequests/communicationPlan/businessCase
  // are declared on both ProcessModel and BMCModel with the same shape, so
  // these actions don't need to branch on kind at all.
  const onAddRisk = (t: string) => addWithId(() => {
    const item: RiskItem = { ...newUserItem("RI", t), probability: "Medium", impact: "Medium", response: "Mitigate", status: "Open" };
    return { id: item.id, run: (m) => ({ ...m, riskLog: [...(m.riskLog ?? []), item] }) };
  });
  const onAddChangeRequest = (t: string) => addWithId(() => {
    const item: ChangeRequestItem = { ...newUserItem("CR", t), changeType: "Modification", rationale: "", disposition: "Pending" };
    return { id: item.id, run: (m) => ({ ...m, changeRequests: [...(m.changeRequests ?? []), item] }) };
  });
  const onAddCommunicationPlanItem = (t: string) => addWithId(() => {
    const item: CommunicationPlanItem = { ...newUserItem("CP", t), audience: "", method: "", frequency: "" };
    return { id: item.id, run: (m) => ({ ...m, communicationPlan: [...(m.communicationPlan ?? []), item] }) };
  });
  const onAddTestCase = (t: string) => addWithId(() => {
    const item: TestCaseItem = { ...newUserItem("TC", t), expectedResult: "", priority: "Medium", status: "Not Run" };
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, testCases: [...(m.testCases ?? []), item] } : m };
  });
  const onAddStakeholder = (t: string) => addWithId(() => {
    const item: StakeholderItem = { ...newUserItem("SH", t), influence: "Medium", interest: "Medium" };
    return { id: item.id, run: (m) => m.kind === "bmc"
      ? { ...m, stakeholders: [...(m.stakeholders ?? []), item] } : m };
  });
  const onUpdateBusinessCase = (patch: Partial<BusinessCase>) =>
    mutate(m => ({ ...m, businessCase: { ...m.businessCase, ...patch } }),
      { mergeKey: typingKey("bc", patch) });
  const onAddBusinessCaseOption = (t: string) => addWithId(() => {
    const item = newUserItem("OPT", t);
    return { id: item.id, run: (m) => ({
      ...m,
      businessCase: { ...m.businessCase, options: [...(m.businessCase?.options ?? []), item] },
    }) };
  });
  const onUpdateRMP = (patch: Partial<RequirementsManagementPlan>) =>
    mutate(m => ({ ...m, requirementsManagementPlan: { ...m.requirementsManagementPlan, ...patch } }),
      { mergeKey: typingKey("rmp", patch) });

  const onAddDataStore = (t: string) => addWithId(() => {
    const item: DataStoreItem = newUserItem("DS", t);
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, dataStores: [...(m.dataStores ?? []), item] } : m };
  });
  const onAddExternalEntity = (t: string) => addWithId(() => {
    const item: ExternalEntityItem = newUserItem("EE", t);
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, externalEntities: [...(m.externalEntities ?? []), item] } : m };
  });
  const onAddRuleNode = (t: string) => addWithId(() => {
    const item: RuleNode = newUserItem("RN", t);
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, decisionTree: [...(m.decisionTree ?? []), item] } : m };
  });
  const onAddState = (t: string) => addWithId(() => {
    const item: StateItem = newUserItem("SD", t);
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, states: [...(m.states ?? []), item] } : m };
  });

  const onAddConnection = (fromId: string, toId: string, label?: string) => {
    const id = nextId("CN");
    const conn: Connection = { id, fromId, toId, label, userAdded: true };
    mutate(m => m.kind === "process"
      ? { ...m, connections: [...(m.connections ?? []), conn] } : m);
    return id;
  };
  const onDeleteConnection = (id: string) => mutate(m => m.kind === "process"
    ? { ...m, connections: (m.connections ?? []).filter(c => c.id !== id) } : m);
  const onUpdateConnection = (id: string, patch: Partial<Connection>) => mutate(m => m.kind === "process"
    ? { ...m, connections: (m.connections ?? []).map(c => c.id === id ? { ...c, ...patch } : c) } : m,
    { mergeKey: typingKey(`conn:${id}`, patch) });

  const onApplyRefinement = (p: Proposal) =>
    mutate(m => (m.kind === "process" ? applyProposal(p, m) : m));

  return {
    model, drifted, lastAddedId, reset,
    onSimulateDrift, onClearDrift,
    onAddActor, onAddStep, onAddDecision, onAddException, onAddSystem, onAddBMC, onAddNFR,
    onAddConnection, onDeleteConnection, onUpdateConnection,
    onAddRisk, onAddChangeRequest, onAddCommunicationPlanItem, onAddTestCase, onAddStakeholder,
    onUpdateBusinessCase, onAddBusinessCaseOption, onUpdateRMP,
    onAddDataStore, onAddExternalEntity, onAddRuleNode, onAddState,
    onDeleteAny, onUpdateItem, onApplyRefinement,
    onRemoveLastAdded,
    onUndo, onRedo,
    canUndo: historySize.past > 0,
    canRedo: historySize.future > 0,
    undoClearedByPeer,
  };
}

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

export interface ArtifactEditing {
  model: ArtifactModel;
  drifted: boolean;
  lastAddedId: string | null;
  reset: (m: ArtifactModel) => void;
  onSimulateDrift: () => void;
  onClearDrift: () => void;
  onAddActor: (t: string) => string;
  onAddStep: (t: string) => string;
  onAddDecision: (t: string) => string;
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

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<YjsProviderHandle | null>(null);

  useEffect(() => {
    if (!collab) return;
    const ydoc = modelToYDoc(modelRef.current);
    ydocRef.current = ydoc;

    const applyFromDoc = () => {
      const next = yDocToModel(ydoc);
      modelRef.current = next;
      setModel(next);
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

  const mutate = (fn: (m: ArtifactModel) => ArtifactModel) => {
    const current = modelRef.current;
    const next = fn(current);
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

  const reset = useCallback((m: ArtifactModel) => {
    bumpUidPast(m);
    modelRef.current = m;
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
    mutate(() => diffModels(pristine, perturb(pristine, 1)));
    setDrifted(true);
  };
  const onClearDrift = () => { mutate(() => pristine); setDrifted(false); };

  const onDeleteAny = (id: string) => mutate(m => {
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
  });

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
  });

  const addWithId = (mk: () => { id: string; run: (m: ArtifactModel) => ArtifactModel }) => {
    const { id, run } = mk();
    mutate(run);
    setLastAddedId(id);
    return id;
  };

  const onRemoveLastAdded = useCallback(() => {
    setLastAddedId(id => {
      if (!id) return null;
      // Mirrors onDeleteAny's model-shape-aware removal (hand-duplicated,
      // not a call to it, to keep this a pure setter callback).
      mutate(m => {
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
      });
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAddActor = (t: string) => addWithId(() => {
    const item = newUserItem("AC", t);
    return { id: item.id, run: (m) => m.kind === "process" ? { ...m, actors: [...m.actors, item] } : m };
  });
  const onAddStep = (t: string, shape?: Step["shape"]) => addWithId(() => {
    const item = newUserItem("ST", t);
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, steps: [...m.steps, { ...item, actorId: m.actors[0]?.id ?? "AC1", shape }] } : m };
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
    const item: TestCaseItem = { ...newUserItem("TC", t), expectedResult: "", status: "Not Run" };
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, testCases: [...(m.testCases ?? []), item] } : m };
  });
  const onAddStakeholder = (t: string) => addWithId(() => {
    const item: StakeholderItem = { ...newUserItem("SH", t), influence: "Medium", interest: "Medium" };
    return { id: item.id, run: (m) => m.kind === "bmc"
      ? { ...m, stakeholders: [...(m.stakeholders ?? []), item] } : m };
  });
  const onUpdateBusinessCase = (patch: Partial<BusinessCase>) =>
    mutate(m => ({ ...m, businessCase: { ...m.businessCase, ...patch } }));
  const onAddBusinessCaseOption = (t: string) => addWithId(() => {
    const item = newUserItem("OPT", t);
    return { id: item.id, run: (m) => ({
      ...m,
      businessCase: { ...m.businessCase, options: [...(m.businessCase?.options ?? []), item] },
    }) };
  });
  const onUpdateRMP = (patch: Partial<RequirementsManagementPlan>) =>
    mutate(m => ({ ...m, requirementsManagementPlan: { ...m.requirementsManagementPlan, ...patch } }));

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
    ? { ...m, connections: (m.connections ?? []).map(c => c.id === id ? { ...c, ...patch } : c) } : m);

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
  };
}

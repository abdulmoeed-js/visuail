// Shared editing/state hook for an artifact model. Both the single-source
// workbench and the project (multi-canvas) view use this so behaviour stays
// identical across entry points.
//
// On a saved project (`collab` passed): one browser edits an artifact at a
// time, the others view. Every mutation is still computed by the same action
// functions below; on this path the result goes through a local Yjs document
// (applyModelDiffToYDoc, src/lib/yjs-model.ts) and an observer derives the
// plain model that becomes `model`. The editor's browser then sends that
// model over the artifact channel (src/lib/artifact-channel.ts); a viewer's
// browser adopts what it receives and refuses its own edits, telling the
// caller so it can say who is editing. Who is editor and who is viewer is
// decided by the project page from presence. Without `collab` (the landing
// demo, the share page) this hook is plain local state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  type ArtifactModel, type BaseItem, type BMCBlock, type Connection,
  type Step, type Decision, type NFRCategory,
  type RiskItem, type ChangeRequestItem, type CommunicationPlanItem,
  type TestCaseItem, type StakeholderItem,
  type BusinessCase, type RequirementsManagementPlan,
  type DataStoreItem, type ExternalEntityItem,
  type RuleNode, type StateItem, type ViewId, type NodeLayout,
} from "@/data/samples";
import { applyProposal, type Proposal } from "@/lib/refine";
import { diffModels } from "@/lib/diff";
import { perturb } from "@/lib/extract";
import { modelToYDoc, yDocToModel, applyModelDiffToYDoc } from "@/lib/yjs-model";
import { connectArtifactChannel, editorOf, type ArtifactChannelHandle, type Here, type Peer } from "@/lib/artifact-channel";
import { summariseEdit, type EditSummary } from "@/lib/describe-edit";
import { MODEL_SCHEMA, isOutdated, noteSchema, schemaOf, useOutdated } from "@/lib/model-schema";
import { removeById } from "@/lib/remove-item";
import { SAVE_LAYOUTS, clearLayout, placeShapes, setBlockHeight } from "@/lib/canvas/layout";
import { pasteShapes, type ShapeClip } from "@/lib/canvas/clipboard";

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
  // Saved positions may name an item that is gone (removed by a re-check or
  // a merge); a new item must never take that id and inherit its place.
  for (const l of model.layouts ?? []) ids.push(...Object.keys(l.nodes));
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

/** Undo-merge key for an edit that may be arriving once per keystroke.
 *  Only text does that. A patch carrying anything else -- a list of branches,
 *  a number, a flag -- is a deliberate, separate action each time, and two of
 *  them in the same second (add a branch, add another) must stay two undo
 *  steps, so it gets no key. */
/** Fields set by picking (a person, a system, where a line goes), not by
 *  typing: each pick is its own undo step, however quickly they follow. */
const PICKED_FIELDS = new Set(["actorId", "systemId", "fromId", "toId", "afterStepId", "relatedStepId", "shape", "startMarker", "endMarker"]);

function typingKey(prefix: string, patch: object): string | undefined {
  const entries = Object.entries(patch);
  if (entries.length === 0 || !entries.every(([, v]) => typeof v === "string")) return undefined;
  if (entries.some(([k]) => PICKED_FIELDS.has(k))) return undefined;
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
  /** Adds several lines as one undo step; returns how many were added. */
  onAddConnections: (pairs: [string, string][]) => number;
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
  /** Several at once (a selection), as one undo step. */
  onDeleteMany: (ids: string[]) => void;
  /** Copies (see clipboard.ts) added as new items, moved by (dx, dy) from
   *  where they were copied, as one undo step; their places are saved in
   *  `view` when saving is on (SAVE_LAYOUTS). Returns the new ids and their
   *  places (for a view to draw when saving is off), or null when refused. */
  onPasteShapes: (view: ViewId, clip: ShapeClip, dx: number, dy: number, current: Record<string, NodeLayout>) =>
    { ids: string[]; places: Record<string, NodeLayout> } | null;
  /** Hand-made arrangement (src/lib/canvas/layout.ts). Saves where shapes
   *  were moved or resized to in one diagram, as one undo step; `current`
   *  is where every shape is drawn now, kept the first time the diagram is
   *  arranged so nothing else jumps. True when it was saved. */
  onPlaceShapes: (
    view: ViewId, moved: Record<string, NodeLayout | null>, current: Record<string, NodeLayout>,
    /** Repeats with the same key within a second are one undo step (arrow-key nudges). */
    mergeKey?: string,
  ) => boolean;
  /** Back to the automatic layout for one diagram ("Tidy up"). */
  onTidyUp: (view: ViewId) => boolean;
  /** Business model canvas: one block's height. */
  onSetBlockHeight: (blockId: string, h: number) => boolean;
  /** Before starting something that ends in an edit (a drag): true when
   *  this tab may edit; otherwise says why, once, and returns false, so a
   *  shape never moves under the pointer only to snap back. */
  canEdit: () => boolean;
  onUpdateItem: (id: string, patch: Partial<BaseItem> & Record<string, unknown>) => void;
  onApplyRefinement: (p: Proposal) => void;
  /** Recovery: remove the most recently user-added item (used by canvas
   * error boundary to un-brick a project after a bad shape drop). */
  onRemoveLastAdded: () => void;

  /** Step back / forward through edits to the MODEL: items added, removed,
   *  reworded or re-linked, in any tab of the artifact. One user gesture is
   *  one step, even when it takes several model changes to carry out.
   *  Moves and resizes are covered once they are saved in the model
   *  (SAVE_LAYOUTS, src/lib/canvas/layout.ts); stacking order never is. History is dropped when the model is
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

  /** On a saved project: whether this tab edits the artifact or only views
   *  it (someone else got there first, or took over). Always "editor"
   *  without `collab`. */
  role: EditingRole;
  /** The tab that edits this artifact right now, as far as this tab knows;
   *  null when nobody has it open or there is no `collab`. */
  editor: Peer | null;
  /** Claim the artifact for this tab. The previous editor becomes a viewer. */
  takeOver: () => void;
  /** On a saved project: this page runs an older build than the data or
   *  another tab on it, so it only views until it is reloaded (see
   *  src/lib/model-schema.ts). Always false without `collab`. */
  outdated: boolean;
}

/** Why an edit was refused: another tab is the editor, or this page is
 *  older than the data and has to be reloaded first. */
export type BlockReason = "editing" | "outdated";

export interface CollabOptions {
  /** Unique per artifact -- `project:{projectId}:{paneId}`. Every browser
   *  with that artifact open joins the same channel. */
  channelName: string;
  /** This browser tab, so its own messages are told apart from others'. */
  tabId: string;
  /** True while this tab shows the artifact on screen. Only then does it
   *  take part in "who edits"; a pane kept mounted but hidden only listens. */
  open: boolean;
  me: { userId: string; email: string };
  /** Called each time an edit is refused, with the reason. */
  onBlocked?: (reason: BlockReason) => void;
}

export type EditingRole = "editor" | "viewer";

const HEARTBEAT_MS = 8_000;   // how often an open tab says "here"
const STALE_MS = 30_000;      // silence after which a tab is forgotten
const REPLY_GAP_MS = 2_000;   // how often at most we answer a newcomer's "here"

/** Origin tag on the local Yjs transaction that applies a model received
 *  from the editor, so the observer can tell it from this tab's own edits. */
const PEER_ORIGIN = "peer";

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
  const providerRef = useRef<ArtifactChannelHandle | null>(null);

  // Who has this artifact open, by tab, from their "here" messages.
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [openedAt, setOpenedAt] = useState(0);
  const [claimedAt, setClaimedAt] = useState<number | null>(null);
  const open = !!collab?.open;
  // Built once per change, not per render: `editor` is often this object,
  // and the project page stores it, so a fresh copy on every render made the
  // page re-render forever while an artifact was open (and any dialog opened
  // then tipped it into React's update-depth error).
  const meTabId = collab?.tabId;
  const meUserId = collab?.me.userId;
  const meEmail = collab?.me.email;
  const me: Peer | null = useMemo(
    () => (meTabId !== undefined && open
      ? { tabId: meTabId, userId: meUserId ?? "", email: meEmail ?? "", openedAt, claimedAt, schema: MODEL_SCHEMA, lastSeen: Infinity }
      : null),
    [meTabId, meUserId, meEmail, open, openedAt, claimedAt],
  );
  // A page older than the data never edits it, whoever else is here.
  const outdated = useOutdated() && !!collab;
  const editor = collab ? editorOf(me ? [...Object.values(peers), me] : Object.values(peers)) : null;
  const role: EditingRole = !collab
    || (!outdated && open && editor !== null && editor.tabId === collab.tabId) ? "editor" : "viewer";
  // The channel and observer are set up once; anything that changes per
  // render is read through refs.
  const roleRef = useRef(role);
  const openRef = useRef(open);
  const onBlockedRef = useRef(collab?.onBlocked);
  const hereRef = useRef<Here | null>(null);
  // An out-of-date page stops putting itself forward (no "here", no replies):
  // tabs on its own build that haven't met the newer data would otherwise
  // wait on an editor that refuses every edit.
  hereRef.current = me && !outdated
    ? { tabId: me.tabId, userId: me.userId, email: me.email, openedAt, claimedAt, schema: MODEL_SCHEMA }
    : null;
  /** This tab has changed the artifact since it loaded it. */
  const editedRef = useRef(false);
  // The model this page opened with may come from a newer build. Noted after
  // render, not during it: the flag re-renders every artifact on the page.
  useEffect(() => {
    if (collab) noteSchema(schemaOf(initial));
    // The model the hook was created with; `reset` notes any later one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { roleRef.current = role; openRef.current = open; onBlockedRef.current = collab?.onBlocked; });
  const lastReplyRef = useRef(0);
  const sayHere = (force = false) => {
    const h = hereRef.current;
    if (!h || !providerRef.current) return;
    if (!force && Date.now() - lastReplyRef.current < REPLY_GAP_MS) return;
    lastReplyRef.current = Date.now();
    providerRef.current.here(h);
  };
  const sayHereRef = useRef(sayHere);
  sayHereRef.current = sayHere;

  useEffect(() => {
    if (!collab) return;
    const ydoc = modelToYDoc(modelRef.current);
    ydocRef.current = ydoc;

    const applyFromDoc = (_events: unknown, transaction: Y.Transaction) => {
      const next = yDocToModel(ydoc);
      modelRef.current = next;
      setModel(next);
      if (transaction.origin === PEER_ORIGIN) {
        // The editor's latest arrived. A history entry is a whole model, so
        // stepping to one now would take their work out along with ours.
        const h = historyRef.current;
        if (h.past.length > 0 || h.future.length > 0) setUndoClearedByPeer(true);
        clearHistory();
        noteLastAdded(null);
      } else if (roleRef.current === "editor") {
        providerRef.current?.send(next);
      }
    };
    ydoc.getMap("root").observeDeep(applyFromDoc);
    providerRef.current = connectArtifactChannel(collab.channelName, collab.tabId, {
      onModel: (m, _from, senderSchema) => {
        noteSchema(schemaOf(m));
        noteSchema(senderSchema);
        // A tab on an older build never edits next to this one, so this tab
        // can find itself editor the moment it arrives, while the older tab
        // was still editing. Until this tab has changed anything, the older
        // tab's latest is the artifact: take it in, or this tab's first save
        // would put back the copy it loaded and drop their last edits.
        const fromOlderEditor = senderSchema < MODEL_SCHEMA && !editedRef.current;
        if (roleRef.current !== "viewer" && !fromOlderEditor) return;
        bumpUidPast(m);
        const current = yDocToModel(ydoc);
        // An older build's model lacks the keys only this build knows; keep them.
        const next = senderSchema < MODEL_SCHEMA ? ({ ...current, ...m } as ArtifactModel) : m;
        ydoc.transact(() => applyModelDiffToYDoc(ydoc, current, next), PEER_ORIGIN);
      },
      onSyncRequest: () => {
        if (roleRef.current === "editor") providerRef.current?.send(modelRef.current);
      },
      onHere: (peer) => {
        noteSchema(peer.schema);
        setPeers((cur) => ({ ...cur, [peer.tabId]: { ...peer, lastSeen: Date.now() } }));
        // Answer a newcomer at once, so it learns who is here without
        // waiting for the next heartbeat.
        if (openRef.current) sayHereRef.current();
      },
      onBye: (id) => {
        setPeers((cur) => {
          if (!(id in cur)) return cur;
          const next = { ...cur }; delete next[id]; return next;
        });
      },
      onJoined: () => { if (openRef.current) sayHereRef.current(true); },
    });

    return () => {
      ydoc.getMap("root").unobserveDeep(applyFromDoc);
      providerRef.current?.bye(collab.tabId);
      providerRef.current?.destroy();
      providerRef.current = null;
      ydocRef.current = null;
      setPeers({});
    };
    // Only (re)connect if the channel itself changes -- not on every model
    // update, which would tear down and recreate the whole session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab?.channelName]);

  // Out of date: leave at once rather than when the others stop hearing us.
  useEffect(() => {
    if (collab && outdated) providerRef.current?.bye(collab.tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outdated]);

  // Opening the artifact on screen starts a fresh turn (no earlier claim);
  // leaving it tells the others.
  useEffect(() => {
    if (!collab) return;
    if (open) { setOpenedAt(Date.now()); setClaimedAt(null); }
    else { setClaimedAt(null); providerRef.current?.bye(collab.tabId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While open: say "here" now and every few seconds, and again whenever
  // what we say changes (a claim).
  useEffect(() => {
    if (!collab || !open) return;
    sayHereRef.current(true);
    const t = setInterval(() => sayHereRef.current(true), HEARTBEAT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab?.channelName, open, openedAt, claimedAt]);

  // Forget tabs that have gone quiet (closed without saying bye, lost).
  useEffect(() => {
    if (!collab) return;
    const t = setInterval(() => setPeers((cur) => {
      const now = Date.now();
      const keep = Object.values(cur).filter((p) => now - p.lastSeen <= STALE_MS);
      if (keep.length === Object.keys(cur).length) return cur;
      return Object.fromEntries(keep.map((p) => [p.tabId, p]));
    }), 5_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab?.channelName]);

  // Becoming a viewer: ask the editor for its latest, in case its reply to
  // our first request arrived while we still thought we were the editor.
  useEffect(() => {
    if (!collab || role !== "viewer" || !open) return;
    providerRef.current?.requestSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, open]);

  const takeOver = () => {
    // Later than whatever the current editor holds, whatever its clock says,
    // so a take-over always wins.
    setClaimedAt(Math.max(Date.now(), (editor?.claimedAt ?? editor?.openedAt ?? 0) + 1));
  };

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

  /** Applies an edit; true when something was applied. */
  const mutate = (
    fn: (m: ArtifactModel) => ArtifactModel,
    opts?: { mergeKey?: string; record?: boolean; label?: string },
  ): boolean => {
    // A viewer's edit is refused here, at the one door every edit goes
    // through, and the caller is told why so it can say so. The page-wide
    // flag is read directly: it can be set between renders, before roleRef
    // catches up.
    if (collab && isOutdated()) { onBlockedRef.current?.("outdated"); return false; }
    if (roleRef.current === "viewer") { onBlockedRef.current?.("editing"); return false; }
    const current = modelRef.current;
    const next = fn(current);
    if (next === current) return false;
    // Recorded on BOTH paths: the real project page always runs on the
    // shared document, so history that only worked without it would only
    // ever have worked in the demo. Most actions rebuild the model object
    // even when nothing changed (deleting an id that is not there, re-saving
    // the same text); only a real difference earns an entry, or Undo would
    // sometimes visibly do nothing.
    if (opts?.record !== false && !sameModel(current, next)) recordHistory(current, opts?.mergeKey, opts?.label);
    editedRef.current = true;
    applyModel(current, next);
    return true;
  };

  const stepHistory = (from: "past" | "future"): EditSummary | null => {
    if (collab && isOutdated()) { onBlockedRef.current?.("outdated"); return null; }
    if (roleRef.current === "viewer") { onBlockedRef.current?.("editing"); return null; }
    const h = historyRef.current;
    const entry = h[from].pop();
    if (!entry) return null;
    const current = modelRef.current;
    const summary: EditSummary = { ...summariseEdit(current, entry.model), label: entry.label };
    h[from === "past" ? "future" : "past"].push({ model: current, drifted: driftedRef.current, label: entry.label });
    lastMergeRef.current = { key: null, at: 0 };
    // Through the same door as any other edit, so state, autosave and (on a
    // project) the shared document all see an ordinary local change.
    editedRef.current = true;
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
    if (collab) noteSchema(schemaOf(m));
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
    if (mutate(() => diffModels(pristine, perturb(pristine, 1)), { label: "simulated source change" })) setDrifted(true);
  };
  const onClearDrift = () => { if (mutate(() => pristine, { label: "source restore" })) setDrifted(false); };

  const onDeleteAny = (id: string) => mutate((m) => removeById(m, id));
  const onDeleteMany = (ids: string[]) => mutate((m) => ids.reduce((acc, id) => removeById(acc, id), m));
  const onPasteShapes = (view: ViewId, clip: ShapeClip, dx: number, dy: number, current: Record<string, NodeLayout>) => {
    let out: { ids: string[]; places: Record<string, NodeLayout> } | null = null;
    const ok = mutate((m) => {
      if (m.kind !== "process") return m;
      const pasted = pasteShapes(m, clip, nextId, dx, dy);
      out = { ids: pasted.ids, places: pasted.places };
      return SAVE_LAYOUTS ? placeShapes(pasted.model, view, pasted.places, current) : pasted.model;
    }, { label: clip.duplicate ? "the duplicate" : "the paste" });
    if (!ok || !out) return null;
    noteLastAdded((out as { ids: string[] }).ids.at(-1) ?? null);
    return out;
  };

  const onPlaceShapes = (view: ViewId, moved: Record<string, NodeLayout | null>, current: Record<string, NodeLayout>, mergeKey?: string) =>
    mutate((m) => placeShapes(m, view, moved, current), { label: "the move", mergeKey });
  const onTidyUp = (view: ViewId) => mutate((m) => clearLayout(m, view), { label: "the tidy-up" });
  const onSetBlockHeight = (blockId: string, h: number) =>
    mutate((m) => (m.kind === "bmc" ? setBlockHeight(m, blockId, h) : m), { label: "the resize" });
  const canEdit = () => {
    if (collab && isOutdated()) { onBlockedRef.current?.("outdated"); return false; }
    if (roleRef.current === "viewer") { onBlockedRef.current?.("editing"); return false; }
    return true;
  };

  const onUpdateItem = (id: string, patch: Partial<BaseItem> & Record<string, unknown>) => mutate(m => {
    const apply = <T extends BaseItem>(i: T): T => {
      if (i.id !== id) return i;
      const merged = { ...i, ...patch } as T;
      if (Object.prototype.hasOwnProperty.call(patch, "text")) {
        (merged as BaseItem).userAdded = true;
        (merged as BaseItem).confidence = 1;
        (merged as BaseItem).drift = false;
        (merged as BaseItem).conflict = false;
        // A person wrote this text, so earlier doubts about the extracted
        // wording no longer apply.
        delete (merged as BaseItem).conflictNote;
        delete (merged as BaseItem).unresolved;
        delete (merged as BaseItem).quoteUnverified;
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
    // Refused (a viewer): nothing was added, and callers must not announce
    // or reveal anything. They already treat an empty id as "no item".
    if (!mutate(run)) return "";
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

  // Refused, or nothing to add it to: "" like the add* actions above, so a
  // caller never goes on to treat a line that was not drawn as drawn.
  const onAddConnection = (fromId: string, toId: string, label?: string) => {
    const id = nextId("CN");
    const conn: Connection = { id, fromId, toId, label, userAdded: true };
    return mutate(m => m.kind === "process"
      ? { ...m, connections: [...(m.connections ?? []), conn] } : m) ? id : "";
  };
  const onAddConnections = (pairs: [string, string][]) => {
    const conns: Connection[] = pairs.map(([fromId, toId]) => ({ id: nextId("CN"), fromId, toId, userAdded: true }));
    if (conns.length === 0) return 0;
    return mutate(m => m.kind === "process"
      ? { ...m, connections: [...(m.connections ?? []), ...conns] } : m, { label: `${conns.length} data flow${conns.length === 1 ? "" : "s"}` }) ? conns.length : 0;
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
    onAddConnection, onAddConnections, onDeleteConnection, onUpdateConnection,
    onAddRisk, onAddChangeRequest, onAddCommunicationPlanItem, onAddTestCase, onAddStakeholder,
    onUpdateBusinessCase, onAddBusinessCaseOption, onUpdateRMP,
    onAddDataStore, onAddExternalEntity, onAddRuleNode, onAddState,
    onDeleteAny, onDeleteMany, onPasteShapes, onPlaceShapes, onTidyUp, onSetBlockHeight, canEdit, onUpdateItem, onApplyRefinement,
    onRemoveLastAdded,
    onUndo, onRedo,
    canUndo: historySize.past > 0,
    canRedo: historySize.future > 0,
    undoClearedByPeer,
    role, editor, takeOver, outdated,
  };
}

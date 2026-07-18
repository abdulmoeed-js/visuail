// Shared editing/state hook for an artifact model. Both the single-source
// workbench and the project (multi-canvas) view use this so behaviour stays
// identical across entry points.

import { useCallback, useState } from "react";
import {
  type ArtifactModel, type BaseItem, type BMCBlock, type Connection,
  type Step, type Decision,
} from "@/data/samples";
import { applyProposal, type Proposal } from "@/lib/refine";
import { diffModels } from "@/lib/diff";
import { perturb } from "@/lib/extract";

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
  } else {
    for (const b of model.blocks) for (const item of b.items) ids.push(item.id);
  }
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
  onAddBMC: (b: BMCBlock["id"], t: string) => string;
  onAddConnection: (fromId: string, toId: string, label?: string) => string;
  onDeleteConnection: (id: string) => void;
  onUpdateConnection: (id: string, patch: Partial<Connection>) => void;

  onDeleteAny: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<BaseItem> & Record<string, unknown>) => void;
  onApplyRefinement: (p: Proposal) => void;
  /** Recovery: remove the most recently user-added item (used by canvas
   * error boundary to un-brick a project after a bad shape drop). */
  onRemoveLastAdded: () => void;
}

export function useArtifactEditing(initial: ArtifactModel): ArtifactEditing {
  const [model, setModel] = useState<ArtifactModel>(() => { bumpUidPast(initial); return initial; });
  const [drifted, setDrifted] = useState(false);
  const [pristine, setPristine] = useState<ArtifactModel>(initial);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const mutate = (fn: (m: ArtifactModel) => ArtifactModel) =>
    setModel(cur => fn(cur));

  const reset = useCallback((m: ArtifactModel) => {
    bumpUidPast(m);
    setModel(m); setPristine(m); setDrifted(false);
  }, []);

  // Re-checking the source: run the same deterministic extractor again
  // (index 1, same source position but a fresh look), then diff the result
  // against the pristine baseline for real -- not a hardcoded set of ids.
  const onSimulateDrift = () => {
    setModel(() => diffModels(pristine, perturb(pristine, 1)));
    setDrifted(true);
  };
  const onClearDrift = () => { setModel(pristine); setDrifted(false); };

  const onDeleteAny = (id: string) => mutate(m => {
    if (m.kind === "process") {
      return {
        ...m,
        actors: m.actors.filter(x => x.id !== id),
        steps: m.steps.filter(x => x.id !== id),
        decisions: m.decisions.filter(x => x.id !== id),
        exceptions: m.exceptions.filter(x => x.id !== id),
        systems: m.systems.filter(x => x.id !== id),
        connections: (m.connections ?? []).filter(c => c.fromId !== id && c.toId !== id),
      };
    }
    return { ...m, blocks: m.blocks.map(b => ({ ...b, items: b.items.filter(i => i.id !== id) })) };
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
    if (m.kind === "process") {
      return {
        ...m,
        actors: m.actors.map(apply),
        steps: m.steps.map(apply),
        decisions: m.decisions.map(apply),
        exceptions: m.exceptions.map(apply),
        systems: m.systems.map(apply),
      };
    }
    return { ...m, blocks: m.blocks.map(b => ({ ...b, items: b.items.map(apply) })) };
  });

  const addWithId = <T,>(mk: () => { id: string; run: (m: ArtifactModel) => ArtifactModel }) => {
    const { id, run } = mk();
    mutate(run);
    setLastAddedId(id);
    return id;
  };

  const onRemoveLastAdded = useCallback(() => {
    setLastAddedId(id => {
      if (!id) return null;
      // Reuse onDeleteAny's model-shape-aware removal.
      setModel(m => {
        if (m.kind === "process") {
          return {
            ...m,
            actors: m.actors.filter(x => x.id !== id),
            steps: m.steps.filter(x => x.id !== id),
            decisions: m.decisions.filter(x => x.id !== id),
            exceptions: m.exceptions.filter(x => x.id !== id),
            systems: m.systems.filter(x => x.id !== id),
            connections: (m.connections ?? []).filter(c => c.fromId !== id && c.toId !== id),
          };
        }
        return { ...m, blocks: m.blocks.map(b => ({ ...b, items: b.items.filter(i => i.id !== id) })) };
      });
      return null;
    });
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
    return { id: item.id, run: (m) => m.kind === "process"
      ? { ...m, decisions: [...m.decisions, { ...item, afterStepId: m.steps.at(-1)?.id ?? "ST1", yes: "—", no: "—", shape }] } : m };
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
  const onAddBMC = (bid: BMCBlock["id"], t: string) => addWithId(() => {
    const item = newUserItem(bid.slice(0, 2).toUpperCase(), t);
    return { id: item.id, run: (m) => m.kind === "bmc"
      ? { ...m, blocks: m.blocks.map(b => b.id === bid ? { ...b, items: [...b.items, item] } : b) } : m };
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
    onAddActor, onAddStep, onAddDecision, onAddException, onAddSystem, onAddBMC,
    onAddConnection, onDeleteConnection, onUpdateConnection,
    onDeleteAny, onUpdateItem, onApplyRefinement,
    onRemoveLastAdded,
  };
}


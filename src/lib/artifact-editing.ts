// Shared editing/state hook for an artifact model. Both the single-source
// workbench and the project (multi-canvas) view use this so behaviour stays
// identical across entry points.

import { useCallback, useState } from "react";
import {
  applyDrift,
  type ArtifactModel, type BaseItem, type BMCBlock,
} from "@/data/samples";
import { applyProposal, type Proposal } from "@/lib/refine";

let uid = 1000;
const nextId = (prefix: string) => `${prefix}-U${++uid}`;
const newUserItem = (prefix: string, text: string): BaseItem => ({
  id: nextId(prefix), text, confidence: 1, userAdded: true,
});

export interface ArtifactEditing {
  model: ArtifactModel;
  drifted: boolean;
  reset: (m: ArtifactModel) => void;
  onSimulateDrift: () => void;
  onClearDrift: () => void;
  onAddActor: (t: string) => void;
  onAddStep: (t: string) => void;
  onAddDecision: (t: string) => void;
  onAddException: (t: string) => void;
  onAddSystem: (t: string) => void;
  onAddBMC: (b: BMCBlock["id"], t: string) => void;
  onDeleteAny: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<BaseItem> & Record<string, unknown>) => void;
  onApplyRefinement: (p: Proposal) => void;
}

export function useArtifactEditing(initial: ArtifactModel): ArtifactEditing {
  const [model, setModel] = useState<ArtifactModel>(initial);
  const [drifted, setDrifted] = useState(false);
  const [pristine, setPristine] = useState<ArtifactModel>(initial);

  const mutate = (fn: (m: ArtifactModel) => ArtifactModel) =>
    setModel(cur => fn(cur));

  const reset = useCallback((m: ArtifactModel) => {
    setModel(m); setPristine(m); setDrifted(false);
  }, []);

  const onSimulateDrift = () => { setModel(cur => applyDrift(cur)); setDrifted(true); };
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

  const onAddActor = (t: string) => mutate(m => m.kind === "process"
    ? { ...m, actors: [...m.actors, newUserItem("AC", t)] } : m);
  const onAddStep = (t: string) => mutate(m => m.kind === "process"
    ? { ...m, steps: [...m.steps, { ...newUserItem("ST", t), actorId: m.actors[0]?.id ?? "AC1" }] } : m);
  const onAddDecision = (t: string) => mutate(m => m.kind === "process"
    ? { ...m, decisions: [...m.decisions, { ...newUserItem("DC", t), afterStepId: m.steps.at(-1)?.id ?? "ST1", yes: "—", no: "—" }] } : m);
  const onAddException = (t: string) => mutate(m => m.kind === "process"
    ? { ...m, exceptions: [...m.exceptions, { ...newUserItem("EX", t) }] } : m);
  const onAddSystem = (t: string) => mutate(m => m.kind === "process"
    ? { ...m, systems: [...m.systems, newUserItem("SY", t)] } : m);
  const onAddBMC = (bid: BMCBlock["id"], t: string) => mutate(m => m.kind === "bmc"
    ? { ...m, blocks: m.blocks.map(b => b.id === bid
      ? { ...b, items: [...b.items, newUserItem(bid.slice(0, 2).toUpperCase(), t)] } : b) } : m);

  const onApplyRefinement = (p: Proposal) =>
    mutate(m => (m.kind === "process" ? applyProposal(p, m) : m));

  return {
    model, drifted, reset,
    onSimulateDrift, onClearDrift,
    onAddActor, onAddStep, onAddDecision, onAddException, onAddSystem, onAddBMC,
    onDeleteAny, onUpdateItem, onApplyRefinement,
  };
}

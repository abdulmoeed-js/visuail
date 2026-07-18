// Real drift detection: diff a "pristine" (baseline) model against a
// re-extracted model of the same source and flag exactly the items whose
// text actually changed — not a hardcoded set of ids. This replaces
// `applyDrift()` in data/samples.ts, which flipped a fixed list of items
// regardless of whether anything about them had actually changed.
//
// Re-extraction still runs through the existing deterministic extractor
// (real arbitrary-text parsing is the Real Extraction Agent's job, tracked
// separately) — but the comparison itself is now a genuine diff, and this
// is the same function that extraction agent's output will run through
// once that lands, with no rework needed here.

import type { ArtifactModel, ProcessModel, BMCModel, BaseItem } from "@/data/samples";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function diffGroup<T extends BaseItem>(oldItems: T[], newItems: T[]): T[] {
  const oldById = new Map(oldItems.map((i) => [i.id, i]));
  const newById = new Map(newItems.map((i) => [i.id, i]));
  const result: T[] = [];

  for (const [id, newItem] of newById) {
    const oldItem = oldById.get(id);
    if (!oldItem) {
      result.push({ ...newItem, drift: true }); // appeared since the baseline
      continue;
    }
    result.push(norm(oldItem.text) !== norm(newItem.text) ? { ...newItem, drift: true } : { ...newItem, drift: false });
  }
  for (const [id, oldItem] of oldById) {
    if (!newById.has(id)) {
      // Present in the baseline but gone from the re-check.
      result.push({ ...oldItem, drift: true, text: `${oldItem.text} (no longer in source)` });
    }
  }
  return result;
}

export function diffProcessModels(oldModel: ProcessModel, newModel: ProcessModel): ProcessModel {
  return {
    ...newModel,
    actors: diffGroup(oldModel.actors, newModel.actors),
    systems: diffGroup(oldModel.systems, newModel.systems),
    steps: diffGroup(oldModel.steps, newModel.steps),
    decisions: diffGroup(oldModel.decisions, newModel.decisions),
    exceptions: diffGroup(oldModel.exceptions, newModel.exceptions),
  };
}

export function diffBMCModels(oldModel: BMCModel, newModel: BMCModel): BMCModel {
  const blocks = newModel.blocks.map((newBlock) => {
    const oldBlock = oldModel.blocks.find((b) => b.id === newBlock.id);
    const items = diffGroup(oldBlock?.items ?? [], newBlock.items);
    return { ...newBlock, items, blockDrift: items.some((i) => i.drift) };
  });
  return { ...newModel, blocks };
}

/** Diff two models of the same kind, flagging items whose text actually changed. */
export function diffModels(oldModel: ArtifactModel, newModel: ArtifactModel): ArtifactModel {
  if (oldModel.kind !== newModel.kind) return newModel;
  return newModel.kind === "process"
    ? diffProcessModels(oldModel as ProcessModel, newModel as ProcessModel)
    : diffBMCModels(oldModel as BMCModel, newModel as BMCModel);
}

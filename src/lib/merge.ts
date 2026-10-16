// Reconciliation across multiple sources for a single artifact kind.
// Rules:
//  - Same id + same normalized text across N sources → confirmed. Bump
//    confidence slightly and record `confirmedBySources`.
//  - Same id + different normalized text → conflict. Keep the first source's
//    text as canonical, but flag `conflict: true` and record the alternative
//    in `conflictNote`.
//  - Item present in only one source → keep as-is (normal extraction).

import type {
  ArtifactModel, ProcessModel, BMCModel, BaseItem, BMCBlock,
} from "@/data/samples";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export interface MergeOptions {
  /** Record agreeing labels as confirming sources and raise confidence for
   *  each extra one. Re-check turns this off: "Current" and "Re-checked
   *  source" are one source looked at twice, not two that agree. */
  stamp?: boolean;
}

/** Merge one item across N sources (all with the same id). */
function mergeItem<T extends BaseItem>(
  variants: { item: T; label: string }[],
  { stamp = true }: MergeOptions = {},
): T {
  const base = { ...variants[0].item };
  const uniqueTexts = Array.from(
    new Map(variants.map(v => [norm(v.item.text), v])).values(),
  );

  const labels = variants.map(v => v.label);

  if (uniqueTexts.length === 1) {
    // All sources agree, so any earlier disagreement is settled. An item seen
    // in only one source hasn't been agreed with, so it keeps its flags.
    if (variants.length > 1) {
      // Older projects marked a failed quote check only in this note; keep
      // that fact before the note goes.
      if (base.conflictNote?.includes("Source quote could not be verified")) base.quoteUnverified = true;
      delete base.conflict;
      delete base.conflictNote;
    }
    if (stamp) {
      base.confirmedBySources = labels;
      if (labels.length > 1) {
        base.confidence = Math.min(1, base.confidence + 0.05 * (labels.length - 1));
      }
    }
    return base;
  }

  // Disagreement — flag conflict. Canonical text is the first source's version.
  const others = uniqueTexts
    .filter(v => norm(v.item.text) !== norm(base.text))
    .map(v => `${v.label}: "${v.item.text}"`)
    .join(" · ");
  base.conflict = true;
  base.conflictNote = `Conflicting sources — ${others}`;
  if (stamp) base.confirmedBySources = labels;
  return base;
}

function mergeGroup<T extends BaseItem>(
  sources: { items: T[]; label: string }[],
  opts: MergeOptions = {},
): T[] {
  // Group by id
  const byId = new Map<string, { item: T; label: string }[]>();
  const order: string[] = [];
  for (const src of sources) {
    for (const it of src.items) {
      if (!byId.has(it.id)) { byId.set(it.id, []); order.push(it.id); }
      byId.get(it.id)!.push({ item: it, label: src.label });
    }
  }
  return order.map(id => mergeItem(byId.get(id)!, opts));
}

export function mergeProcessModels(
  models: ProcessModel[],
  labels: string[],
  opts: MergeOptions = {},
): ProcessModel {
  const base = structuredClone(models[0]);
  const wrap = <T extends BaseItem>(pick: (m: ProcessModel) => T[]) =>
    models.map((m, i) => ({ items: pick(m), label: labels[i] }));
  return {
    ...base,
    actors:     mergeGroup(wrap(m => m.actors), opts),
    steps:      mergeGroup(wrap(m => m.steps), opts),
    decisions:  mergeGroup(wrap(m => m.decisions), opts),
    exceptions: mergeGroup(wrap(m => m.exceptions), opts),
    systems:    mergeGroup(wrap(m => m.systems), opts),
  };
}

export function mergeBMCModels(
  models: BMCModel[],
  labels: string[],
  opts: MergeOptions = {},
): BMCModel {
  const base = structuredClone(models[0]);
  const blocks: BMCBlock[] = base.blocks.map(b0 => {
    const perSource = models.map((m, i) => {
      const b = m.blocks.find(x => x.id === b0.id);
      return { items: b?.items ?? [], label: labels[i] };
    });
    return { ...b0, items: mergeGroup(perSource, opts) };
  });
  return { ...base, blocks };
}

export function mergeByKind(
  models: ArtifactModel[],
  labels: string[],
  opts: MergeOptions = {},
): ArtifactModel | null {
  if (models.length === 0) return null;
  const kind = models[0].kind;
  if (kind === "process") {
    return mergeProcessModels(models as ProcessModel[], labels, opts);
  }
  return mergeBMCModels(models as BMCModel[], labels, opts);
}

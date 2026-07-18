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

/** Merge one item across N sources (all with the same id). */
function mergeItem<T extends BaseItem>(
  variants: { item: T; label: string }[],
): T {
  const base = { ...variants[0].item };
  const uniqueTexts = Array.from(
    new Map(variants.map(v => [norm(v.item.text), v])).values(),
  );

  const labels = variants.map(v => v.label);

  if (uniqueTexts.length === 1) {
    // All sources agree. Confirmed.
    base.confirmedBySources = labels;
    if (labels.length > 1) {
      base.confidence = Math.min(1, base.confidence + 0.05 * (labels.length - 1));
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
  base.confirmedBySources = labels;
  return base;
}

function mergeGroup<T extends BaseItem>(
  sources: { items: T[]; label: string }[],
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
  return order.map(id => mergeItem(byId.get(id)!));
}

export function mergeProcessModels(
  models: ProcessModel[],
  labels: string[],
): ProcessModel {
  const base = structuredClone(models[0]);
  const wrap = <T extends BaseItem>(pick: (m: ProcessModel) => T[]) =>
    models.map((m, i) => ({ items: pick(m), label: labels[i] }));
  return {
    ...base,
    actors:     mergeGroup(wrap(m => m.actors)),
    steps:      mergeGroup(wrap(m => m.steps)),
    decisions:  mergeGroup(wrap(m => m.decisions)),
    exceptions: mergeGroup(wrap(m => m.exceptions)),
    systems:    mergeGroup(wrap(m => m.systems)),
  };
}

export function mergeBMCModels(
  models: BMCModel[],
  labels: string[],
): BMCModel {
  const base = structuredClone(models[0]);
  const blocks: BMCBlock[] = base.blocks.map(b0 => {
    const perSource = models.map((m, i) => {
      const b = m.blocks.find(x => x.id === b0.id);
      return { items: b?.items ?? [], label: labels[i] };
    });
    return { ...b0, items: mergeGroup(perSource) };
  });
  return { ...base, blocks };
}

export function mergeByKind(
  models: ArtifactModel[],
  labels: string[],
): ArtifactModel | null {
  if (models.length === 0) return null;
  const kind = models[0].kind;
  if (kind === "process") {
    return mergeProcessModels(models as ProcessModel[], labels);
  }
  return mergeBMCModels(models as BMCModel[], labels);
}

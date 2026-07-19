// Minimal, dependency-free id-based item comparison for Deno edge functions
// -- same *concept* as src/lib/diff.ts's diffGroup, kept as a separate small
// implementation here because that file imports browser/React-adjacent
// types and isn't set up for cross-runtime (Vite bundler vs. Deno) import.
// Used only by scheduled-drift-scan for DETECTION (does anything differ),
// not for the richer interactive reconcile-with-manual-edits flow that
// project.$id.tsx's "Re-check for drift" button already does client-side.

interface Item { id: string; text: string; [k: string]: unknown }
interface Block { id: string; items: Item[]; [k: string]: unknown }
interface Model {
  kind: "process" | "bmc";
  actors?: Item[]; steps?: Item[]; decisions?: Item[]; exceptions?: Item[]; systems?: Item[];
  blocks?: Block[];
  [k: string]: unknown;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function allItemsOf(model: Model): Item[] {
  if (model.kind === "process") {
    return [
      ...(model.actors ?? []), ...(model.steps ?? []), ...(model.decisions ?? []),
      ...(model.exceptions ?? []), ...(model.systems ?? []),
    ];
  }
  return (model.blocks ?? []).flatMap((b) => b.items);
}

/** Every item id that changed text, appeared, or disappeared between two models of the same kind. */
export function diffChangedTexts(prev: Model, next: Model): { changed: string[]; added: string[]; removed: string[] } {
  const prevById = new Map(allItemsOf(prev).map((i) => [i.id, i]));
  const nextById = new Map(allItemsOf(next).map((i) => [i.id, i]));
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [id, item] of nextById) {
    const before = prevById.get(id);
    if (!before) added.push(item.text);
    else if (norm(before.text) !== norm(item.text)) changed.push(`"${before.text}" -> "${item.text}"`);
  }
  for (const [id, item] of prevById) {
    if (!nextById.has(id)) removed.push(item.text);
  }
  return { changed, added, removed };
}

/** Combines multiple sources' extractions for the same kind into one model,
 *  keeping the FIRST source's text when ids collide. No conflict metadata --
 *  this feeds a drift summary, not a rendered canvas. */
export function mergeForScan(models: Model[]): Model | null {
  if (models.length === 0) return null;
  const base = models[0];
  if (base.kind === "process") {
    const merge = (key: "actors" | "steps" | "decisions" | "exceptions" | "systems") => {
      const seen = new Map<string, Item>();
      for (const m of models) for (const item of (m[key] as Item[] | undefined) ?? []) {
        if (!seen.has(item.id)) seen.set(item.id, item);
      }
      return [...seen.values()];
    };
    return {
      ...base,
      actors: merge("actors"), steps: merge("steps"), decisions: merge("decisions"),
      exceptions: merge("exceptions"), systems: merge("systems"),
    };
  }
  const blockIds = new Set(models.flatMap((m) => (m.blocks ?? []).map((b) => b.id)));
  const blocks: Block[] = [...blockIds].map((id) => {
    const seen = new Map<string, Item>();
    for (const m of models) {
      const block = (m.blocks ?? []).find((b) => b.id === id);
      for (const item of block?.items ?? []) if (!seen.has(item.id)) seen.set(item.id, item);
    }
    const title = models.flatMap((m) => m.blocks ?? []).find((b) => b.id === id)?.title ?? id;
    return { id, title, items: [...seen.values()] };
  });
  return { ...base, blocks };
}

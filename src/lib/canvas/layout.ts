// Hand-made arrangements of the diagrams, kept in the model (ViewLayout in
// samples.ts) so they are saved, shared with viewers and stepped through by
// Undo like any other edit. Pure, so it can be checked on its own
// (layout.test.ts).

import type { ArtifactModel, NodeLayout, ViewId, ViewLayout } from "@/data/samples";
import { MODEL_SCHEMA, schemaOf } from "@/lib/model-schema";

export interface Rect { x: number; y: number; w: number; h: number }

/** Whether moves are saved into the model. Tied to the schema on purpose:
 *  saving arrangements is exactly what an older build would destroy, so it
 *  switches on in the same change that raises MODEL_SCHEMA to 2, once the
 *  out-of-date guard has been live long enough (from 22 Oct 2026). While it
 *  is off, a move lasts until the page is reloaded, as it always has. */
export const SAVE_LAYOUTS = MODEL_SCHEMA >= 2;

/** The arrangement of one diagram, if the person has made one. */
export function layoutOf(model: ArtifactModel, view: ViewId): ViewLayout | undefined {
  return model.layouts?.find((l) => l.id === view);
}

const whole = (n: NodeLayout): NodeLayout => {
  const out: NodeLayout = { x: Math.round(n.x), y: Math.round(n.y) };
  if (n.w !== undefined) out.w = Math.round(n.w);
  if (n.h !== undefined) out.h = Math.round(n.h);
  return out;
};

/** The model with `view`'s arrangement replaced by `next` (or removed, for
 *  null), and marked with this build's schema: a build that doesn't know
 *  arrangements would drop them on its next save, so it must stop editing
 *  once it meets this model (model-schema.ts). */
function withLayout(model: ArtifactModel, view: ViewId, next: ViewLayout | null): ArtifactModel {
  const had = model.layouts ?? [];
  // Replaced where it is, never moved to the end: the shared document
  // (yjs-model.ts) does not carry reordering, and the two copies would differ.
  const layouts = !next ? had.filter((l) => l.id !== view)
    : had.some((l) => l.id === view) ? had.map((l) => (l.id === view ? next : l))
    : [...had, next];
  return { ...model, layouts, schema: Math.max(schemaOf(model), MODEL_SCHEMA) } as ArtifactModel;
}

/** Positions set by hand in one diagram. `moved` holds the shapes the
 *  person just moved or resized (null removes one). `current` is where every
 *  shape is drawn right now: the first time a diagram is arranged all of it
 *  is saved, so nothing else jumps when the automatic layout stops
 *  ("freezing" it); after that, any shape drawn but not saved yet (added
 *  since, or brought in by a source) is saved where it is, so it stays put
 *  from then on instead of being placed afresh as others move. */
export function placeShapes(
  model: ArtifactModel, view: ViewId,
  moved: Record<string, NodeLayout | null>,
  current: Record<string, NodeLayout>,
): ArtifactModel {
  const had = layoutOf(model, view);
  const nodes: Record<string, NodeLayout> = had ? { ...had.nodes } : {};
  for (const [id, n] of Object.entries(current)) if (!(id in nodes)) nodes[id] = whole(n);
  for (const [id, n] of Object.entries(moved)) {
    if (n === null) delete nodes[id];
    else nodes[id] = whole({ ...nodes[id], ...n });
  }
  return withLayout(model, view, { ...(had ?? {}), id: view, nodes });
}

/** `fresh` (a model drawn again from the sources) with the hand-made
 *  arrangements of `from` (the model it replaces) carried over: shapes
 *  that keep their ids keep their places, and new ones are placed near
 *  their neighbours. Without this, adding a source would throw away every
 *  arrangement in the project. */
export function keepArrangements<M extends ArtifactModel>(from: ArtifactModel, fresh: M): M {
  if (!from.layouts?.length) return fresh;
  // Places of items the fresh model no longer has are dropped, or a later
  // item given the same id would inherit them.
  const present = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string") present.add(o.id);
      Object.values(o).forEach(visit);
    }
  };
  visit({ ...fresh, layouts: undefined });
  const stale = new Set(from.layouts.flatMap((l) => Object.keys(l.nodes)).filter((id) => !present.has(id)));
  return { ...fresh, layouts: pruneLayouts(from.layouts, stale), schema: Math.max(schemaOf(fresh), schemaOf(from)) };
}

/** "Tidy up": back to the automatic layout for one diagram. */
export function clearLayout(model: ArtifactModel, view: ViewId): ArtifactModel {
  return layoutOf(model, view) ? withLayout(model, view, null) : model;
}

/** Business model canvas block heights, set by dragging a block's edge. */
export function setBlockHeight(model: ArtifactModel, blockId: string, h: number): ArtifactModel {
  const had = layoutOf(model, "bmc");
  const blocks = { ...(had?.blocks ?? {}), [blockId]: { h: Math.round(h) } };
  return withLayout(model, "bmc", { ...(had ?? {}), id: "bmc", nodes: had?.nodes ?? {}, blocks });
}

/** Arrangements without the items in `gone` (deleted): their entries would
 *  otherwise stay in the saved model for good. Unchanged arrays and records
 *  keep their identity. */
export function pruneLayouts(layouts: ViewLayout[] | undefined, gone: Set<string>): ViewLayout[] | undefined {
  if (!layouts) return layouts;
  let changed = false;
  const out = layouts.map((l) => {
    if (!Object.keys(l.nodes).some((id) => gone.has(id))) return l;
    changed = true;
    return { ...l, nodes: Object.fromEntries(Object.entries(l.nodes).filter(([id]) => !gone.has(id))) };
  });
  return changed ? out : layouts;
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** `rect` moved down, a step at a time, until it overlaps none of `others`
 *  (with `gap` around each): where a new shape goes in an arranged diagram
 *  when its natural place is taken. Gives up after `maxSteps` and returns
 *  the last place tried, so a pathological case still terminates. */
export function placeClear(rect: Rect, others: Rect[], gap: number, maxSteps = 200): Rect {
  let r = rect;
  for (let i = 0; i < maxSteps; i++) {
    const hit = others.find((o) => overlaps(r, o, gap));
    if (!hit) return r;
    r = { ...r, y: hit.y + hit.h + gap };
  }
  return r;
}

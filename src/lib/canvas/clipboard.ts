// Copying shapes and pasting them back as new items (phase 3: select many,
// then copy, paste or duplicate). Pure, so it can be checked on its own
// (clipboard.test.ts); the editing hook supplies the ids and applies the
// result as one undo step.
//
// The rules, in the person's terms: a copy is a new item "added by you" (no
// source quote, no certainty carried over from the original); links between
// shapes that were copied together come along; links to shapes that were
// not copied are left behind; who does a step (its actor, its system) stays.

import type { BaseItem, Connection, Decision, NodeLayout, ProcessModel, ViewId } from "@/data/samples";
import type { Rect } from "./layout";

/** The lists of a process model that hold shapes a diagram draws. */
export const SHAPE_LISTS = ["steps", "decisions", "exceptions", "dataStores", "externalEntities", "states"] as const;
export type ShapeList = (typeof SHAPE_LISTS)[number];

/** What each diagram draws. A paste keeps only what the diagram it lands in
 *  can show: states pasted on the Process map would be added, unseen. */
export const VIEW_LISTS: Partial<Record<ViewId, readonly ShapeList[]>> = {
  process: ["steps", "decisions", "exceptions"],
  dfd: ["steps", "dataStores", "externalEntities"],
  state: ["states"],
};

/** The part of a clip a diagram can show, lines between those included;
 *  null when nothing is left. */
export function clipForView(clip: ShapeClip, view: ViewId): ShapeClip | null {
  const lists = VIEW_LISTS[view];
  const items = lists ? clip.items.filter((x) => lists.includes(x.list)) : clip.items;
  if (items.length === 0) return null;
  if (items.length === clip.items.length) return clip;
  const kept = new Set(items.map((x) => x.item.id));
  return {
    ...clip, items,
    connections: clip.connections.filter((c) => kept.has(c.fromId) && kept.has(c.toId)),
    places: Object.fromEntries(Object.entries(clip.places).filter(([id]) => kept.has(id))),
  };
}

/** Id prefix of a new item in each list (as the add actions use). */
const PREFIX: Record<ShapeList, string> = {
  steps: "ST", decisions: "DC", exceptions: "EX", dataStores: "DS", externalEntities: "EE", states: "SD",
};

type AnyItem = BaseItem & Record<string, unknown>;

/** What was copied: the items, the lines between them, and where each one
 *  sat in the diagram it was copied from (top-left corners). */
export interface ShapeClip {
  view: ViewId;
  items: { list: ShapeList; item: AnyItem }[];
  connections: Connection[];
  places: Record<string, { x: number; y: number }>;
}

/** What was last copied in this tab. Kept here, not on the system
 *  clipboard: a copy carries items and links, not text. */
let held: ShapeClip | null = null;
export const shapeClipboard = {
  get: () => held,
  set: (clip: ShapeClip | null) => { held = clip; },
};

/** The shapes with these ids, from any list, as a clip. */
export function copyShapes(
  model: ProcessModel, view: ViewId, ids: string[], places: Record<string, { x: number; y: number }>,
): ShapeClip | null {
  const want = new Set(ids);
  const items: ShapeClip["items"] = [];
  for (const list of SHAPE_LISTS) {
    for (const item of (model[list] ?? []) as AnyItem[]) if (want.has(item.id)) items.push({ list, item: structuredClone(item) });
  }
  if (items.length === 0) return null;
  const got = new Set(items.map((x) => x.item.id));
  const connections = (model.connections ?? []).filter((c) => got.has(c.fromId) && got.has(c.toId)).map((c) => ({ ...c }));
  const kept: ShapeClip["places"] = {};
  for (const id of got) if (places[id]) kept[id] = places[id];
  return { view, items, connections, places: kept };
}

/** A copy's own fields: provenance is reset, it is the person's now. */
function asNew(item: AnyItem, id: string): AnyItem {
  const next: AnyItem = { ...item, id, userAdded: true, confidence: 1 };
  for (const k of ["snippet", "unresolved", "quoteUnverified", "drift", "confirmedBySources", "conflict", "conflictNote"]) delete next[k];
  return next;
}

/** The model with the clip's items added as new ones, moved by (dx, dy)
 *  from where they were copied. `newId(prefix)` makes each id. Returns the
 *  new ids (in clip order) and their places, for saving and selecting. */
export function pasteShapes(
  model: ProcessModel, clip: ShapeClip, newId: (prefix: string) => string, dx: number, dy: number,
): { model: ProcessModel; ids: string[]; places: Record<string, NodeLayout> } {
  const map = new Map<string, string>();
  for (const { list, item } of clip.items) map.set(item.id, newId(PREFIX[list]));
  const remap = (id: string | undefined, otherwise: string | undefined) => (id !== undefined && map.has(id) ? map.get(id) : otherwise);

  const added: Record<ShapeList, AnyItem[]> = { steps: [], decisions: [], exceptions: [], dataStores: [], externalEntities: [], states: [] };
  // The copy may come from another artifact, or its actor may have been
  // deleted since: who does a step stays only if they exist here.
  const actors = new Set(model.actors.map((a) => a.id));
  const systems = new Set(model.systems.map((x) => x.id));
  for (const { list, item } of clip.items) {
    const copy = asNew(item, map.get(item.id)!);
    if (typeof copy.actorId === "string" && copy.actorId && !actors.has(copy.actorId)) copy.actorId = "";
    if (typeof copy.systemId === "string" && !systems.has(copy.systemId)) delete copy.systemId;
    if (copy.raci && typeof copy.raci === "object") {
      copy.raci = Object.fromEntries(Object.entries(copy.raci as Record<string, string>).filter(([k]) => actors.has(k)));
    }
    if (list === "decisions") {
      const d = copy as unknown as Decision;
      // A copied decision follows the copied step it followed; otherwise it
      // is unanchored (drawn where it was pasted, or at the end of the flow).
      d.afterStepId = remap(d.afterStepId, "") ?? "";
      if (Array.isArray(d.branches)) {
        d.branches = d.branches.map((b) => ({ ...b, id: newId("BR"), targetId: remap(b.targetId, "—") ?? "—" }));
      }
      if (typeof d.yes === "string") d.yes = remap(d.yes, undefined);
      if (typeof d.no === "string") d.no = remap(d.no, undefined);
      if (d.yes === undefined) delete d.yes;
      if (d.no === undefined) delete d.no;
    }
    if ("relatedStepId" in copy) {
      const rel = remap(copy.relatedStepId as string | undefined, undefined);
      if (rel === undefined) delete copy.relatedStepId; else copy.relatedStepId = rel;
    }
    added[list].push(copy);
  }
  const connections = clip.connections.map((c) => ({
    ...c, id: newId("CN"), fromId: map.get(c.fromId)!, toId: map.get(c.toId)!, userAdded: true,
  }));

  const next = { ...model } as ProcessModel;
  for (const list of SHAPE_LISTS) {
    if (added[list].length === 0) continue;
    (next as unknown as Record<ShapeList, AnyItem[]>)[list] = [...((model[list] ?? []) as AnyItem[]), ...added[list]];
  }
  if (connections.length > 0) next.connections = [...(model.connections ?? []), ...connections];

  const places: Record<string, NodeLayout> = {};
  for (const [oldId, p] of Object.entries(clip.places)) {
    const id = map.get(oldId);
    if (id) places[id] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  }
  return { model: next, ids: clip.items.map(({ item }) => map.get(item.id)!), places };
}

/** The rectangle between two corners, whichever way it was drawn. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** The shapes a selection box touches (any overlap, as in Figma and Miro's
 *  default), in the order given. */
export function shapesInBox(rects: Record<string, Rect>, box: Rect): string[] {
  return Object.entries(rects)
    .filter(([, r]) => r.x < box.x + box.w && box.x < r.x + r.w && r.y < box.y + box.h && box.y < r.y + r.h)
    .map(([id]) => id);
}

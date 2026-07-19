// Conversion between the app's plain ArtifactModel (the shape every other
// file in this codebase already works with) and a Yjs CRDT document.
//
// Deliberately NOT a rewrite of the edit actions in artifact-editing.ts.
// Every action there still computes a plain "next model" from a plain
// "current model" exactly as before; applyModelDiffToYDoc's job is to walk
// the two plain models and patch a Y.Doc to match, so unrelated fields and
// unrelated items are never touched -- which is what lets two people's
// concurrent edits to different items (or different fields of the same
// item) merge instead of one clobbering the other.
//
// item.text specifically uses Y.Text with a prefix/suffix diff, so
// concurrent edits at different positions in the same field merge at the
// character level instead of one full string clobbering the other.

import * as Y from "yjs";
import type { ArtifactModel, BaseItem, BMCBlock } from "@/data/samples";

type PlainItem = BaseItem & Record<string, unknown>;

function itemToYMap(item: PlainItem): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined) continue;
    if (key === "text") {
      const yText = new Y.Text();
      yText.insert(0, String(value));
      map.set("text", yText);
    } else {
      map.set(key, value);
    }
  }
  return map;
}

function yMapToItem(map: Y.Map<unknown>): PlainItem {
  const obj: Record<string, unknown> = {};
  for (const key of map.keys()) {
    const value = map.get(key);
    obj[key] = key === "text" && value instanceof Y.Text ? value.toString() : value;
  }
  return obj as PlainItem;
}

/** Applies a minimal prefix/suffix diff of oldStr -> newStr onto a Y.Text,
 *  instead of a full delete+insert, so concurrent edits at different
 *  positions merge instead of one clobbering the other. */
function patchYText(yText: Y.Text, newStr: string) {
  const oldStr = yText.toString();
  if (oldStr === newStr) return;
  let start = 0;
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) start++;
  let endOld = oldStr.length;
  let endNew = newStr.length;
  while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) { endOld--; endNew--; }
  if (endOld > start) yText.delete(start, endOld - start);
  if (endNew > start) yText.insert(start, newStr.slice(start, endNew));
}

function patchItemFields(yMap: Y.Map<unknown>, prev: PlainItem, next: PlainItem) {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const prevVal = prev[key];
    const nextVal = next[key];
    if (prevVal === nextVal) continue;
    if (key === "text") {
      const yText = yMap.get("text");
      if (yText instanceof Y.Text) patchYText(yText, String(nextVal ?? ""));
      continue;
    }
    if (nextVal === undefined) yMap.delete(key);
    else yMap.set(key, nextVal);
  }
}

/** Reconciles an ordered Y.Array<Y.Map> of items (keyed by id) to match
 *  `nextItems`, given the previous plain array it was last derived from. */
function patchItemArray(yArray: Y.Array<Y.Map<unknown>>, prevItems: PlainItem[], nextItems: PlainItem[]) {
  const prevById = new Map(prevItems.map((i) => [i.id, i]));
  const nextById = new Map(nextItems.map((i) => [i.id, i]));

  // Deletions first, iterating backwards so earlier indices stay valid.
  for (let idx = yArray.length - 1; idx >= 0; idx--) {
    const id = yArray.get(idx).get("id") as string;
    if (!nextById.has(id)) yArray.delete(idx, 1);
  }
  // Additions, in next's relative order.
  for (const item of nextItems) {
    if (!prevById.has(item.id)) yArray.push([itemToYMap(item)]);
  }
  // Field-level updates for items present in both with a changed reference.
  for (let idx = 0; idx < yArray.length; idx++) {
    const yMap = yArray.get(idx);
    const id = yMap.get("id") as string;
    const prevItem = prevById.get(id);
    const nextItem = nextById.get(id);
    if (!prevItem || !nextItem || prevItem === nextItem) continue;
    patchItemFields(yMap, prevItem, nextItem);
  }
}

const PROCESS_ITEM_KEYS = ["actors", "steps", "decisions", "exceptions", "systems"] as const;

export function modelToYDoc(model: ArtifactModel): Y.Doc {
  const ydoc = new Y.Doc();
  const root = ydoc.getMap("root");
  ydoc.transact(() => {
    root.set("kind", model.kind);
    root.set("title", model.title);
    if (model.kind === "process") {
      for (const key of PROCESS_ITEM_KEYS) {
        const arr = new Y.Array<Y.Map<unknown>>();
        for (const item of model[key] as PlainItem[]) arr.push([itemToYMap(item)]);
        root.set(key, arr);
      }
      const conns = new Y.Array<Y.Map<unknown>>();
      for (const c of model.connections ?? []) conns.push([itemToYMap(c as unknown as PlainItem)]);
      root.set("connections", conns);
    } else {
      const blocks = new Y.Array<Y.Map<unknown>>();
      for (const b of model.blocks) {
        const bMap = new Y.Map<unknown>();
        bMap.set("id", b.id);
        bMap.set("title", b.title);
        if (b.blockDrift !== undefined) bMap.set("blockDrift", b.blockDrift);
        if (b.driftNote !== undefined) bMap.set("driftNote", b.driftNote);
        const items = new Y.Array<Y.Map<unknown>>();
        for (const item of b.items) items.push([itemToYMap(item as PlainItem)]);
        bMap.set("items", items);
        blocks.push([bMap]);
      }
      root.set("blocks", blocks);
    }
  });
  return ydoc;
}

export function yDocToModel(ydoc: Y.Doc): ArtifactModel {
  const root = ydoc.getMap("root");
  const kind = root.get("kind") as "process" | "bmc";
  const title = root.get("title") as string;

  const readItems = (key: string): PlainItem[] =>
    ((root.get(key) as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map(yMapToItem);

  if (kind === "process") {
    return {
      kind: "process",
      title,
      actors: readItems("actors") as never,
      steps: readItems("steps") as never,
      decisions: readItems("decisions") as never,
      exceptions: readItems("exceptions") as never,
      systems: readItems("systems") as never,
      connections: readItems("connections") as never,
    };
  }

  const blocksArr = (root.get("blocks") as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? [];
  return {
    kind: "bmc",
    title,
    blocks: blocksArr.map((bMap): BMCBlock => ({
      id: bMap.get("id") as BMCBlock["id"],
      title: bMap.get("title") as string,
      blockDrift: bMap.get("blockDrift") as boolean | undefined,
      driftNote: bMap.get("driftNote") as string | undefined,
      items: ((bMap.get("items") as Y.Array<Y.Map<unknown>> | undefined)?.toArray() ?? []).map(yMapToItem) as never,
    })),
  };
}

/** Patches a Y.Doc so it matches `next`, given it currently matches `prev`
 *  -- the core of how local edits (computed by the existing, unchanged
 *  action functions in artifact-editing.ts) get applied without touching
 *  fields or items nobody actually changed. */
export function applyModelDiffToYDoc(ydoc: Y.Doc, prev: ArtifactModel, next: ArtifactModel): void {
  if (prev.kind !== next.kind) return; // shouldn't happen; a canvas's kind never changes in place
  const root = ydoc.getMap("root");
  ydoc.transact(() => {
    if (next.title !== prev.title) root.set("title", next.title);

    if (next.kind === "process" && prev.kind === "process") {
      for (const key of PROCESS_ITEM_KEYS) {
        patchItemArray(root.get(key) as Y.Array<Y.Map<unknown>>, prev[key] as PlainItem[], next[key] as PlainItem[]);
      }
      patchItemArray(
        root.get("connections") as Y.Array<Y.Map<unknown>>,
        (prev.connections ?? []) as unknown as PlainItem[],
        (next.connections ?? []) as unknown as PlainItem[],
      );
    } else if (next.kind === "bmc" && prev.kind === "bmc") {
      const blocksArr = root.get("blocks") as Y.Array<Y.Map<unknown>>;
      for (let idx = 0; idx < blocksArr.length; idx++) {
        const bMap = blocksArr.get(idx);
        const bid = bMap.get("id");
        const prevBlock = prev.blocks.find((b) => b.id === bid);
        const nextBlock = next.blocks.find((b) => b.id === bid);
        if (!prevBlock || !nextBlock) continue;
        if (nextBlock.title !== prevBlock.title) bMap.set("title", nextBlock.title);
        if (nextBlock.blockDrift !== prevBlock.blockDrift) bMap.set("blockDrift", nextBlock.blockDrift ?? false);
        if (nextBlock.driftNote !== prevBlock.driftNote) {
          if (nextBlock.driftNote === undefined) bMap.delete("driftNote");
          else bMap.set("driftNote", nextBlock.driftNote);
        }
        patchItemArray(bMap.get("items") as Y.Array<Y.Map<unknown>>, prevBlock.items as PlainItem[], nextBlock.items as PlainItem[]);
      }
    }
  });
}

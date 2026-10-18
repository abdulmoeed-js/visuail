/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BMCModel, ProcessModel } from "@/data/samples";
import { MODEL_SCHEMA } from "@/lib/model-schema";
import { removeById } from "@/lib/remove-item";
import { clearLayout, keepArrangements, layoutOf, placeClear, placeShapes, pruneLayouts, setBlockHeight } from "./layout";

const model = (): ProcessModel => ({
  kind: "process", title: "T", actors: [], decisions: [], exceptions: [], systems: [],
  steps: [
    { id: "ST1", text: "a", confidence: 1, actorId: "" },
    { id: "ST2", text: "b", confidence: 1, actorId: "" },
  ],
});

test("the first move saves where everything is, so nothing else jumps", () => {
  const current = { ST1: { x: 100.4, y: 40 }, ST2: { x: 100, y: 212.6 } };
  const out = placeShapes(model(), "process", { ST2: { x: 380, y: 200 } }, current);
  assert.deepEqual(layoutOf(out, "process"), { id: "process", nodes: { ST1: { x: 100, y: 40 }, ST2: { x: 380, y: 200 } } });
  // Marked with this build's schema, so older builds stop editing it.
  assert.equal(out.schema, MODEL_SCHEMA);
  // Other diagrams of the same model are untouched.
  assert.equal(layoutOf(out, "dfd"), undefined);
});

test("later moves change only what moved, and keep a set size", () => {
  const once = placeShapes(model(), "process", { ST1: { x: 0, y: 0, w: 300 } }, { ST1: { x: 9, y: 9 }, ST2: { x: 9, y: 99 } });
  const twice = placeShapes(once, "process", { ST1: { x: 20, y: 30 } }, { ST1: { x: 999, y: 999 }, ST2: { x: 999, y: 999 } });
  assert.deepEqual(layoutOf(twice, "process")!.nodes, { ST1: { x: 20, y: 30, w: 300 }, ST2: { x: 9, y: 99 } });
  const removed = placeShapes(twice, "process", { ST2: null }, {});
  assert.deepEqual(Object.keys(layoutOf(removed, "process")!.nodes), ["ST1"]);
});

test("Tidy up goes back to the automatic layout for that diagram only", () => {
  let m = placeShapes(model(), "process", { ST1: { x: 1, y: 1 } }, {});
  m = placeShapes(m, "dfd", { ST1: { x: 2, y: 2 } }, {});
  const tidy = clearLayout(m, "process");
  assert.equal(layoutOf(tidy, "process"), undefined);
  assert.ok(layoutOf(tidy, "dfd"));
  assert.equal(clearLayout(tidy, "process"), tidy, "nothing to tidy changes nothing");
});

test("business model canvas block heights are kept, in whole pixels", () => {
  const bmc = { kind: "bmc", title: "B", blocks: [] } as unknown as BMCModel;
  const out = setBlockHeight(setBlockHeight(bmc, "value", 260.6), "costs", 180);
  assert.deepEqual(layoutOf(out, "bmc")!.blocks, { value: { h: 261 }, costs: { h: 180 } });
});

test("deleting an item drops its saved position in every diagram", () => {
  let m: ProcessModel = placeShapes(model(), "process", {}, { ST1: { x: 1, y: 1 }, ST2: { x: 2, y: 2 } }) as ProcessModel;
  m = placeShapes(m, "dfd", {}, { ST1: { x: 3, y: 3 }, ST2: { x: 4, y: 4 } }) as ProcessModel;
  const out = removeById(m, "ST1");
  assert.deepEqual(out.layouts!.map((l) => Object.keys(l.nodes)), [["ST2"], ["ST2"]]);
  const same = pruneLayouts(out.layouts, new Set(["nope"]));
  assert.equal(same, out.layouts, "nothing to drop keeps the same array");
});

test("a new shape that would land on another moves down until it is clear", () => {
  const others = [{ x: 0, y: 0, w: 200, h: 80 }, { x: 0, y: 100, w: 200, h: 80 }];
  assert.deepEqual(placeClear({ x: 50, y: 20, w: 100, h: 60 }, others, 20), { x: 50, y: 200, w: 100, h: 60 });
  // Already clear: unchanged.
  assert.deepEqual(placeClear({ x: 400, y: 0, w: 10, h: 10 }, others, 20), { x: 400, y: 0, w: 10, h: 10 });
});

test("adding a source keeps the arrangement", () => {
  const arranged = placeShapes(model(), "process", { ST1: { x: 500, y: 9 } }, { ST1: { x: 0, y: 0 }, ST2: { x: 0, y: 100 } });
  const fresh = { ...model(), title: "Re-extracted" };
  const out = keepArrangements(arranged, fresh);
  assert.equal(out.title, "Re-extracted");
  assert.deepEqual(out.layouts, arranged.layouts);
  assert.equal(out.schema, arranged.schema);
  // Nothing arranged: the fresh model as it is.
  assert.equal(keepArrangements(model(), fresh), fresh);
});

test("a shape added to an arranged diagram is pinned where it shows, on the next save", () => {
  const once = placeShapes(model(), "dfd", { ST1: { x: 10, y: 10 } }, { ST1: { x: 0, y: 0 } });
  // ST2 appeared since (drawn at 300,40 by the placement rule); ST1 moves again.
  const twice = placeShapes(once, "dfd", { ST1: { x: 20, y: 20 } }, { ST1: { x: 10, y: 10 }, ST2: { x: 300, y: 40 } });
  assert.deepEqual(layoutOf(twice, "dfd")!.nodes, { ST1: { x: 20, y: 20 }, ST2: { x: 300, y: 40 } });
});

test("adding a source drops places of items that are gone", () => {
  const arranged = placeShapes(model(), "process", {}, { ST1: { x: 0, y: 0 }, ST2: { x: 0, y: 100 }, "ST-U1001": { x: 5, y: 5 } });
  const fresh = model(); // has ST1 and ST2 only
  assert.deepEqual(Object.keys(layoutOf(keepArrangements(arranged, fresh), "process")!.nodes), ["ST1", "ST2"]);
});

/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProcessModel } from "@/data/samples";
import { boxBetween, clipForView, copyShapes, pasteShapes, shapesInBox } from "./clipboard";

const model = (): ProcessModel => ({
  kind: "process", title: "T", actors: [{ id: "AC1", text: "Clerk", confidence: 1 }], systems: [{ id: "SY1", text: "CRM", confidence: 1 }],
  steps: [
    { id: "ST1", text: "Receive", confidence: 0.6, actorId: "AC1", snippet: "we receive it", unresolved: true },
    { id: "ST2", text: "Check", confidence: 0.9, actorId: "AC1", systemId: "SY1" },
  ],
  decisions: [{ id: "DC1", text: "OK?", confidence: 0.9, afterStepId: "ST1", branches: [
    { id: "B1", label: "Yes", targetId: "ST2" }, { id: "B2", label: "No", targetId: "EX1" },
  ] }],
  exceptions: [{ id: "EX1", text: "Missing docs", confidence: 0.8, relatedStepId: "ST1" }],
  connections: [{ id: "CN1", fromId: "ST1", toId: "ST2" }, { id: "CN2", fromId: "ST2", toId: "EX1" }],
});

let n = 0;
const newId = (p: string) => `${p}-U${++n}`;

test("a copy is a new item, the person's own, with its links inside the copy", () => {
  n = 100;
  const m = model();
  const clip = copyShapes(m, "process", ["ST1", "DC1", "ST2"], { ST1: { x: 10, y: 20 }, DC1: { x: 10, y: 120 }, ST2: { x: 10, y: 220 } })!;
  const out = pasteShapes(m, clip, newId, 40, 40);
  assert.deepEqual(out.ids, ["ST-U101", "ST-U102", "DC-U103"]);
  const [c1, c2] = out.model.steps.slice(2);
  // Provenance reset: added by the person, no quote, no doubt flags.
  assert.deepEqual([c1.userAdded, c1.confidence, "snippet" in c1, "unresolved" in c1], [true, 1, false, false]);
  // Who does it stays.
  assert.equal(c1.actorId, "AC1");
  assert.equal(c2.systemId, "SY1");
  const dc = out.model.decisions[1];
  // Follows the copied step; a branch to a copied step is re-pointed, one
  // to something not copied leads nowhere; branch ids are new.
  assert.equal(dc.afterStepId, "ST-U101");
  assert.deepEqual(dc.branches.map((b) => b.targetId), ["ST-U102", "—"]);
  assert.ok(dc.branches.every((b) => !["B1", "B2"].includes(b.id)));
  // Only the line between two copied shapes comes along.
  assert.deepEqual(out.model.connections!.slice(2).map((c) => [c.fromId, c.toId]), [["ST-U101", "ST-U102"]]);
  // Placed where they were, moved by the offset.
  assert.deepEqual(out.places, { "ST-U101": { x: 50, y: 60 }, "DC-U103": { x: 50, y: 160 }, "ST-U102": { x: 50, y: 260 } });
  // The originals are untouched.
  assert.deepEqual(out.model.steps.slice(0, 2), m.steps);
});

test("links to shapes that were not copied are left behind", () => {
  n = 200;
  const m = model();
  const out = pasteShapes(m, copyShapes(m, "process", ["EX1", "DC1"], {})!, newId, 0, 0);
  const ex = out.model.exceptions[1];
  const dc = out.model.decisions[1];
  assert.equal("relatedStepId" in ex, false, "its step was not copied");
  assert.equal(dc.afterStepId, "");
  // Its "No" branch led to the exception, which was copied with it.
  assert.deepEqual(dc.branches.map((b) => b.targetId), ["—", ex.id]);
  assert.equal(out.model.connections!.length, 2, "no line copied");
});

test("nothing to copy gives nothing", () => {
  assert.equal(copyShapes(model(), "process", ["NOPE"], {}), null);
});

test("a selection box takes every shape it touches, drawn either way", () => {
  const box = boxBetween({ x: 300, y: 200 }, { x: 100, y: 50 });
  assert.deepEqual(box, { x: 100, y: 50, w: 200, h: 150 });
  const rects = {
    inside: { x: 120, y: 60, w: 50, h: 50 },
    touching: { x: 280, y: 190, w: 100, h: 100 },
    outside: { x: 400, y: 0, w: 50, h: 50 },
  };
  assert.deepEqual(shapesInBox(rects, box), ["inside", "touching"]);
});

test("a paste keeps only what the diagram it lands in draws", () => {
  const m: ProcessModel = { ...model(), states: [{ id: "SD1", text: "Open", confidence: 1 }] };
  const clip = copyShapes(m, "state", ["SD1", "ST1"], { SD1: { x: 0, y: 0 }, ST1: { x: 5, y: 5 } })!;
  assert.equal(clipForView(clip, "process")!.items.map((x) => x.item.id).join(), "ST1");
  assert.deepEqual(Object.keys(clipForView(clip, "process")!.places), ["ST1"]);
  assert.equal(clipForView(copyShapes(m, "state", ["SD1"], {})!, "process"), null, "nothing the Process map draws");
  // A line to a shape that was left out is left out too.
  const both = copyShapes(m, "process", ["ST1", "ST2"], {})!;
  assert.equal(clipForView(both, "state"), null);
  assert.equal(clipForView(both, "dfd"), both, "all of it fits: unchanged");
});

test("a pasted step keeps its people and systems only if this artifact has them", () => {
  n = 300;
  const from = model();
  const clip = copyShapes(from, "process", ["ST1", "ST2"], {})!;
  clip.items[0].item.raci = { AC1: "R", AC9: "A" };
  const to: ProcessModel = { ...model(), actors: [{ id: "AC2", text: "Manager", confidence: 1 }], systems: [] };
  const out = pasteShapes(to, clip, newId, 0, 0);
  const [a, b] = out.model.steps.slice(2);
  assert.equal(a.actorId, "", "the clerk isn’t in this artifact");
  assert.equal("systemId" in b, false);
  assert.deepEqual(a.raci, {});
  const kept = pasteShapes(from, clip, newId, 0, 0).model.steps.slice(2);
  assert.equal(kept[0].actorId, "AC1");
  assert.deepEqual(kept[0].raci, { AC1: "R" });
});

/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchor, connectorRoute, sidesBetween } from "./connector";

const a = { x: 0, y: 0, w: 100, h: 60 };

test("side by side: out of the right side, into the left, elbow halfway", () => {
  const b = { x: 200, y: 100, w: 100, h: 60 };
  assert.deepEqual(sidesBetween(a, b), ["right", "left"]);
  const r = connectorRoute(a, b);
  assert.deepEqual(r.points, [{ x: 100, y: 30 }, { x: 150, y: 30 }, { x: 150, y: 130 }, { x: 200, y: 130 }]);
  assert.deepEqual(r.mid, { x: 150, y: 80 });
});

test("one above the other: out of the bottom, into the top", () => {
  const b = { x: 40, y: 200, w: 100, h: 60 };
  assert.deepEqual(sidesBetween(a, b), ["bottom", "top"]);
  const r = connectorRoute(a, b);
  assert.deepEqual(r.points, [{ x: 50, y: 60 }, { x: 50, y: 130 }, { x: 90, y: 130 }, { x: 90, y: 200 }]);
  assert.deepEqual(r.mid, { x: 70, y: 130 });
  // Going up: out of the top, into the bottom.
  assert.deepEqual(sidesBetween(b, a), ["top", "bottom"]);
});

test("ends that line up give a straight line", () => {
  const right = connectorRoute(a, { x: 300, y: 0, w: 100, h: 60 });
  assert.deepEqual(right.points, [{ x: 100, y: 30 }, { x: 300, y: 30 }]);
  assert.deepEqual(right.mid, { x: 200, y: 30 });
  const below = connectorRoute(a, { x: 0, y: 300, w: 100, h: 60 });
  assert.deepEqual(below.points, [{ x: 50, y: 60 }, { x: 50, y: 300 }]);
});

test("the wider gap decides; leftwards goes out of the left side", () => {
  // 150 apart sideways, 40 apart up and down: sideways.
  assert.deepEqual(sidesBetween(a, { x: -250, y: 100, w: 100, h: 60 }), ["left", "right"]);
  // 20 apart sideways, 140 apart up and down: up and down.
  assert.deepEqual(sidesBetween(a, { x: 120, y: 200, w: 100, h: 60 }), ["bottom", "top"]);
});

test("anchors are the middles of the sides", () => {
  assert.deepEqual([anchor(a, "top"), anchor(a, "right"), anchor(a, "bottom"), anchor(a, "left")],
    [{ x: 50, y: 0 }, { x: 100, y: 30 }, { x: 50, y: 60 }, { x: 0, y: 30 }]);
});

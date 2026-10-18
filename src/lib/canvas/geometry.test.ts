/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgePoint, roundedPath, type Point } from "./geometry";

// The copy each view carried before they shared one (ProcessCanvas, DFD,
// State and Activity were character for character the same apart from the
// default radius). The shared one must draw exactly what they drew.
function oldRoundedPath(points: Point[], r: number): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const inRatio = inLen === 0 ? 0 : rr / inLen;
    const outRatio = outLen === 0 ? 0 : rr / outLen;
    const p1 = { x: cur.x - (cur.x - prev.x) * inRatio, y: cur.y - (cur.y - prev.y) * inRatio };
    const p2 = { x: cur.x + (next.x - cur.x) * outRatio, y: cur.y + (next.y - cur.y) * outRatio };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

const ROUTES: Point[][] = [
  [],
  [{ x: 1, y: 2 }],
  [{ x: 0, y: 0 }, { x: 100, y: 40 }],
  // The elbow every view draws: across, down, across.
  [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 200 }, { x: 300, y: 200 }],
  // A tight turn, where the radius has to shrink to fit.
  [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 40, y: 5 }],
  // A zero-length leg (both ends on the same line).
  [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 80 }, { x: 90, y: 80 }],
  // Fractions, as layouts produce.
  [{ x: 12.5, y: 7.25 }, { x: 140.75, y: 7.25 }, { x: 140.75, y: 333.5 }],
];

test("roundedPath draws exactly what every view's own copy drew", () => {
  for (const pts of ROUTES) {
    assert.equal(roundedPath(pts), oldRoundedPath(pts, 12));
    assert.equal(roundedPath(pts, 14), oldRoundedPath(pts, 14));
  }
});

test("edgePoint leaves from the side facing the other box", () => {
  const a = { cx: 100, cy: 100, w: 40, h: 20 };
  assert.deepEqual(edgePoint(a, { cx: 300, cy: 120 }), { x: 120, y: 100 }); // right
  assert.deepEqual(edgePoint(a, { cx: -50, cy: 90 }), { x: 80, y: 100 });   // left
  assert.deepEqual(edgePoint(a, { cx: 110, cy: 400 }), { x: 100, y: 110 }); // below
  assert.deepEqual(edgePoint(a, { cx: 90, cy: -10 }), { x: 100, y: 90 });   // above
  // A tie goes up or down, as before.
  assert.deepEqual(edgePoint(a, { cx: 150, cy: 150 }), { x: 100, y: 110 });
  // Same centre (a state's transition to itself): from the top.
  assert.deepEqual(edgePoint(a, { cx: 100, cy: 100 }), { x: 100, y: 90 });
});

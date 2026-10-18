/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_PAD, gridSpacing, pinchView, visibleWorld, wheelPixels, worldOf, zoomAbout, type View } from "./camera";

const screenOf = (v: View, wx: number, wy: number) => ({ x: wx * v.zoom + v.pan.x, y: wy * v.zoom + v.pan.y });

test("the world is the sheet, grown to take in shapes outside it", () => {
  assert.deepEqual(worldOf(900, 600, null), { x: 0, y: 0, w: 900, h: 600 });
  assert.deepEqual(worldOf(900, 600, { x: 40, y: 40, w: 100, h: 100 }), { x: 0, y: 0, w: 900, h: 600 });
  // A shape dragged left of and above the start: taken in, with room around it.
  const P = WORLD_PAD;
  assert.deepEqual(worldOf(900, 600, { x: -200, y: -50, w: 400, h: 100 }), { x: -200 - P, y: -50 - P, w: 1100 + P, h: 650 + P });
  // And one dragged past the sheet's far edge.
  assert.deepEqual(worldOf(900, 600, { x: 800, y: 500, w: 300, h: 300 }), { x: 0, y: 0, w: 1100 + P, h: 800 + P });
  // An empty or broken rectangle changes nothing.
  assert.deepEqual(worldOf(900, 600, { x: -10, y: -10, w: 0, h: 5 }), { x: 0, y: 0, w: 900, h: 600 });
});

test("zooming about a point keeps that point still", () => {
  const v: View = { zoom: 0.8, pan: { x: 120, y: -40 } };
  const at = { x: 300, y: 200 };
  const world = { x: (at.x - v.pan.x) / v.zoom, y: (at.y - v.pan.y) / v.zoom };
  const z = zoomAbout(v, 1.6, at.x, at.y);
  const back = screenOf(z, world.x, world.y);
  assert.ok(Math.abs(back.x - at.x) < 1e-9 && Math.abs(back.y - at.y) < 1e-9);
  assert.equal(zoomAbout(v, 0.8, 1, 2), v);
});

test("a pinch keeps the point under the fingers under them", () => {
  const start: View = { zoom: 1, pan: { x: 0, y: 0 } };
  const clamp = (z: number) => Math.min(3, Math.max(0.2, z));
  // Fingers 100px apart around (200, 200), spread to 200px apart and moved to (260, 230).
  const v = pinchView(start, { x: 200, y: 200 }, 100, { x: 260, y: 230 }, 200, clamp);
  assert.equal(v.zoom, 2);
  const p = screenOf(v, 200, 200); // the world point first under the fingers
  assert.ok(Math.abs(p.x - 260) < 1e-9 && Math.abs(p.y - 230) < 1e-9);
  // Same spread: a two-finger pan, no zoom.
  const pan = pinchView(start, { x: 10, y: 10 }, 50, { x: 40, y: -5 }, 50, clamp);
  assert.deepEqual(pan, { zoom: 1, pan: { x: 30, y: -15 } });
  // The zoom limit holds, and the midpoint still anchors.
  const far = pinchView(start, { x: 0, y: 0 }, 10, { x: 0, y: 0 }, 1000, clamp);
  assert.equal(far.zoom, 3);
});

test("wheel movement is in pixels whatever the device reports", () => {
  assert.deepEqual(wheelPixels({ deltaX: 3, deltaY: -7, deltaMode: 0 }, 800), { x: 3, y: -7 });
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800), { x: 0, y: 48 });
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800), { x: 0, y: 800 });
});

test("grid lines are never too dense, and always land on the snap step", () => {
  assert.equal(gridSpacing(1, 20, 12), 20);
  assert.equal(gridSpacing(0.8, 20, 12), 16);
  // Zoomed out to 20%, 20 units would be 4px apart: doubled twice, to 16px (80 units).
  assert.ok(Math.abs(gridSpacing(0.2, 20, 12) - 16) < 1e-9);
  // Every spacing is a whole multiple of the step in world units.
  for (const z of [0.2, 0.33, 0.5, 0.8, 1, 1.7, 3]) {
    const size = gridSpacing(z, 20, 12);
    const units = size / z / 20;
    assert.ok(Math.abs(units - Math.round(units)) < 1e-9 && size >= 12, `zoom ${z}`);
  }
});

test("the visible world is the frame divided by the camera", () => {
  assert.deepEqual(visibleWorld({ zoom: 2, pan: { x: -100, y: 50 } }, 800, 600), { x: 50, y: -25, w: 400, h: 300 });
});

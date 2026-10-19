/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignTo } from "./guides";

const other = { x: 100, y: 100, w: 200, h: 80 }; // left 100, middle 200, right 300; top 100, middle 140, bottom 180

test("a box close to lining up moves to line up, with a line to show it", () => {
  // Left edge 4 off the other's left edge; tops far apart.
  const out = alignTo({ x: 104, y: 400, w: 120, h: 60 }, [other], 6);
  assert.equal(out.dx, -4);
  assert.equal(out.dy, null);
  // A vertical line at x = 100 from the other's top to the box's bottom.
  assert.deepEqual(out.guides, [{ axis: "x", at: 100, from: 100, to: 460 }]);
});

test("middles line up too, and the nearest line-up wins", () => {
  // Box middle 203 (3 from the other's middle 200); its left 143 is 43 off.
  const out = alignTo({ x: 143, y: 300, w: 120, h: 60 }, [other], 6);
  assert.equal(out.dx, -3);
  // Box bottom 182 is 2 off the other's bottom 180; its top 122 is 22 off.
  const both = alignTo({ x: 500, y: 122, w: 50, h: 60 }, [other], 6);
  assert.equal(both.dy, -2);
  assert.equal(both.dx, null);
  assert.deepEqual(both.guides, [{ axis: "y", at: 180, from: 100, to: 550 }]);
});

test("nothing within reach: no move, no lines", () => {
  assert.deepEqual(alignTo({ x: 120, y: 400, w: 50, h: 50 }, [other], 6), { dx: null, dy: null, guides: [] });
  assert.deepEqual(alignTo({ x: 0, y: 0, w: 10, h: 10 }, [], 6), { dx: null, dy: null, guides: [] });
});

test("a line runs across every shape lined up there", () => {
  const third = { x: 100, y: 600, w: 90, h: 40 };
  const out = alignTo({ x: 98, y: 300, w: 60, h: 60 }, [other, third], 6);
  assert.equal(out.dx, 2);
  assert.deepEqual(out.guides, [{ axis: "x", at: 100, from: 100, to: 640 }]);
});

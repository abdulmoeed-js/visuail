/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK_MAX, restack } from "./canvas-layers";

test("bringing to front recounts ranks from 1, whatever came before", () => {
  assert.deepEqual(restack({ a: 40, b: 7, c: undefined }, "c", "front"), { b: 1, a: 2, c: 3 });
  // Clicking the same shape again keeps it on top without growing.
  assert.deepEqual(restack({ b: 1, a: 2, c: 3 }, "c", "front"), { b: 1, a: 2, c: 3 });
  assert.deepEqual(restack({ b: 1, a: 2, c: 3 }, "b", "front"), { a: 1, c: 2, b: 3 });
});

test("sending to back goes behind everything, untouched shapes included", () => {
  assert.deepEqual(restack({ a: 2, b: -1 }, "c", "back"), { a: 1, b: -1, c: -2 });
  // A shape at the front sent back leaves the front ranks.
  assert.deepEqual(restack({ a: 1, b: 2 }, "b", "back"), { a: 1, b: -1 });
});

test("a thousand clicks never push a rank past the top of the scale", () => {
  let ranks: Record<string, number> = {};
  for (let i = 0; i < 1000; i++) ranks = restack(ranks, `s${i % 7}`, "front");
  assert.ok(Math.max(...Object.values(ranks)) <= RANK_MAX);
  assert.equal(Math.max(...Object.values(ranks)), 7);
});

test("the shape sent to the back is kept at the back even when 50 are behind", () => {
  const ranks: Record<string, number> = {};
  for (let i = 0; i < 50; i++) ranks[`b${i}`] = -(i + 1);
  const out = restack(ranks, "new", "back");
  assert.equal(Math.min(...Object.values(out)), out.new);
  assert.ok(Object.values(out).every((z) => z >= -50));
});

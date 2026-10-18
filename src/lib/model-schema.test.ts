/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_SCHEMA, OUTDATED_TITLE, assertCurrent, isOutdated, noteSchema, schemaOf } from "./model-schema";
import { friendlyError } from "./friendly-error";

test("models from before the number count as schema 1", () => {
  assert.equal(schemaOf(undefined), 1);
  assert.equal(schemaOf({}), 1);
  assert.equal(schemaOf({ schema: "2" }), 1);
  assert.equal(schemaOf({ schema: 0 }), 1);
  assert.equal(schemaOf({ schema: Number.NaN }), 1);
  assert.equal(schemaOf({ schema: 3 }), 3);
  assert.equal(schemaOf({ schema: 2.7 }), 2);
});

// One module-wide flag, so these run in this order in one file.
test("only a newer schema marks the page out of date, and it stays marked", () => {
  assert.equal(isOutdated(), false);
  assert.doesNotThrow(assertCurrent);
  noteSchema(MODEL_SCHEMA);
  noteSchema(MODEL_SCHEMA - 1);
  assert.equal(isOutdated(), false);
  noteSchema(MODEL_SCHEMA + 1);
  assert.equal(isOutdated(), true);
  noteSchema(MODEL_SCHEMA);
  assert.equal(isOutdated(), true);
});

test("a write stopped by an out-of-date page says to reload", () => {
  let caught: unknown;
  try { assertCurrent(); } catch (e) { caught = e; }
  const shown = friendlyError(caught, "re-check for drift");
  assert.equal(shown.kind, "outdated");
  assert.equal(shown.title, "Couldn't re-check for drift.");
  assert.ok(shown.detail.startsWith(OUTDATED_TITLE) && /Reload/.test(shown.detail));
});

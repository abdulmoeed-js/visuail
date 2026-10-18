/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLES, type ArtifactModel, type ProcessModel } from "@/data/samples";
import { applyModelDiffToYDoc, modelToYDoc, yDocToModel } from "./yjs-model";
import { removeById } from "./remove-item";
import { placeShapes, setBlockHeight } from "./canvas/layout";

// On the project page every model goes through a Y.Doc and comes back out
// of yDocToModel, which rebuilds it key by key. A key it doesn't name is
// lost there, and then from the database by the next save.

const PROCESS_LISTS = [
  "connections", "nonFunctionalRequirements", "riskLog", "changeRequests", "communicationPlan",
  "testCases", "dataStores", "externalEntities", "decisionTree", "states", "layouts",
] as const;
const BMC_LISTS = ["riskLog", "changeRequests", "communicationPlan", "stakeholders", "layouts"] as const;

/** The model as plain JSON, with absent optional lists as empty ones: the
 *  round trip has always filled those in, and that loses nothing. */
function plain(m: ArtifactModel): unknown {
  const out = JSON.parse(JSON.stringify(m)) as Record<string, unknown>;
  for (const key of m.kind === "process" ? PROCESS_LISTS : BMC_LISTS) out[key] ??= [];
  return out;
}

const models: ArtifactModel[] = SAMPLES.map((s) => s.build()).filter((m): m is ArtifactModel => m !== null);

test("every sample model survives the round trip through a Y.Doc", () => {
  assert.ok(models.some((m) => m.kind === "process") && models.some((m) => m.kind === "bmc"));
  for (const m of models) assert.deepEqual(plain(yDocToModel(modelToYDoc(m))), plain(m), m.title);
});

test("the schema number survives the round trip and changes to it", () => {
  for (const m of models) {
    const v2 = { ...m, schema: 2 } as ArtifactModel;
    const v3 = { ...m, schema: 3 } as ArtifactModel;
    const doc = modelToYDoc(v2);
    assert.equal(yDocToModel(doc).schema, 2);
    applyModelDiffToYDoc(doc, v2, v3);
    assert.equal(yDocToModel(doc).schema, 3);
    applyModelDiffToYDoc(doc, v3, m);
    assert.equal("schema" in yDocToModel(doc), false);
  }
});

test("a delete applied as a diff gives the same model as the delete itself", () => {
  const m = models.find((x): x is ProcessModel => x.kind === "process" && x.steps.length > 2);
  assert.ok(m, "a process sample with steps");
  const doc = modelToYDoc(m);
  const next = removeById(m, m.steps[1].id);
  applyModelDiffToYDoc(doc, m, next);
  assert.deepEqual(plain(yDocToModel(doc)), plain(next));
});

test("hand-made arrangements survive the round trip and changes to them", () => {
  for (const m of models) {
    const arranged = m.kind === "process"
      ? placeShapes(placeShapes(m, "process", {}, { [m.steps[0].id]: { x: 10, y: 20, w: 300 } }), "dfd", {}, { [m.steps[0].id]: { x: -40, y: 5 } })
      : setBlockHeight(m, "value", 240);
    const doc = modelToYDoc(arranged);
    assert.deepEqual(plain(yDocToModel(doc)), plain(arranged), m.title);
    // A move applied as a diff, as the editing hook does.
    const moved = m.kind === "process"
      ? placeShapes(arranged, "process", { [m.steps[0].id]: { x: 400, y: 20 } }, {})
      : setBlockHeight(arranged, "value", 300);
    applyModelDiffToYDoc(doc, arranged, moved);
    assert.deepEqual(plain(yDocToModel(doc)), plain(moved), `${m.title} after a move`);
  }
});

/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BMCModel, ProcessModel, RuleNode } from "@/data/samples";
import { NO_TARGET, removeById, ruleSubtree } from "./remove-item";

const item = (id: string, extra: object = {}) => ({ id, text: id, confidence: 0.9, ...extra });

function processModel(): ProcessModel {
  return {
    kind: "process",
    title: "Onboarding",
    actors: [item("AC1"), item("AC2")],
    systems: [item("SY1")],
    steps: [
      item("ST1", { actorId: "AC1" }),
      item("ST2", { actorId: "AC1", systemId: "SY1", raci: { AC1: "R", AC2: "A" } }),
      item("ST3", { actorId: "AC2" }),
    ],
    decisions: [
      item("DC1", { afterStepId: "ST2", branches: [
        { id: "B1", label: "Yes", targetId: "ST3" },
        { id: "B2", label: "No", targetId: "EX1" },
      ] }),
      // The old two-way shape, read through decisionBranches.
      item("DC2", { afterStepId: "ST1", branches: [], yes: "ST2", no: "ST3" }),
    ],
    exceptions: [item("EX1", { relatedStepId: "ST2" }), item("EX2", { relatedStepId: "ST3" })],
    connections: [
      { id: "CN1", fromId: "ST1", toId: "ST2" },
      { id: "CN2", fromId: "ST3", toId: "EX2" },
    ],
    testCases: [item("TC1", { relatedStepId: "ST2", expectedResult: "ok" })],
    decisionTree: [],
  } as unknown as ProcessModel;
}

test("deleting a step re-points everything that named it", () => {
  const m = processModel();
  const out = removeById(m, "ST2") as ProcessModel;
  assert.deepEqual(out.steps.map((s) => s.id), ["ST1", "ST3"]);
  // The decision after it can't move up: ST1 has its own (DC2), which stays.
  assert.equal(out.decisions.find((d) => d.id === "DC1")!.afterStepId, "");
  assert.equal(out.decisions.find((d) => d.id === "DC2")!.afterStepId, "ST1");
  // Legacy yes/no pointing at it now lead nowhere; the other side is kept.
  const dc2 = out.decisions.find((d) => d.id === "DC2")!;
  assert.equal(dc2.yes, undefined);
  assert.equal(dc2.no, "ST3");
  // Exception and test case about it are no longer about any step.
  assert.equal(out.exceptions.find((e) => e.id === "EX1")!.relatedStepId, undefined);
  assert.equal(out.testCases![0].relatedStepId, undefined);
  // Its connections go; others stay.
  assert.deepEqual(out.connections!.map((c) => c.id), ["CN2"]);
  // Untouched items are the same objects (the shared document skips them).
  assert.equal(out.exceptions.find((e) => e.id === "EX2"), m.exceptions[1]);
  assert.equal(out.steps[1], m.steps[2]);
});

test("a branch whose target is deleted keeps its label and leads nowhere", () => {
  const out = removeById(processModel(), "EX1") as ProcessModel;
  const dc1 = out.decisions.find((d) => d.id === "DC1")!;
  assert.deepEqual(dc1.branches, [
    { id: "B1", label: "Yes", targetId: "ST3" },
    { id: "B2", label: "No", targetId: NO_TARGET },
  ]);
});

test("a decision after a deleted step moves up to the step before, if that one is free", () => {
  const m = processModel();
  m.decisions = m.decisions.filter((d) => d.id !== "DC2");
  const out = removeById(m, "ST2") as ProcessModel;
  assert.equal(out.decisions[0].afterStepId, "ST1");
});

test("a decision after the first step is left unanchored when it goes", () => {
  // Not moved down to ST2: its own "Yes" leads to ST2, which would make a loop.
  const out = removeById(processModel(), "ST1") as ProcessModel;
  assert.equal(out.decisions.find((d) => d.id === "DC2")!.afterStepId, "");
  assert.equal(out.decisions.find((d) => d.id === "DC1")!.afterStepId, "ST2");
});

test("after any step delete, no two decisions share a step that one didn't have before", () => {
  const m = processModel();
  for (const s of m.steps) {
    const out = removeById(m, s.id) as ProcessModel;
    const anchors = out.decisions.map((d) => d.afterStepId).filter(Boolean);
    assert.equal(new Set(anchors).size, anchors.length, `deleting ${s.id}`);
  }
});

test("deleting an actor or a system leaves its steps with nobody or nothing", () => {
  const noActor = removeById(processModel(), "AC1") as ProcessModel;
  assert.deepEqual(noActor.steps.map((s) => s.actorId), ["", "", "AC2"]);
  assert.deepEqual(noActor.steps[1].raci, { AC2: "A" });
  const noSystem = removeById(processModel(), "SY1") as ProcessModel;
  assert.equal("systemId" in noSystem.steps[1], false);
});

test("deleting an id that isn't there leaves every item as it was", () => {
  const m = processModel();
  const out = removeById(m, "NOPE") as ProcessModel;
  for (const key of ["actors", "steps", "decisions", "exceptions", "systems", "connections", "testCases"] as const) {
    const before = m[key] ?? [];
    const after = out[key] ?? [];
    assert.equal(after.length, before.length, key);
    after.forEach((x, i) => assert.equal(x, before[i], `${key}[${i}]`));
  }
});

const tree: RuleNode[] = [
  item("Q1", { branches: [{ id: "a", label: "Yes", targetId: "Q2" }, { id: "b", label: "No", targetId: "O3" }] }),
  item("Q2", { branches: [{ id: "c", label: "Big", targetId: "O1" }, { id: "d", label: "Small", targetId: "O2" }] }),
  item("O1"), item("O2"), item("O3"),
] as RuleNode[];

test("deleting a question takes the answers under it and the branch to it", () => {
  const m = { ...processModel(), decisionTree: tree };
  const out = removeById(m, "Q2") as ProcessModel;
  assert.deepEqual(out.decisionTree!.map((n) => n.id), ["Q1", "O3"]);
  assert.deepEqual(out.decisionTree![0].branches, [{ id: "b", label: "No", targetId: "O3" }]);
});

test("an answer another question also leads to stays, with what is under it", () => {
  const shared: RuleNode[] = [
    ...tree.slice(0, 1),
    item("Q2", { branches: [{ id: "c", label: "Big", targetId: "Q3" }] }),
    item("Q3", { branches: [{ id: "e", label: "Then", targetId: "O1" }] }),
    item("O1"),
    item("O3", { branches: [{ id: "f", label: "Also", targetId: "Q3" }] }),
  ] as RuleNode[];
  assert.deepEqual([...ruleSubtree(shared, "Q2")], ["Q2"]);
  const out = removeById({ ...processModel(), decisionTree: shared }, "Q2") as ProcessModel;
  assert.deepEqual(out.decisionTree!.map((n) => n.id), ["Q1", "Q3", "O1", "O3"]);
});

test("a loop in the tree doesn't stop a delete", () => {
  const loop: RuleNode[] = [
    item("A", { branches: [{ id: "1", label: "", targetId: "B" }] }),
    item("B", { branches: [{ id: "2", label: "", targetId: "A" }] }),
  ] as RuleNode[];
  assert.deepEqual([...ruleSubtree(loop, "A")].sort(), ["A", "B"]);
});

test("business model canvas items delete as before", () => {
  const m: BMCModel = {
    kind: "bmc", title: "BMC",
    blocks: [{ id: "segments", title: "Segments", items: [item("CS1"), item("CS2")] }],
    stakeholders: [item("SH1", { influence: "High", interest: "Low" })],
  } as unknown as BMCModel;
  const out = removeById(m, "CS1") as BMCModel;
  assert.deepEqual(out.blocks[0].items.map((i) => i.id), ["CS2"]);
  assert.equal((removeById(m, "SH1") as BMCModel).stakeholders!.length, 0);
});

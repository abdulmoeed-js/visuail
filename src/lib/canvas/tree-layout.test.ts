/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuleNode } from "@/data/samples";
import { edges, layout } from "./tree-layout";

const node = (id: string, ...targets: string[]): RuleNode => ({
  id, text: id, confidence: 1,
  ...(targets.length ? { branches: targets.map((t, i) => ({ id: `${id}-${i}`, label: `${i}`, targetId: t })) } : {}),
});

// The layout before it learned to draw nodes the main question doesn't reach.
// For an ordinary tree the new one must place every node exactly here.
function oldLayout(nodes: RuleNode[]) {
  const NODE_W = 180, NODE_H = 72, LEVEL_GAP = 120, SIB_GAP = 30, TOP_PAD = 50;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const targeted = new Set<string>();
  for (const n of nodes) for (const b of n.branches ?? []) targeted.add(b.targetId);
  const root = nodes.find((n) => !targeted.has(n.id)) ?? nodes[0];
  const placed: { id: string; cx: number; cy: number }[] = [];
  const widthCache = new Map<string, number>();
  const children = (n: RuleNode, visited: Set<string>) => (n.branches ?? [])
    .map((b) => byId.get(b.targetId)).filter((c): c is RuleNode => !!c && !visited.has(c.id));
  const subtreeWidth = (n: RuleNode, visited: Set<string>): number => {
    if (widthCache.has(n.id)) return widthCache.get(n.id)!;
    const kids = children(n, new Set(visited).add(n.id));
    const w = kids.length === 0 ? NODE_W
      : kids.reduce((sum, c) => sum + subtreeWidth(c, new Set(visited).add(n.id)), 0) + (kids.length - 1) * SIB_GAP;
    const width = Math.max(NODE_W, w);
    widthCache.set(n.id, width);
    return width;
  };
  const assign = (n: RuleNode, left: number, depth: number, visited: Set<string>) => {
    const w = subtreeWidth(n, visited);
    placed.push({ id: n.id, cx: left + w / 2, cy: TOP_PAD + depth * LEVEL_GAP + NODE_H / 2 });
    let cursor = left;
    for (const c of children(n, new Set(visited).add(n.id))) {
      const cw = subtreeWidth(c, new Set(visited).add(n.id));
      assign(c, cursor, depth + 1, new Set(visited).add(n.id));
      cursor += cw + SIB_GAP;
    }
  };
  const totalW = subtreeWidth(root, new Set());
  assign(root, 40, 0, new Set());
  return { placed, width: Math.max(900, totalW + 80) };
}

const TREE = [
  node("Q1", "Q2", "O3", "Q4"),
  node("Q2", "O1", "O2"),
  node("O1"), node("O2"), node("O3"),
  node("Q4", "O5", "O6", "O7"),
  node("O5"), node("O6"), node("O7"),
];

test("an ordinary tree is drawn exactly where it always was", () => {
  const before = oldLayout(TREE);
  const after = layout(TREE);
  assert.equal(after.width, before.width);
  assert.deepEqual(after.placed.map(({ id, cx, cy }) => ({ id, cx, cy })), before.placed);
  assert.ok(after.placed.every((p) => !p.detached));
});

test("nodes the main question doesn't reach are drawn, marked, to its right", () => {
  // O9 lost its question in an older delete; Q8 heads a second tree.
  const nodes = [...TREE, node("O9"), node("Q8", "O10"), node("O10")];
  const { placed } = layout(nodes);
  assert.equal(placed.length, nodes.length);
  const mainRight = Math.max(...placed.filter((p) => TREE.some((n) => n.id === p.id)).map((p) => p.cx));
  for (const id of ["O9", "Q8", "O10"]) {
    const p = placed.find((x) => x.id === id)!;
    assert.ok(p.cx > mainRight, `${id} sits right of the main tree`);
  }
  assert.deepEqual(placed.filter((p) => p.detached).map((p) => p.id), ["O9", "Q8"]);
});

test("a node two questions lead to is drawn once, with both arrows", () => {
  const nodes = [node("Q1", "Q2", "O1"), node("Q2", "O1"), node("O1")];
  const { placed } = layout(nodes);
  assert.deepEqual(placed.map((p) => p.id).sort(), ["O1", "Q1", "Q2"]);
  const into = edges(placed).filter((e) => e.to.id === "O1").map((e) => e.from.id).sort();
  assert.deepEqual(into, ["Q1", "Q2"]);
});

test("a loop is drawn without repeating or hanging", () => {
  const { placed } = layout([node("A", "B"), node("B", "A")]);
  assert.deepEqual(placed.map((p) => p.id), ["A", "B"]);
});

test("an empty tree has no root and the default sheet", () => {
  const out = layout([]);
  assert.equal(out.root, undefined);
  assert.deepEqual([out.width, out.height, out.placed.length], [900, 500, 0]);
});

// Where each node of a decision tree is drawn. Pure, so it can be checked on
// its own (tree-layout.test.ts).

import type { RuleNode } from "@/data/samples";

export const NODE_W = 180, NODE_H = 72;
const LEVEL_GAP = 120;
const SIB_GAP = 30;
const TOP_PAD = 50;
/** Space between the main tree and any tree not connected to it. */
const TREE_GAP = 80;

export interface TreeNode {
  id: string; ref: RuleNode; cx: number; cy: number;
  /** The top of a tree that the main question doesn't lead to. */
  detached?: boolean;
}

/** Places every node, each exactly once. The main tree starts from the first
 *  node nothing leads to. Anything it doesn't reach (left behind by an older
 *  delete, or by data that arrived that way) is drawn as its own tree to the
 *  right and marked, rather than left out of the picture while still in the
 *  data. A node two questions lead to sits under the first; both arrows are
 *  drawn to it. */
export function layout(nodes: RuleNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const targeted = new Set<string>();
  for (const n of nodes) for (const b of n.branches ?? []) if (b.targetId !== n.id) targeted.add(b.targetId);
  const root = nodes.find((n) => !targeted.has(n.id)) ?? nodes[0];

  // One parent per node: the first to reach it, depth first, in branch order.
  const kids = new Map<string, RuleNode[]>();
  const seen = new Set<string>();
  const claim = (n: RuleNode) => {
    seen.add(n.id);
    const own: RuleNode[] = [];
    kids.set(n.id, own);
    for (const b of n.branches ?? []) {
      const c = byId.get(b.targetId);
      if (c && !seen.has(c.id)) { seen.add(c.id); own.push(c); }
    }
    for (const c of own) claim(c);
  };
  const tops: RuleNode[] = [];
  const startFrom = (n: RuleNode | undefined) => { if (n && !seen.has(n.id)) { tops.push(n); claim(n); } };
  startFrom(root);
  // Then other tops nothing leads to, then whatever is left (a loop).
  for (const n of nodes) if (!targeted.has(n.id)) startFrom(n);
  for (const n of nodes) startFrom(n);

  const widthCache = new Map<string, number>();
  const subtreeWidth = (n: RuleNode): number => {
    const cached = widthCache.get(n.id);
    if (cached !== undefined) return cached;
    const own = kids.get(n.id) ?? [];
    const w = own.length === 0
      ? NODE_W
      : own.reduce((sum, c) => sum + subtreeWidth(c), 0) + (own.length - 1) * SIB_GAP;
    const width = Math.max(NODE_W, w);
    widthCache.set(n.id, width);
    return width;
  };

  const placed: TreeNode[] = [];
  const assign = (n: RuleNode, left: number, depth: number, detached: boolean) => {
    const w = subtreeWidth(n);
    placed.push({ id: n.id, ref: n, cx: left + w / 2, cy: TOP_PAD + depth * LEVEL_GAP + NODE_H / 2, ...(detached ? { detached } : {}) });
    let cursor = left;
    for (const c of kids.get(n.id) ?? []) {
      assign(c, cursor, depth + 1, false);
      cursor += subtreeWidth(c) + SIB_GAP;
    }
  };

  if (root) {
    let left = 40;
    tops.forEach((t, i) => {
      assign(t, left, 0, i > 0);
      left += subtreeWidth(t) + TREE_GAP;
    });
    const width = Math.max(900, left - TREE_GAP + 40);
    const maxDepth = Math.max(...placed.map((p) => Math.round((p.cy - TOP_PAD - NODE_H / 2) / LEVEL_GAP)));
    const height = Math.max(500, TOP_PAD + (maxDepth + 1) * LEVEL_GAP + 60);
    return { placed, byId, width, height, root };
  }
  return { placed, byId, width: 900, height: 500, root: undefined };
}

export function edges(placed: TreeNode[]) {
  const posById = new Map(placed.map((p) => [p.id, p]));
  const out: { id: string; from: TreeNode; to: TreeNode; label: string }[] = [];
  for (const p of placed) {
    for (const b of p.ref.branches ?? []) {
      const to = posById.get(b.targetId);
      if (to) out.push({ id: `${p.id}-${b.id}`, from: p, to, label: b.label });
    }
  }
  return out;
}

/** Whether answers lead from `from` to `to` (or it is `to`). A new answer
 *  from A to B is refused when B already leads to A: a tree has no loops,
 *  and deleting part of a loop would take the rest of the tree with it. */
export function leadsTo(tree: RuleNode[], from: string, to: string): boolean {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const todo = [from];
  while (todo.length) {
    const id = todo.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const b of byId.get(id)?.branches ?? []) todo.push(b.targetId);
  }
  return false;
}

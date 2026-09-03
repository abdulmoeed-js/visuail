import { useMemo, useState } from "react";
import type { ProcessModel, RuleNode, DecisionBranch } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Plus, X, GripVertical, Wand2 } from "lucide-react";
import { CanvasShell } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { IdChip } from "./atoms";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Decision Tree -- a standalone recursive rule tree (eligibility rules,
// triage/routing, approval hierarchies), from the corpus's Decision Tree
// Tutorial. Distinct from the process canvas's decision diamonds, which are
// gates *in* a flow. Every node is a RuleNode; a node with no branches is a
// leaf/outcome (rendered as a plain pill), a node with branches is a
// question (rendered as a card with a "N branches" editor popover -- the
// exact pattern already proven for ProcessCanvas's decision diamonds,
// re-used here rather than a true diamond shape specifically because a
// diamond's taper caused real overflow bugs earlier this session; a
// rectangular card with an edit-on-demand popover sidesteps that class of
// bug entirely).

const NODE_W = 180, NODE_H = 72;
const LEVEL_GAP = 120;
const SIB_GAP = 30;
const TOP_PAD = 50;

interface TreeNode { id: string; ref: RuleNode; cx: number; cy: number; }

function layout(nodes: RuleNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const targeted = new Set<string>();
  for (const n of nodes) for (const b of n.branches ?? []) targeted.add(b.targetId);
  const root = nodes.find((n) => !targeted.has(n.id)) ?? nodes[0];

  const placed: TreeNode[] = [];
  const widthCache = new Map<string, number>();

  function children(n: RuleNode, visited: Set<string>): RuleNode[] {
    return (n.branches ?? [])
      .map((b) => byId.get(b.targetId))
      .filter((c): c is RuleNode => !!c && !visited.has(c.id));
  }

  function subtreeWidth(n: RuleNode, visited: Set<string>): number {
    if (widthCache.has(n.id)) return widthCache.get(n.id)!;
    const kids = children(n, new Set(visited).add(n.id));
    const w = kids.length === 0
      ? NODE_W
      : kids.reduce((sum, c) => sum + subtreeWidth(c, new Set(visited).add(n.id)), 0) + (kids.length - 1) * SIB_GAP;
    const width = Math.max(NODE_W, w);
    widthCache.set(n.id, width);
    return width;
  }

  function assign(n: RuleNode, left: number, depth: number, visited: Set<string>) {
    const w = subtreeWidth(n, visited);
    placed.push({ id: n.id, ref: n, cx: left + w / 2, cy: TOP_PAD + depth * LEVEL_GAP + NODE_H / 2 });
    const kids = children(n, new Set(visited).add(n.id));
    let cursor = left;
    for (const c of kids) {
      const cw = subtreeWidth(c, new Set(visited).add(n.id));
      assign(c, cursor, depth + 1, new Set(visited).add(n.id));
      cursor += cw + SIB_GAP;
    }
  }

  if (root) {
    const totalW = subtreeWidth(root, new Set());
    assign(root, 40, 0, new Set());
    const width = Math.max(900, totalW + 80);
    const maxDepth = Math.max(...placed.map((p) => Math.round((p.cy - TOP_PAD - NODE_H / 2) / LEVEL_GAP)));
    const height = Math.max(500, TOP_PAD + (maxDepth + 1) * LEVEL_GAP + 60);
    return { placed, byId, width, height, root };
  }
  return { placed, byId, width: 900, height: 500, root: undefined };
}

function edges(placed: TreeNode[]) {
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

interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

export function DecisionTreeView({ model, editing }: Props) {
  const { placed, width, height, root } = useMemo(() => layout(model.decisionTree ?? []), [model.decisionTree]);
  const flows = useMemo(() => edges(placed), [placed]);

  const addBranch = (node: RuleNode) => {
    const newId = editing.onAddRuleNode("Outcome");
    const branchId = `${node.id}-b${(node.branches ?? []).length}-${Math.random().toString(36).slice(2, 6)}`;
    editing.onUpdateItem(node.id, {
      branches: [...(node.branches ?? []), { id: branchId, label: `Option ${(node.branches ?? []).length + 1}`, targetId: newId } as DecisionBranch],
    });
  };
  const removeBranch = (node: RuleNode, branchId: string) => {
    const branch = (node.branches ?? []).find((b) => b.id === branchId);
    editing.onUpdateItem(node.id, { branches: (node.branches ?? []).filter((b) => b.id !== branchId) });
    if (branch) editing.onDeleteAny(branch.targetId);
  };
  const updateBranch = (node: RuleNode, branchId: string, label: string) => {
    editing.onUpdateItem(node.id, { branches: (node.branches ?? []).map((b) => (b.id === branchId ? { ...b, label } : b)) });
  };

  const insertRoot = () => editing.onAddRuleNode("Root question?");

  return (
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="Decision tree — fullscreen"
      bottomLeft={
        <span className="flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground">
          Click "N branches" to edit · "add branch" turns a leaf into a question
        </span>
      }
    >
      {!root && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground pointer-events-none">
          <span>No decision tree yet.</span>
          <button onClick={insertRoot} data-no-pan className="pointer-events-auto flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs hover:border-primary/60 shadow-sm">
            <Wand2 className="size-3.5 text-primary" /> Add root question
          </button>
        </div>
      )}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none" }}>
        <defs>
          <marker id="dt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
        </defs>
        {flows.map((f) => {
          const from = { x: f.from.cx, y: f.from.cy + NODE_H / 2 };
          const to = { x: f.to.cx, y: f.to.cy - NODE_H / 2 };
          const midY = (from.y + to.y) / 2;
          const path = Math.abs(from.x - to.x) < 4
            ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
            : `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
          return (
            <g key={f.id}>
              <path d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#dt-arrow)" />
              <text x={(from.x + to.x) / 2 + 6} y={midY - 6} fill="var(--color-primary)" fontSize="10" fontFamily="var(--font-mono)">{f.label}</text>
            </g>
          );
        })}
      </svg>

      {placed.map((p) => (
        <RuleNodeView
          key={p.id}
          node={p}
          isRoot={p.id === root?.id}
          onDelete={() => editing.onDeleteAny(p.id)}
          onUpdateText={(text) => editing.onUpdateItem(p.id, { text })}
          onAddBranch={() => addBranch(p.ref)}
          onRemoveBranch={(bid) => removeBranch(p.ref, bid)}
          onUpdateBranch={(bid, label) => updateBranch(p.ref, bid, label)}
        />
      ))}
    </CanvasShell>
  );
}

function RuleNodeView({
  node, isRoot, onDelete, onUpdateText, onAddBranch, onRemoveBranch, onUpdateBranch,
}: {
  node: TreeNode;
  isRoot: boolean;
  onDelete: () => void;
  onUpdateText: (t: string) => void;
  onAddBranch: () => void;
  onRemoveBranch: (branchId: string) => void;
  onUpdateBranch: (branchId: string, label: string) => void;
}) {
  const branches = node.ref.branches ?? [];
  const isLeaf = branches.length === 0;

  // Decision tree nodes are always positioned by the tree layout, recomputed
  // from `branches` on every render -- there's no manual override map or
  // dragging here the way DFD's free-form nodes have one. A tree's shape
  // is a direct consequence of its branches, not something to rearrange
  // independently of them, so "auto-arrange once, freeform after" doesn't
  // apply the same way for this diagram type.
  return (
    <div
      data-node
      onPointerDown={(e) => e.stopPropagation()}
      className={
        isLeaf
          ? "group absolute rounded-full border-2 border-verified/60 bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-center px-3"
          : "group absolute rounded-xl border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      }
      style={{ left: node.cx - NODE_W / 2, top: node.cy - NODE_H / 2, width: NODE_W, height: NODE_H, zIndex: isRoot ? 11 : 10 }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical className="size-3.5 text-muted-foreground/70 shrink-0" />
          <IdChip id={node.id} tone={isRoot ? "primary" : "muted"} />
        </div>
        <button onClick={onDelete} data-no-pan className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0">
          <X className="size-3" />
        </button>
      </div>
      <div className={isLeaf ? "text-xs font-medium leading-snug break-words px-1" : "text-xs font-medium leading-snug break-words"}>
        <InlineEdit value={node.ref.text} onChange={onUpdateText} multiline />
      </div>
      {!isLeaf && (
        <Popover>
          <PopoverTrigger asChild>
            <button data-no-pan className="text-[9px] font-mono-tight text-muted-foreground hover:text-primary underline decoration-dotted underline-offset-2 transition self-start">
              {branches.length} branch{branches.length === 1 ? "" : "es"} ▾
            </button>
          </PopoverTrigger>
          <PopoverContent data-no-pan className="w-60 p-2" align="start">
            <div className="flex flex-col gap-1 text-[11px] font-mono-tight max-h-56 overflow-y-auto">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-1">
                  <InlineEdit value={b.label} onChange={(v) => onUpdateBranch(b.id, v)} className="text-primary" />
                  <button onClick={() => onRemoveBranch(b.id)} className="ml-auto text-muted-foreground hover:text-destructive transition">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={onAddBranch} className="mt-1.5 flex items-center gap-1 text-muted-foreground hover:text-primary transition">
              <Plus className="size-3" /> Add branch
            </button>
          </PopoverContent>
        </Popover>
      )}
      {isLeaf && (
        <button onClick={onAddBranch} data-no-pan className="opacity-0 group-hover:opacity-100 text-[9px] font-mono-tight text-muted-foreground hover:text-primary transition flex items-center gap-0.5">
          <Plus className="size-2.5" /> add branch
        </button>
      )}
    </div>
  );
}

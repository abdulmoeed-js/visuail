import { useMemo, useState } from "react";
import type { ProcessModel, RuleNode, DecisionBranch } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Plus, X, GripVertical, Wand2 } from "lucide-react";
import { CanvasShell } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { isTypingTarget, useArtifactFullscreen } from "./artifact-fullscreen";
import { IdChip } from "./atoms";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NODE_H, NODE_W, edges, layout, type TreeNode } from "@/lib/canvas/tree-layout";
import { ruleSubtree } from "@/lib/remove-item";

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

interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

export function DecisionTreeView({ model, editing }: Props) {
  const { placed, width, height, root } = useMemo(() => layout(model.decisionTree ?? []), [model.decisionTree]);
  const flows = useMemo(() => edges(placed), [placed]);

  const addBranch = (node: RuleNode) => {
    const newId = editing.onAddRuleNode("Outcome");
    // Refused (someone else is editing): already announced, nothing to link.
    if (!newId) return;
    const branchId = `${node.id}-b${(node.branches ?? []).length}-${Math.random().toString(36).slice(2, 6)}`;
    editing.onUpdateItem(node.id, {
      branches: [...(node.branches ?? []), { id: branchId, label: `Option ${(node.branches ?? []).length + 1}`, targetId: newId } as DecisionBranch],
    });
  };
  // Removing an answer removes what it led to, with everything under it --
  // unless another question also leads there. One undo step either way.
  const removeBranch = (node: RuleNode, branchId: string) => {
    const branch = (node.branches ?? []).find((b) => b.id === branchId);
    editing.onUpdateItem(node.id, { branches: (node.branches ?? []).filter((b) => b.id !== branchId) });
    if (!branch) return;
    const sharedTarget = (model.decisionTree ?? []).some((n) =>
      n.id !== node.id && (n.branches ?? []).some((b) => b.targetId === branch.targetId));
    if (!sharedTarget) editing.onDeleteAny(branch.targetId);
  };
  // How many answers a delete takes with it, for the button's label.
  const underCount = (id: string) => ruleSubtree(model.decisionTree ?? [], id).size - 1;
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
      viewId="decisiontree"
      // What is drawn, not the padded sheet: an empty tree has nothing that
      // could be "off-screen".
      shapes={placed.map((p) => ({ x: p.cx - NODE_W / 2, y: p.cy - NODE_H / 2, w: NODE_W, h: NODE_H }))}
      // The root sits centred over its subtree, so a wide tree opened on its
      // left edge would start with the root question off-screen. With no
      // tree yet, aim at the middle, where the empty state is drawn.
      initialFocus={(() => {
        const r = root ? placed.find((p) => p.id === root.id) : undefined;
        return r
          ? { x: r.cx - NODE_W / 2, y: r.cy - NODE_H / 2, w: NODE_W, h: NODE_H }
          : { x: width / 2, y: 0, w: 0, h: 0 };
      })()}
      bottomLeft={
        // How-to-edit hint only, so Present mode hides it with the controls it
        // describes.
        <span data-edit-control className="hidden @min-[640px]:flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground">
          Press a question's branch count to edit its answers · add a branch to turn an outcome into a question
        </span>
      }
    >
      {!root && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground pointer-events-none">
          <span>No decision tree yet.</span>
          <button onClick={insertRoot} data-no-pan data-edit-control className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-separator-strong bg-card px-3 py-1.5 text-xs hover:border-primary/60">
            <Wand2 className="size-3.5 text-primary" /> Add root question
          </button>
        </div>
      )}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
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
          under={underCount(p.id)}
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
  node, isRoot, under, onDelete, onUpdateText, onAddBranch, onRemoveBranch, onUpdateBranch,
}: {
  node: TreeNode;
  isRoot: boolean;
  /** How many answers below this node go with it when it is deleted. */
  under: number;
  onDelete: () => void;
  onUpdateText: (t: string) => void;
  onAddBranch: () => void;
  onRemoveBranch: (branchId: string) => void;
  onUpdateBranch: (branchId: string, label: string) => void;
}) {
  const branches = node.ref.branches ?? [];
  const isLeaf = branches.length === 0;
  // Present mode hides every editing control here (data-edit-control) and
  // shuts a branch editor left open, which would otherwise float, anchored
  // to its hidden trigger, with its add and remove controls.
  const presenting = !!useArtifactFullscreen()?.presenting;
  const [branchesOpen, setBranchesOpen] = useState(false);
  if (presenting && branchesOpen) setBranchesOpen(false);

  // Decision tree nodes are always positioned by the tree layout, recomputed
  // from `branches` on every render -- there's no manual override map or
  // dragging here the way DFD's free-form nodes have one. A tree's shape
  // is a direct consequence of its branches, not something to rearrange
  // independently of them, so "auto-arrange once, freeform after" doesn't
  // apply the same way for this diagram type.
  return (
    <div
      data-node
      // While presenting, a drag that starts on a node moves the view, so
      // the press has to reach the canvas.
      onPointerDown={presenting ? undefined : (e) => e.stopPropagation()}
      className={
        isLeaf
          ? "group absolute rounded-full border-2 border-verified/60 bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-center px-3"
          : "group absolute rounded-xl border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      }
      style={{ left: node.cx - NODE_W / 2, top: node.cy - NODE_H / 2, width: NODE_W, height: NODE_H, zIndex: isRoot ? 11 : 10 }}
    >
      {node.detached && (
        // Above the node, so it doesn't crowd the text. Kept in Present mode:
        // it says something true about the tree.
        <span className="absolute -top-5 left-0 rounded bg-unresolved/15 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
          Not connected to the main tree
        </span>
      )}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical data-edit-control className="size-3.5 text-muted-foreground/70 shrink-0" />
          <IdChip id={node.id} tone={isRoot ? "primary" : "muted"} />
        </div>
        <button
          onClick={onDelete} data-no-pan data-edit-control
          aria-label={`Delete ${isLeaf ? "outcome" : "question"} ${node.ref.text}${under > 0 ? ` and the ${under === 1 ? "answer" : `${under} answers`} under it` : ""}`}
          title={under > 0 ? `Delete this and the ${under === 1 ? "answer" : `${under} answers`} under it` : "Delete"}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className={isLeaf ? "text-xs font-medium leading-snug break-words px-1" : "text-xs font-medium leading-snug break-words"}>
        <InlineEdit value={node.ref.text} onChange={onUpdateText} multiline />
      </div>
      {!isLeaf && (
        <Popover open={branchesOpen && !presenting} onOpenChange={setBranchesOpen}>
          <PopoverTrigger asChild>
            <button data-no-pan data-edit-control className="text-[9px] font-mono-tight text-muted-foreground hover:text-primary underline decoration-dotted underline-offset-2 transition self-start">
              {branches.length} branch{branches.length === 1 ? "" : "es"} ▾
            </button>
          </PopoverTrigger>
          <PopoverContent
            data-no-pan className="w-60 p-2" align="start"
            // Esc while typing a branch label cancels that edit and leaves the
            // editor open; the next Esc closes it.
            onEscapeKeyDown={(e) => { if (isTypingTarget(e.target)) e.preventDefault(); }}
          >
            <div className="flex flex-col gap-1 px-2 py-1 text-[11px] font-mono-tight max-h-56 overflow-y-auto">
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-1">
                  <InlineEdit value={b.label} onChange={(v) => onUpdateBranch(b.id, v)} className="text-primary" />
                  <button onClick={() => onRemoveBranch(b.id)} data-edit-control aria-label={`Remove branch ${b.label}`} className="ml-auto text-muted-foreground hover:text-destructive transition">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={onAddBranch} data-edit-control className="mt-1.5 flex items-center gap-1 text-muted-foreground hover:text-primary transition">
              <Plus className="size-3" /> Add branch
            </button>
          </PopoverContent>
        </Popover>
      )}
      {isLeaf && (
        <button onClick={onAddBranch} data-no-pan data-edit-control className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-[9px] font-mono-tight text-muted-foreground hover:text-primary transition flex items-center gap-0.5">
          <Plus className="size-2.5" /> Add branch
        </button>
      )}
    </div>
  );
}

import { Fragment, useMemo, useRef, useState } from "react";
import type { ProcessModel, RuleNode, DecisionBranch } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Plus, X, GripVertical, Wand2 } from "lucide-react";
import { CanvasShell, type CanvasApi } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { SelectionBar, SelectionOutlines, SnapGuides, useShapeSelection } from "./canvas-selection";
import { ConnectHandles, ConnectorEnds, ConnectorPreview, LineBar, useConnectorDrag } from "./canvas-connectors";
import { LineLabel } from "./LineLabel";
import { LAYER } from "./canvas-layers";
import { DeleteX } from "./canvas-controls";
import { useGrownHeights } from "./use-grown-heights";
import { InlineEdit } from "./InlineEdit";
import { isTypingTarget, useArtifactFullscreen } from "./artifact-fullscreen";
import { IdChip } from "./atoms";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NODE_H, NODE_W, layout as treeLayout, leadsTo } from "@/lib/canvas/tree-layout";
import { connectorRoute, type Point } from "@/lib/canvas/connector";
import { roundedPath } from "@/lib/canvas/geometry";
import { SAVE_LAYOUTS, layoutOf } from "@/lib/canvas/layout";
import { ruleSubtree } from "@/lib/remove-item";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Decision Tree -- a standalone recursive rule tree (eligibility rules,
// triage/routing, approval hierarchies), from the corpus's Decision Tree
// Tutorial. Distinct from the process canvas's decision diamonds, which are
// gates *in* a flow. Every node is a RuleNode; a node with no branches is a
// leaf/outcome (rendered as a plain pill), a node with branches is a
// question (a card with an "N branches" editor).
//
// It edits like the other diagrams (canvas-selection.tsx, canvas-connectors.tsx):
// select, move (the tree lays itself out until a shape is moved; Tidy up
// puts it back), snap guides, double-click to type, shapes that grow with
// their text, copy and paste. Its lines ARE its answers: drawing a line from
// a node adds an answer leading there, re-attaching a line moves the answer,
// and deleting one removes the answer (what it led to stays, marked as not
// connected, until deleted itself).

interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

/** A node where it is drawn. */
interface Placed { id: string; ref: RuleNode; cx: number; cy: number; w: number; h: number; detached?: boolean }
type Pos = Record<string, { cx: number; cy: number }>;
/** An answer, drawn as a line from its question to where it leads. */
interface Answer { id: string; ownerId: string; branch: DecisionBranch; fromId: string; toId: string }

const rectOf = (p: Placed) => ({ x: p.cx - p.w / 2, y: p.cy - p.h / 2, w: p.w, h: p.h });

export function DecisionTreeView({ model, editing }: Props) {
  const tree = useMemo(() => model.decisionTree ?? [], [model.decisionTree]);
  const [overrides, setOverrides] = useCanvasViewState<Pos>("decisiontree:overrides", {});
  const saved = layoutOf(model, "decisiontree")?.nodes;
  // Shapes grow with their text; lines and outlines follow.
  const grown = useGrownHeights();
  const { placed, width, height, root } = useMemo(() => {
    const t = treeLayout(tree);
    const placed: Placed[] = t.placed.map((p) => {
      const h = Math.max(NODE_H, grown.heights[p.id] ?? 0);
      const o = overrides[p.id], sv = saved?.[p.id];
      return {
        id: p.id, ref: p.ref, w: NODE_W, h, detached: p.detached,
        cx: o?.cx ?? (sv ? sv.x + NODE_W / 2 : p.cx),
        cy: o?.cy ?? (sv ? sv.y + h / 2 : p.cy),
      };
    });
    return {
      placed, root: t.root,
      width: Math.max(t.width, ...placed.map((p) => p.cx + p.w / 2 + 40)),
      height: Math.max(t.height, ...placed.map((p) => p.cy + p.h / 2 + 60)),
    };
  }, [tree, overrides, saved, grown.heights]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const presenting = !!useArtifactFullscreen()?.presenting;
  const shellApi = useRef<CanvasApi | null>(null);

  // ---- Answers (the lines) ----
  const answers = useMemo<Answer[]>(() => tree.flatMap((n) => (n.branches ?? [])
    .filter((b) => byId.has(b.targetId) && b.targetId !== n.id)
    .map((b) => ({ id: `${n.id}-${b.id}`, ownerId: n.id, branch: b, fromId: n.id, toId: b.targetId }))), [tree, byId]);
  const answerIds = useMemo(() => new Set(answers.map((a) => a.id)), [answers]);
  const answerOf = (lineId: string) => answers.find((a) => a.id === lineId);
  /** A line to select once it is drawn under a new id (see reattach). */
  const reselect = useRef<string | null>(null);
  const nodeOf = (id: string) => tree.find((n) => n.id === id);
  const branchesOf = (id: string) => nodeOf(id)?.branches ?? [];
  const newBranchId = (ownerId: string) => `${ownerId}-b${branchesOf(ownerId).length}-${Math.random().toString(36).slice(2, 6)}`;
  /** Why an answer from one node to another can't be added, if it can't. */
  const refusal = (fromId: string, toId: string) =>
    fromId === toId ? "A node can't answer itself."
    : branchesOf(fromId).some((b) => b.targetId === toId) ? "That answer is already there."
    : leadsTo(tree, toId, fromId) ? "That would make a loop: it already leads back here."
    : null;
  const refuse = (why: string) => toast("Can't add that answer", { description: why });
  /** A new answer from one node to another (drawing a line). */
  const addAnswer = (fromId: string, toId: string) => {
    const why = refusal(fromId, toId);
    if (why) { refuse(why); return; }
    const own = branchesOf(fromId);
    editing.onUpdateItem(fromId, { branches: [...own, { id: newBranchId(fromId), label: `Option ${own.length + 1}`, targetId: toId } as DecisionBranch] });
  };
  /** Takes an answer off its question; what it led to stays. */
  const dropAnswer = (lineId: string) => {
    const a = answerOf(lineId);
    if (a) editing.onUpdateItem(a.ownerId, { branches: branchesOf(a.ownerId).filter((b) => b.id !== a.branch.id) });
  };
  /** Moves one end of an answer: where it leads, or which node gives it. */
  const reattach = (lineId: string, end: "from" | "to", id: string) => {
    const a = answerOf(lineId);
    if (!a || id === (end === "from" ? a.fromId : a.toId)) return;
    // The same checks as a new answer, for where it would now go.
    const why = end === "to" ? refusal(a.ownerId, id) : refusal(id, a.toId);
    if (why) { refuse(why); return; }
    if (end === "to") {
      editing.onUpdateItem(a.ownerId, { branches: branchesOf(a.ownerId).map((b) => (b.id === a.branch.id ? { ...b, targetId: id } : b)) });
      return;
    }
    // Moved to another question: one undo step, the same answer (and still
    // selected, under its new line id).
    editing.onUpdateItem(a.ownerId, { branches: branchesOf(a.ownerId).filter((b) => b.id !== a.branch.id) });
    editing.onUpdateItem(id, { branches: [...branchesOf(id), a.branch] });
    reselect.current = `${id}-${a.branch.id}`;
  };
  const relabel = (lineId: string, label: string) => {
    const a = answerOf(lineId);
    if (a) editing.onUpdateItem(a.ownerId, { branches: branchesOf(a.ownerId).map((b) => (b.id === a.branch.id ? { ...b, label } : b)) });
  };

  // Adding an answer from the branch editor makes a new outcome for it.
  const addBranch = (node: RuleNode) => {
    const newId = editing.onAddRuleNode("Outcome");
    // Refused (someone else is editing): already announced, nothing to link.
    if (!newId) return;
    editing.onUpdateItem(node.id, {
      branches: [...(node.branches ?? []), { id: newBranchId(node.id), label: `Option ${(node.branches ?? []).length + 1}`, targetId: newId } as DecisionBranch],
    });
  };
  // Removing an answer in the branch editor removes what it led to, with
  // everything under it -- unless another question also leads there. One
  // undo step either way.
  const removeBranch = (node: RuleNode, branchId: string) => {
    const branch = (node.branches ?? []).find((b) => b.id === branchId);
    editing.onUpdateItem(node.id, { branches: (node.branches ?? []).filter((b) => b.id !== branchId) });
    if (!branch) return;
    const sharedTarget = tree.some((n) =>
      (n.branches ?? []).some((b) => b.id !== branchId && b.targetId === branch.targetId));
    // A loop (from older data): what it led to also leads back here, and
    // deleting it would delete this question too.
    if (!sharedTarget && !leadsTo(tree, branch.targetId, node.id)) editing.onDeleteAny(branch.targetId);
  };
  // How many answers a delete takes with it, for the button's label.
  const underCount = (id: string) => ruleSubtree(tree, id).size - 1;
  const updateBranch = (node: RuleNode, branchId: string, label: string) => {
    editing.onUpdateItem(node.id, { branches: (node.branches ?? []).map((b) => (b.id === branchId ? { ...b, label } : b)) });
  };
  const insertRoot = () => editing.onAddRuleNode("Root question?");

  // ---- Moving, selecting, keys, copy and paste ----
  const noteMove = useNoteLayoutMove();
  const rectsById = useMemo(() => new Map(placed.map((p) => [p.id, rectOf(p)])), [placed]);
  const currentPlaces = () => Object.fromEntries(placedRef.current.map((p) => [p.id, { x: p.cx - p.w / 2, y: p.cy - p.h / 2 }]));
  const sizeOf = (id: string) => {
    const p = placedRef.current.find((x) => x.id === id);
    return p ? { w: p.w, h: p.h } : { w: NODE_W, h: NODE_H };
  };
  const shapeName = (id: string) => {
    const n = nodeOf(id);
    if (!n) return id;
    return `${(n.branches ?? []).length > 0 ? "Question" : "Outcome"} “${n.text}”`;
  };
  const lineName = (lineId: string) => {
    const a = answerOf(lineId);
    return a ? `Answer “${a.branch.label}” from ${shapeName(a.fromId)} to ${shapeName(a.toId)}` : "Answer";
  };
  const shapeList = [...rectsById.keys()].map((id) => ({ id, name: shapeName(id) }));
  const sel = useShapeSelection({
    view: "decisiontree", model, rects: rectsById, shellApi, presenting,
    lines: answerIds, onDeleteLine: dropAnswer,
    nameOf: shapeName, lineNameOf: lineName,
    canEdit: editing.canEdit,
    preview: (places) => {
      if (!SAVE_LAYOUTS) noteMove(model);
      setOverrides((cur) => {
        const next = { ...cur };
        for (const [id, p] of Object.entries(places)) { const z = sizeOf(id); next[id] = { cx: p.x + z.w / 2, cy: p.y + z.h / 2 }; }
        return next;
      });
    },
    commit: (places, mergeKey) => {
      if (!SAVE_LAYOUTS) return;
      editing.onPlaceShapes("decisiontree", places, currentPlaces(), mergeKey);
      setOverrides((cur) => { const next = { ...cur }; for (const id of Object.keys(places)) delete next[id]; return next; });
    },
    onDeleteMany: editing.onDeleteMany,
    onPaste: (clip, dx, dy) => {
      const made = editing.onPasteShapes("decisiontree", clip, dx, dy, currentPlaces());
      if (made && !SAVE_LAYOUTS) {
        setOverrides((cur) => {
          const next = { ...cur };
          for (const id of made.ids) { const p = made.places[id]; if (p) { const z = sizeOf(id); next[id] = { cx: p.x + z.w / 2, cy: p.y + z.h / 2 }; } }
          return next;
        });
      }
      return made;
    },
  });
  if (reselect.current && answerIds.has(reselect.current)) {
    const id = reselect.current;
    reselect.current = null;
    queueMicrotask(() => sel.selectLine(id));
  }
  const arranged = !!saved || Object.keys(overrides).some((id) => byId.has(id));
  const tidyUp = () => {
    if (saved && !editing.onTidyUp("decisiontree")) return;
    setOverrides({});
  };

  // ---- Drawing and re-attaching lines ----
  const connect = useConnectorDrag({ shellApi, rects: rectsById, canEdit: editing.canEdit });
  const startConnDrag = (fromId: string, e: React.PointerEvent, from: Point) =>
    connect.start(e, from, { exclude: fromId, done: (toId) => addAnswer(fromId, toId) });
  const startEndDrag = (a: Answer, end: "from" | "to", e: React.PointerEvent, fixed: Point) =>
    connect.start(e, fixed, { exclude: end === "from" ? a.toId : a.fromId, done: (id) => reattach(a.id, end, id) });
  const routeOf = (a: Answer) => {
    const f = rectsById.get(a.fromId), t = rectsById.get(a.toId);
    return f && t ? connectorRoute(f, t) : null;
  };

  // The selection bar and the line bar sit right after their shape or line
  // in the page, so Tab goes shape, its bar, the next shape.
  const barAfter = (id: string) => presenting || sel.selection.ids[0] !== id ? null : (
    <SelectionBar
      ids={sel.selection.ids} rects={rectsById} actions={sel.actions}
      connect={{
        what: "answer", targets: shapeList.filter((t) => !refusal(sel.selection.ids[0], t.id)),
        onPick: (to) => addAnswer(sel.selection.ids[0], to),
      }}
    />
  );
  const lineBarAfter = (a: Answer) => {
    const r = presenting || sel.line !== a.id ? null : routeOf(a);
    return r ? (
      <LineBar
        lineId={a.id} at={r.mid} fromId={a.fromId} toId={a.toId} what="answer"
        // Only ends that keep it a tree (no loops, no second identical answer).
        shapes={shapeList.filter((t) => t.id === a.fromId || t.id === a.toId || (!refusal(a.ownerId, t.id) || !refusal(t.id, a.toId)))}
        onChange={(end, id) => reattach(a.id, end, id)}
        onDelete={() => dropAnswer(a.id)}
      />
    ) : null;
  };

  return (
    // The frame the selection keys answer for (canvas-selection.tsx).
    <div ref={(el) => { sel.frameRef.current = el; grown.rootRef.current = el; }} className="h-full w-full">
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="Decision tree"
      viewId="decisiontree"
      apiRef={shellApi}
      onSelectBox={sel.onSelectBox}
      onBackgroundPress={sel.onBackgroundPress}
      // What is drawn, not the padded sheet: an empty tree has nothing that
      // could be "off-screen".
      shapes={placed.map(rectOf)}
      // The root sits centred over its subtree, so a wide tree opened on its
      // left edge would start with the root question off-screen. With no
      // tree yet, aim at the middle, where the empty state is drawn.
      initialFocus={(() => {
        const r = root ? byId.get(root.id) : undefined;
        return r ? rectOf(r) : { x: width / 2, y: 0, w: 0, h: 0 };
      })()}
      bottomLeft={
        // How-to-edit hint only, so Present mode hides it with the controls it
        // describes.
        <span data-edit-control className="hidden @min-[640px]:flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-2xs font-mono-tight text-muted-foreground">
          Click to select · drag to move · double-click to type · drag a side dot to another node to add an answer
        </span>
      }
      bottomRight={arranged ? (
        <button onClick={tidyUp} data-no-pan className="h-8 px-2.5 rounded-md border bg-card/95 text-xs flex items-center gap-1.5 hover:bg-muted"
          title="Lay the tree out again from its answers">
          <Wand2 className="size-3.5" /> Tidy up
        </button>
      ) : undefined}
    >
      {!root && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground pointer-events-none">
          <span>No decision tree yet.</span>
          <button onClick={insertRoot} data-no-pan data-edit-control className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-separator-strong bg-card px-3 py-1.5 text-xs hover:border-primary/60">
            <Wand2 className="size-3.5 text-primary" /> Add root question
          </button>
        </div>
      )}
      {!presenting && <SelectionOutlines ids={sel.selection.ids} rects={rectsById} round={leafIds(placed)} />}
      {!presenting && <SnapGuides guides={sel.guides} />}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
        <defs>
          <marker id="dt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
        </defs>
        {answers.map((a) => {
          const r = routeOf(a);
          if (!r) return null;
          const path = roundedPath(r.points);
          const selected = sel.line === a.id;
          return (
            <g key={a.id}>
              {/* A wide, invisible stroke to click: selects the answer; a
               *  double-click types its label. */}
              {!presenting && (
                <path
                  d={path} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke"
                  data-no-pan data-edit-control className="cursor-pointer"
                  onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); sel.selectLine(a.id); }}
                  onDoubleClick={() => sel.editLineLabel(a.id)}
                />
              )}
              {selected && (
                <path d={path} fill="none" stroke="var(--color-primary)" strokeOpacity={0.6} strokeWidth={7}
                  strokeLinecap="round" pointerEvents="none" data-edit-control />
              )}
              <path d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#dt-arrow)" />
            </g>
          );
        })}
      </svg>

      {placed.map((p) => (
        <Fragment key={p.id}>
          <RuleNodeView
            node={p}
            under={underCount(p.id)}
            onPress={(e) => sel.pressShape(p.id, e)}
            onGrip={(e) => {
              // A grip on one of several selected shapes moves them all; on
              // any other, just that shape. Either way with snap guides.
              const ids = sel.selection.ids;
              sel.dragSelection(e, ids.length > 1 && ids.includes(p.id) ? ids : [p.id]);
            }}
            onDelete={() => editing.onDeleteAny(p.id)}
            onUpdateText={(text) => editing.onUpdateItem(p.id, { text })}
            onAddBranch={() => addBranch(p.ref)}
            onRemoveBranch={(bid) => removeBranch(p.ref, bid)}
            onUpdateBranch={(bid, label) => updateBranch(p.ref, bid, label)}
            onStartConnect={(e, from) => startConnDrag(p.id, e, from)}
          />
          {barAfter(p.id)}
        </Fragment>
      ))}

      {answers.map((a) => {
        const m = routeOf(a)?.mid;
        if (!m) return null;
        return (
          <Fragment key={`lbl-${a.id}`}>
            <LineLabel
              lineId={a.id} x={m.x} y={m.y} onSelect={() => sel.selectLine(a.id)} name={lineName(a.id)}
              value={a.branch.label} placeholder="Add answer"
              fieldLabel="Answer"
              onChange={(label) => relabel(a.id, label)}
              onDelete={() => dropAnswer(a.id)}
              deleteLabel={`Delete answer${a.branch.label ? ` ${a.branch.label}` : ""}`}
            />
            {lineBarAfter(a)}
          </Fragment>
        );
      })}
      {!presenting && <ConnectorPreview live={connect.live} rects={rectsById} color="var(--color-primary)" />}
      {!presenting && (() => {
        const a = answers.find((x) => x.id === sel.line);
        const r = a && routeOf(a);
        if (!a || !r) return null;
        const p0 = r.points[0], p1 = r.points[r.points.length - 1];
        return <ConnectorEnds from={p0} to={p1} onStart={(e, end) => startEndDrag(a, end, e, end === "from" ? p1 : p0)} />;
      })()}
    </CanvasShell>
    {sel.liveRegion}
    {sel.pasteDialog}
    </div>
  );
}

/** Outcomes are drawn as pills: their selection outline follows the curve. */
function leafIds(placed: Placed[]) {
  return new Set(placed.filter((p) => (p.ref.branches ?? []).length === 0).map((p) => p.id));
}

function RuleNodeView({
  node, under, onPress, onGrip, onDelete, onUpdateText, onAddBranch, onRemoveBranch, onUpdateBranch, onStartConnect,
}: {
  node: Placed;
  /** How many answers below this node go with it when it is deleted. */
  under: number;
  /** A press on the body: select, and drag the selection. */
  onPress: (e: React.PointerEvent) => void;
  /** A press on the grip: drag this node (or the selection it is in). */
  onGrip: (e: React.PointerEvent) => void;
  onDelete: () => void;
  onUpdateText: (t: string) => void;
  onAddBranch: () => void;
  onRemoveBranch: (branchId: string) => void;
  onUpdateBranch: (branchId: string, label: string) => void;
  onStartConnect: (e: React.PointerEvent, from: Point) => void;
}) {
  const branches = node.ref.branches ?? [];
  const isLeaf = branches.length === 0;
  // Present mode hides every editing control here (data-edit-control) and
  // shuts a branch editor left open, which would otherwise float, anchored
  // to its hidden trigger, with its add and remove controls.
  const presenting = !!useArtifactFullscreen()?.presenting;
  const [branchesOpen, setBranchesOpen] = useState(false);
  if (presenting && branchesOpen) setBranchesOpen(false);

  return (
    <div
      data-node data-shape-id={node.id}
      onPointerDown={onPress}
      className={cn(
        "group absolute border-2 border-primary/60 bg-card shadow-sm flex flex-col",
        isLeaf ? "rounded-full items-center justify-center gap-0.5 text-center px-3" : "rounded-xl gap-1 px-2.5 py-2",
      )}
      // Its own height at least, taller when the text needs it.
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, minHeight: NODE_H, zIndex: LAYER.shape }}
    >
      {node.detached && (
        // Above the node, so it doesn't crowd the text. Kept in Present mode:
        // it says something true about the tree.
        <span className="absolute -top-5 left-0 rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-foreground">
          Not connected to the main tree
        </span>
      )}
      <div className="flex items-center justify-between gap-1 self-stretch">
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical
            data-no-pan data-edit-control aria-hidden
            onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onGrip(e); }}
            className="size-3.5 text-muted-foreground/70 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
          />
          <IdChip id={node.id} tone={node.detached ? "muted" : "primary"} />
        </div>
        <DeleteX
          label={`Delete ${isLeaf ? "outcome" : "question"} “${node.ref.text}”${under > 0 ? ` and the ${under === 1 ? "answer" : `${under} answers`} under it` : ""}`}
          onClick={onDelete}
        />
      </div>
      <div className={isLeaf ? "text-xs font-medium leading-snug break-words px-1" : "text-xs font-medium leading-snug break-words"}>
        <InlineEdit value={node.ref.text} onChange={onUpdateText} multiline activate="double" label={isLeaf ? "Outcome" : "Question"} />
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
      <ConnectHandles rect={rectOf(node)} onStart={onStartConnect} />
    </div>
  );
}

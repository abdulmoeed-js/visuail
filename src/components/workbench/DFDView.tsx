import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessModel, Connection, NodeLayout } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Plus, X, GripVertical, Database, Square, CircleDot, Wand2 } from "lucide-react";
import { CanvasShell, followPointer, useWorldDrag } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { useRevealNew, FlashRing } from "./canvas-reveal";
import { SelectionBar, SelectionOutlines, SnapGuides, useShapeSelection } from "./canvas-selection";
import { InlineEdit } from "./InlineEdit";
import { LineLabel } from "./LineLabel";
import { useGrownHeights } from "./use-grown-heights";
import { edgePoint, roundedPath } from "@/lib/canvas/geometry";
import { SAVE_LAYOUTS, layoutOf, placeClear } from "@/lib/canvas/layout";
import { IdChip } from "./atoms";
import { useArtifactFullscreen } from "./artifact-fullscreen";

// Data Flow Diagram (Gane-Sarson notation, per the DFD Tutorial in the BA
// corpus): processes (numbered rounded rects), data stores (open-ended
// rects, "Dn"), external entities (plain rects), and labeled directional
// flows between them.
//
// Deliberately NOT built on ProcessCanvas's spine-layout engine -- a DFD's
// whole point is showing data movement direction between freely-arranged
// nodes, not a top-to-bottom process sequence. Follows the session's
// "auto-arrange once, freeform after" direction: a simple three-row starting
// layout (entities / processes / stores), then plain drag from there.
// Processes reuse the model's existing `steps` array (a DFD process is
// structurally just a labeled step); flows reuse the existing
// `Connection`/`onAddConnection` machinery. Only data stores and external
// entities are new node types.

const PROC_W = 190, PROC_H = 90;
const STORE_W = 210, STORE_H = 56;
const ENTITY_W = 170, ENTITY_H = 64;
const ROW_GAP = 140;
const COL_GAP = 60;
const TOP_PAD = 60;

type NodeKind = "process" | "store" | "entity";
interface DFDNode {
  kind: NodeKind;
  id: string;
  text: string;
  label: string; // "1.0" / "D1" / entity has none
  cx: number; cy: number; w: number; h: number;
  /** The kind's own height; `h` is taller when the text needs it. */
  baseH: number;
}

type Pos = Record<string, { cx: number; cy: number }>;
/** The saved arrangement, by item id (top-left corners). */
type Saved = Record<string, NodeLayout>;
/** How tall shapes grew with their text, by id (see useGrownHeights). */
type Grown = Record<string, number>;

function layoutRow(ids: { id: string; text: string }[], y: number, w: number, baseH: number, labelFor: (i: number) => string, kind: NodeKind, overrides: Pos, saved: Saved | undefined, floating: Set<string>, grown: Grown): DFDNode[] {
  const totalW = ids.length * w + Math.max(0, ids.length - 1) * COL_GAP;
  const startX = Math.max(40, 500 - totalW / 2);
  return ids.map((it, i) => {
    const naturalCx = startX + i * (w + COL_GAP) + w / 2;
    const h = Math.max(baseH, grown[it.id] ?? 0);
    const o = overrides[it.id], sv = saved?.[it.id];
    if (saved && !sv && !o) floating.add(it.id);
    return {
      kind, id: it.id, text: it.text, label: labelFor(i),
      cx: o?.cx ?? (sv ? sv.x + w / 2 : naturalCx), cy: o?.cy ?? (sv ? sv.y + h / 2 : y), w, h, baseH,
    };
  });
}

/** Three rows (entities, processes, stores) until the person arranges the
 *  diagram; then their saved places, with a drag in progress drawn on top.
 *  In an arranged diagram a new node starts at its row place, moved down
 *  until it is clear of the others. */
function layout(model: ProcessModel, overrides: Pos, saved: Saved | undefined, grown: Grown) {
  const floating = new Set<string>();
  const entities = layoutRow(model.externalEntities ?? [], TOP_PAD + ENTITY_H / 2, ENTITY_W, ENTITY_H, () => "", "entity", overrides, saved, floating, grown);
  const processes = layoutRow(model.steps, TOP_PAD + ENTITY_H + ROW_GAP + PROC_H / 2, PROC_W, PROC_H, (i) => `${i + 1}.0`, "process", overrides, saved, floating, grown);
  const stores = layoutRow(model.dataStores ?? [], TOP_PAD + ENTITY_H + ROW_GAP + PROC_H + ROW_GAP + STORE_H / 2, STORE_W, STORE_H, (i) => `D${i + 1}`, "store", overrides, saved, floating, grown);
  const all = [...entities, ...processes, ...stores];
  if (floating.size > 0) {
    const rectOf = (n: DFDNode) => ({ x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h });
    const taken = all.filter((n) => !floating.has(n.id)).map(rectOf);
    for (const n of all) {
      if (!floating.has(n.id)) continue;
      const r = placeClear(rectOf(n), taken, 24);
      n.cx = r.x + n.w / 2;
      n.cy = r.y + n.h / 2;
      taken.push(r);
    }
  }
  const width = Math.max(1000, ...all.map((n) => n.cx + n.w / 2 + 60));
  const height = Math.max(600, ...all.map((n) => n.cy + n.h / 2 + 60));
  return { nodes: all, width, height };
}


interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

export function DFDView({ model, editing }: Props) {
  // Dragged positions are view state; kept in the artifact's view store so
  // they survive a tab switch (see canvas-view-store.tsx).
  const [overrides, setOverrides] = useCanvasViewState<Pos>("dfd:overrides", {});
  const [pendingConn, setPendingConn] = useState<null | { fromId: string; fromX: number; fromY: number; toX: number; toY: number }>(null);
  const saved = layoutOf(model, "dfd")?.nodes;
  // Shapes grow with their text; lines and outlines follow (use-grown-heights).
  const grown = useGrownHeights();
  const { nodes, width, height } = useMemo(() => layout(model, overrides, saved, grown.heights), [model, overrides, saved, grown.heights]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const rectFor = (id: string) => {
    const n = byId.get(id);
    return n ? { x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h } : null;
  };
  const { apiRef: shellApi, revealNew, flashId } = useRevealNew(rectFor);
  const flows = model.connections ?? [];

  const noteMove = useNoteLayoutMove();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  /** A move: drawn live while it lasts; saved, as one undo step, when it
   *  ends (see SAVE_LAYOUTS). */
  const patchPos = (id: string, cx: number, cy: number, done?: boolean) => {
    // Only a real move counts: pressing a node's grip without dragging runs
    // this too, with the position it already has.
    const at = byId.get(id);
    if (!SAVE_LAYOUTS && (!at || at.cx !== cx || at.cy !== cy)) noteMove(model);
    setOverrides((cur) => ({ ...cur, [id]: { cx, cy } }));
    if (!done || !SAVE_LAYOUTS) return;
    const now = nodesRef.current;
    const n = now.find((x) => x.id === id);
    if (!n) return;
    editing.onPlaceShapes("dfd", { [id]: { x: cx - n.w / 2, y: cy - n.h / 2 } },
      Object.fromEntries(now.map((x) => [x.id, { x: x.cx - x.w / 2, y: x.cy - x.h / 2 }])));
    // The saved place draws it from now on.
    setOverrides((cur) => { const next = { ...cur }; delete next[id]; return next; });
  };
  const tidyUp = () => { if (editing.onTidyUp("dfd")) setOverrides({}); };

  const presenting = !!useArtifactFullscreen()?.presenting;
  // Selecting nodes (click, Shift-click, a box), moving them together, the
  // keys, copy and paste (canvas-selection.tsx).
  const rectsById = useMemo(() => new Map(nodes.map((n) => [n.id, { x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h }])), [nodes]);
  const sizeOf = (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (n) return { w: n.w, h: n.h };
    return id.startsWith("DS-") ? { w: STORE_W, h: STORE_H } : id.startsWith("EE-") ? { w: ENTITY_W, h: ENTITY_H } : { w: PROC_W, h: PROC_H };
  };
  const sel = useShapeSelection({
    view: "dfd", model, rects: rectsById, shellApi, presenting,
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
      const now = nodesRef.current;
      editing.onPlaceShapes("dfd", places, Object.fromEntries(now.map((x) => [x.id, { x: x.cx - x.w / 2, y: x.cy - x.h / 2 }])), mergeKey);
      setOverrides((cur) => { const next = { ...cur }; for (const id of Object.keys(places)) delete next[id]; return next; });
    },
    onDeleteMany: editing.onDeleteMany,
    onPaste: (clip, dx, dy) => {
      const now = nodesRef.current;
      const made = editing.onPasteShapes("dfd", clip, dx, dy, Object.fromEntries(now.map((x) => [x.id, { x: x.cx - x.w / 2, y: x.cy - x.h / 2 }])));
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

  const startConnDrag = (fromId: string, e: React.PointerEvent, contentEl: HTMLElement | null) => {
    const from = byId.get(fromId);
    if (!from) return;
    setPendingConn({ fromId, fromX: from.cx + from.w / 2, fromY: from.cy, toX: from.cx + from.w / 2, toY: from.cy });
    const move = (ev: PointerEvent) => {
      if (!contentEl) return;
      const rect = contentEl.getBoundingClientRect();
      const scale = contentEl.offsetWidth ? rect.width / contentEl.offsetWidth : 1;
      setPendingConn((cur) => cur ? { ...cur, toX: (ev.clientX - rect.left) / scale, toY: (ev.clientY - rect.top) / scale } : cur);
    };
    const up = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest("[data-dfd-node]") as HTMLElement | null;
      const toId = target?.dataset.dfdNode;
      if (toId && toId !== fromId) editing.onAddConnection(fromId, toId);
      setPendingConn(null);
    };
    // Cancelled (a pinch, the browser): no line is drawn.
    followPointer(e, { move, up, cancel: () => setPendingConn(null) });
  };

  const [adding, setAdding] = useState<null | "process" | "store" | "entity">(null);
  const [draft, setDraft] = useState("");
  // Closing the form removes the field that had focus; hand focus back to
  // whichever of the three buttons opened it.
  const openers = useRef<Record<string, HTMLButtonElement | null>>({});
  const [refocus, setRefocus] = useState<string | null>(null);
  useEffect(() => {
    if (!refocus) return;
    openers.current[refocus]?.focus({ preventScroll: true });
    setRefocus(null);
  }, [refocus]);
  const closeAdd = () => { if (adding) setRefocus(adding); setAdding(null); setDraft(""); };
  const commitAdd = () => {
    const t = draft.trim();
    if (!t || !adding) { closeAdd(); return; }
    const id = adding === "process" ? editing.onAddStep(t)
      : adding === "store" ? editing.onAddDataStore(t)
      : editing.onAddExternalEntity(t);
    closeAdd();
    // New nodes join the end of their row, usually out of view.
    revealNew(id);
  };

  const isEmpty = model.steps.length === 0 && (model.dataStores ?? []).length === 0 && (model.externalEntities ?? []).length === 0;
  // Present mode (full screen, showing to others): the add controls are
  // hidden by the shell, so the legend stays even if an add form was open.
  // Turning Present on drops the add form from the screen; close it too, so
  // leaving Present does not bring it back with its field grabbing focus.
  // (The button that opened it is gone as well, so there is no focus to
  // hand back.)
  useEffect(() => {
    if (presenting) { setAdding(null); setDraft(""); }
  }, [presenting]);

  return (
    // The frame the selection keys answer for (canvas-selection.tsx).
    <div ref={(el) => { sel.frameRef.current = el; grown.rootRef.current = el; }} className="h-full w-full">
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="Data flow diagram"
      viewId="dfd"
      apiRef={shellApi}
      shapes={nodes.map((n) => ({ x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h }))}
      onSelectBox={sel.onSelectBox}
      onBackgroundPress={sel.onBackgroundPress}
      // Empty: aim at the middle, where the prompt is drawn.
      initialFocus={isEmpty ? { x: width / 2, y: 0, w: 0, h: 0 } : undefined}
      bottomLeft={adding && !presenting ? undefined : <Legend />}
      bottomRight={
        adding ? (
          <div
            className="flex max-w-full items-center gap-1 rounded-md border bg-card p-1 shadow-sm"
            // Esc anywhere in the form (its field or either button) closes it
            // as Cancel does, and is marked handled so it does not also take
            // the artifact out of full screen.
            onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeAdd(); } }}
          >
            <input
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              // preventDefault: focus returns to the opener button on commit,
              // and the same keystroke's keypress would press it again. On
              // Esc it marks the key handled (see the form above).
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(); } if (e.key === "Escape") { e.preventDefault(); closeAdd(); } }}
              placeholder={adding === "process" ? "New process" : adding === "store" ? "New data store" : "New external entity"}
              aria-label={adding === "process" ? "New process name" : adding === "store" ? "New data store name" : "New external entity name"}
              className="h-8 w-52 min-w-0 flex-1 text-sm px-2 rounded border bg-background"
            />
            <button onClick={commitAdd} title="Add" aria-label="Add" className="h-8 w-8 shrink-0 flex items-center justify-center rounded hover:bg-muted"><Plus className="size-4" /></button>
            <button onClick={closeAdd} title="Cancel" aria-label="Cancel" className="h-8 w-8 shrink-0 flex items-center justify-center rounded hover:bg-muted"><X className="size-4" /></button>
          </div>
        ) : (
          // These three buttons are also the key to the shapes: each carries
          // the glyph it creates. The legend used to repeat the same three
          // labels a few pixels away, and the two rows ran into each other.
          <div className="flex flex-wrap items-center justify-end gap-1" data-no-pan>
            {/* Only once the person has arranged the diagram by hand. */}
            {saved && (
              <button onClick={tidyUp} title="Put every shape back in the automatic layout (Undo brings your arrangement back)"
                className="h-8 px-2.5 mr-1 rounded-md bg-card text-xs flex items-center gap-1.5 hover:bg-muted">
                <Wand2 className="size-3.5" /> Tidy up
              </button>
            )}
            <span className="px-1 eyebrow text-muted-foreground">Add</span>
            <button ref={(el) => { openers.current.process = el; }} onClick={() => setAdding("process")} title="Add a process" className="h-8 px-2.5 rounded-md border border-separator-strong bg-card text-xs flex items-center gap-1.5 hover:border-primary/60">
              <CircleDot className="size-3.5 text-primary" /> Process
            </button>
            <button ref={(el) => { openers.current.store = el; }} onClick={() => setAdding("store")} title="Add a data store" className="h-8 px-2.5 rounded-md border border-separator-strong bg-card text-xs flex items-center gap-1.5 hover:border-primary/60">
              <Database className="size-3.5 text-primary" /> Data store
            </button>
            <button ref={(el) => { openers.current.entity = el; }} onClick={() => setAdding("entity")} title="Add an external entity" className="h-8 px-2.5 rounded-md border border-separator-strong bg-card text-xs flex items-center gap-1.5 hover:border-primary/60">
              <Square className="size-3.5 text-primary" /> External entity
            </button>
          </div>
        )
      }
    >
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
          {/* Presenting, the add buttons this points to are hidden. */}
          {presenting
            ? "No processes, data stores or external entities yet."
            : "Add a process, data store, or external entity below to start the diagram."}
        </div>
      )}
      <FlashRing key={flashId ?? "idle"} rect={flashId ? rectFor(flashId) : null} />
      {!presenting && <SelectionOutlines ids={sel.selection.ids} rects={rectsById} />}
      {!presenting && <SnapGuides guides={sel.guides} />}
      {!presenting && <SelectionBar ids={sel.selection.ids} rects={rectsById} actions={sel.actions} />}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
        <defs>
          <marker id="dfd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-verified)" />
          </marker>
        </defs>
        {flows.map((c) => {
          const a = byId.get(c.fromId), b = byId.get(c.toId);
          if (!a || !b) return null;
          const from = edgePoint(a, b), to = edgePoint(b, a);
          const midX = (from.x + to.x) / 2;
          const path = roundedPath([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
          return (
            <g key={c.id}>
              <path d={path} fill="none" stroke="var(--color-verified)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#dfd-arrow)" />
            </g>
          );
        })}
        {pendingConn && (
          <path d={`M ${pendingConn.fromX} ${pendingConn.fromY} L ${pendingConn.toX} ${pendingConn.toY}`}
            fill="none" stroke="var(--color-verified)" strokeWidth={1.9} strokeLinecap="round" strokeDasharray="4 3" opacity={0.8} />
        )}
      </svg>

      {nodes.map((n) => (
        <DFDNodeView
          key={n.id}
          node={n}
          onDrag={(dx, dy, done) => patchPos(n.id, n.cx + dx, n.cy + dy, done)}
          canEdit={editing.canEdit}
          onPress={(e) => sel.pressShape(n.id, e)}
          onGrip={(e) => {
            // A grip on one of several selected shapes moves them all; on
            // any other, just that shape. Either way with snap guides.
            const ids = sel.selection.ids;
            return sel.dragSelection(e, ids.length > 1 && ids.includes(n.id) ? ids : [n.id]);
          }}
          onDelete={() => editing.onDeleteAny(n.id)}
          onUpdate={(text) => editing.onUpdateItem(n.id, { text })}
          onStartConnect={(e, contentEl) => startConnDrag(n.id, e, contentEl)}
        />
      ))}

      {flows.map((c) => {
        const a = byId.get(c.fromId), b = byId.get(c.toId);
        if (!a || !b) return null;
        // The middle of the line as drawn above (its vertical run).
        const from = edgePoint(a, b), to = edgePoint(b, a);
        return (
          <LineLabel
            key={`lbl-${c.id}`}
            x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}
            value={c.label ?? ""} placeholder="label" tone="verified"
            fieldLabel="Data flow label"
            onChange={(label) => editing.onUpdateConnection(c.id, { label })}
            onDelete={() => editing.onDeleteConnection(c.id)}
            deleteLabel={`Delete flow${c.label ? ` ${c.label}` : ""}`}
          />
        );
      })}
    </CanvasShell>
    {sel.pasteDialog}
    </div>
  );
}

function DFDNodeView({
  node, onDrag, onDelete, onUpdate, onStartConnect, canEdit, onPress, onGrip,
}: {
  node: DFDNode;
  /** Called with `done` once more when the drag ends. */
  onDrag: (dx: number, dy: number, done?: boolean) => void;
  /** Asked before a drag starts (a viewer is told who is editing). */
  canEdit: () => boolean;
  /** A press on the body: select, and drag the selection (canvas-selection). */
  onPress: (e: React.PointerEvent) => void;
  /** A press on the grip; true when it was taken (the shape is one of
   *  several selected, so the selection moves). */
  onGrip: (e: React.PointerEvent) => boolean;
  onDelete: () => void;
  onUpdate: (text: string) => void;
  onStartConnect: (e: React.PointerEvent, contentEl: HTMLElement | null) => void;
}) {
  const worldDrag = useWorldDrag();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Delta from the drag's START position, not incremental since-last-move
    // -- onDrag adds this to the node's position from the render at drag
    // start, so it must be the *cumulative* offset, matching how
    // ProcessCanvas's useNodeDrag (the proven pattern elsewhere in this
    // codebase) does it. An incremental-since-last delta would silently
    // discard all but the last move event's worth of movement, since the
    // stale `node.cx` captured in this closure never updates mid-drag.
    if (onGrip(e)) return;
    if (!canEdit()) return;
    // A press that never moved is a click, not a move: nothing to save.
    let last: { dx: number; dy: number } | null = null;
    const finish = () => { if (last) onDrag(last.dx, last.dy, true); };
    worldDrag(e, (dx, dy) => { last = { dx, dy }; onDrag(dx, dy); }, { up: finish, cancel: finish });
  };

  // Its own height at least, taller when the text needs it.
  const style: React.CSSProperties = {
    left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, minHeight: node.baseH, zIndex: 10,
  };

  // The grip, the delete X and the connect handle only edit: Present mode
  // hides them (data-edit-control). Nodes move only by the grip, so while
  // presenting a drag on a node pans the view instead (CanvasShell).
  const header = (
    <div className="flex items-center justify-between gap-1 px-2 pt-1.5">
      <div className="flex items-center gap-1 min-w-0">
        <GripVertical data-no-pan data-edit-control onPointerDown={onPointerDown} className="size-3.5 text-muted-foreground/70 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0" />
        {node.label && <IdChip id={node.label} tone="primary" />}
      </div>
      <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete ${node.kind === "process" ? "process" : node.kind === "store" ? "data store" : "external entity"} ${node.text}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0">
        <X className="size-3" />
      </button>
    </div>
  );

  const connectHandle = (
    <div
      data-no-pan
      data-edit-control
      onPointerDown={(e) => { e.stopPropagation(); onStartConnect(e, (e.currentTarget.closest("[data-canvas-content]") as HTMLElement) ?? null); }}
      className="absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-verified bg-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 hover:bg-verified transition cursor-crosshair before:absolute before:-inset-2 before:content-['']"
      title="Drag to another node to connect"
    />
  );

  if (node.kind === "process") {
    return (
      <div data-node data-dfd-node={node.id} data-shape-id={node.id} onPointerDown={onPress} className="group absolute rounded-full border-2 border-primary/60 bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-center px-5 py-1" style={style}>
        {header}
        <div className="text-xs font-medium leading-snug break-words px-1">
          <InlineEdit value={node.text} onChange={onUpdate} multiline activate="double" />
        </div>
        {connectHandle}
      </div>
    );
  }
  if (node.kind === "store") {
    return (
      <div data-node data-dfd-node={node.id} data-shape-id={node.id} onPointerDown={onPress} className="group absolute border-t-2 border-b-2 border-primary/60 bg-card shadow-sm flex flex-col justify-center gap-0.5 px-2" style={style}>
        {header}
        <div className="text-xs font-medium leading-snug break-words px-1">
          <InlineEdit value={node.text} onChange={onUpdate} multiline activate="double" />
        </div>
        {connectHandle}
      </div>
    );
  }
  return (
    <div data-node data-dfd-node={node.id} data-shape-id={node.id} onPointerDown={onPress} className="group absolute rounded-md border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-0.5" style={style}>
      {header}
      <div className="text-xs font-medium leading-snug break-words px-2 pb-1.5">
        <InlineEdit value={node.text} onChange={onUpdate} multiline activate="double" />
      </div>
      {connectHandle}
    </div>
  );
}

function Legend() {
  // No bare `flex` here: it would sit beside `hidden` at the same weight and
  // leave which one wins to the order the stylesheet happens to be built in.
  const look = "items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground";
  const hint = `hidden @min-[640px]:flex ${look}`;
  const presenting = !!useArtifactFullscreen()?.presenting;
  if (presenting) {
    // While editing, the three Add buttons double as the key to the shapes
    // (see the bottom-right slot). Present mode hides them, so the key is
    // drawn here instead, one small swatch of each shape as the canvas
    // draws it. The how-to-edit hint below would describe things that do
    // nothing while presenting, so it is left out.
    const chip = `flex ${look}`;
    const swatch = "h-2.5 w-4 border-primary/60";
    return (
      <>
        <span className={chip}><span className={`${swatch} rounded-full border-2`} /> Process</span>
        <span className={chip}><span className={`${swatch} border-y-2`} /> Data store</span>
        <span className={chip}><span className={`${swatch} rounded-[2px] border-2`} /> External entity</span>
      </>
    );
  }
  return (
    <>
      <span className={hint}>Click to select · double-click to edit · drag a node's handle to link</span>
    </>
  );
}

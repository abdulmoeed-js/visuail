import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ProcessModel, Connection, StateItem, NodeLayout } from "@/data/samples";
import { Plus, X, GripVertical, CircleDot, Wand2 } from "lucide-react";
import { CanvasShell, useWorldDrag } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { useRevealNew, FlashRing } from "./canvas-reveal";
import { SelectionBar, SelectionOutlines, SnapGuides, useShapeSelection } from "./canvas-selection";
import { InlineEdit } from "./InlineEdit";
import { LineLabel } from "./LineLabel";
import { LAYER } from "./canvas-layers";
import { ConnectHandles, ConnectorEnds, ConnectorPreview, LineBar, useConnectorDrag } from "./canvas-connectors";
import { connectorRoute, type Point } from "@/lib/canvas/connector";
import { useGrownHeights } from "./use-grown-heights";
import { roundedPath } from "@/lib/canvas/geometry";
import { SAVE_LAYOUTS, layoutOf, placeClear } from "@/lib/canvas/layout";
import { IdChip } from "./atoms";
import { useArtifactFullscreen } from "./artifact-fullscreen";

// State (Statechart) Diagram, from the corpus's State Diagram material:
// states + transitions, with initial-state and final-state markers. A free
// graph -- a transition can go from any state to any other, including
// backward and self-loops -- so unlike Decision Tree there's no "correct"
// computed layout, just a starting grid and free drag from there (the same
// "auto-arrange once, freeform after" pattern DFD already proved out).
// Transitions reuse the existing Connection/onAddConnection machinery
// exactly like DFD's flows did -- no new connector plumbing.

const STATE_W = 170, STATE_H = 70;
const COL_GAP = 70, ROW_GAP = 90;
const TOP_PAD = 60, LEFT_PAD = 90;
const COLS = 4;

/** A state where it is drawn; `h` is STATE_H, or more when its text needs it. */
interface Placed { ref: StateItem; cx: number; cy: number; h: number; }
type Pos = Record<string, { cx: number; cy: number }>;

/** A four-column grid until the person arranges the diagram; then their
 *  saved places (top-left corners), with a drag in progress drawn on top. In
 *  an arranged diagram a new state starts at its grid place, moved down until
 *  it is clear of the others. */
function layout(states: StateItem[], overrides: Pos, saved: Record<string, NodeLayout> | undefined, grown: Record<string, number>) {
  const floating = new Set<string>();
  const placed: Placed[] = states.map((s, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const naturalCx = LEFT_PAD + col * (STATE_W + COL_GAP) + STATE_W / 2;
    const naturalCy = TOP_PAD + row * (STATE_H + ROW_GAP) + STATE_H / 2;
    const o = overrides[s.id], sv = saved?.[s.id];
    const h = Math.max(STATE_H, grown[s.id] ?? 0);
    if (saved && !sv && !o) floating.add(s.id);
    return { ref: s, h, cx: o?.cx ?? (sv ? sv.x + STATE_W / 2 : naturalCx), cy: o?.cy ?? (sv ? sv.y + h / 2 : naturalCy) };
  });
  if (floating.size > 0) {
    const rectOf = (p: Placed) => ({ x: p.cx - STATE_W / 2, y: p.cy - p.h / 2, w: STATE_W, h: p.h });
    const taken = placed.filter((p) => !floating.has(p.ref.id)).map(rectOf);
    for (const p of placed) {
      if (!floating.has(p.ref.id)) continue;
      // Room for the start dot to the left and a loop above.
      const r = placeClear(rectOf(p), taken, 44);
      p.cx = r.x + STATE_W / 2;
      p.cy = r.y + p.h / 2;
      taken.push(r);
    }
  }
  const width = Math.max(900, ...placed.map((p) => p.cx + STATE_W / 2 + 60));
  const height = Math.max(560, ...placed.map((p) => p.cy + p.h / 2 + 60));
  return { placed, width, height };
}


interface Props {
  model: ProcessModel;
  editing: import("@/lib/artifact-editing").ArtifactEditing;
}

export function StateDiagramView({ model, editing }: Props) {
  const [overrides, setOverrides] = useCanvasViewState<Pos>("state:overrides", {});
  const states = useMemo(() => model.states ?? [], [model.states]);
  const saved = layoutOf(model, "state")?.nodes;
  // States grow with their text; lines and outlines follow (use-grown-heights).
  const grown = useGrownHeights();
  const { placed, width, height } = useMemo(() => layout(states, overrides, saved, grown.heights), [states, overrides, saved, grown.heights]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.ref.id, p])), [placed]);
  const rectFor = (id: string) => {
    const p = byId.get(id);
    return p ? { x: p.cx - STATE_W / 2, y: p.cy - p.h / 2, w: STATE_W, h: p.h } : null;
  };
  const { apiRef: shellApi, revealNew, flashId } = useRevealNew(rectFor);
  const transitions = useMemo(() => model.connections ?? [], [model.connections]);

  const noteMove = useNoteLayoutMove();
  const placedRef = useRef(placed);
  placedRef.current = placed;
  /** How tall a state is drawn now (a new one: STATE_H). */
  const hOf = (id: string) => placedRef.current.find((p) => p.ref.id === id)?.h ?? STATE_H;
  const currentPlaces = () => Object.fromEntries(placedRef.current.map((p) => [p.ref.id, { x: p.cx - STATE_W / 2, y: p.cy - p.h / 2 }]));
  /** A move: drawn live while it lasts; saved, as one undo step, when it
   *  ends (see SAVE_LAYOUTS). */
  const patchPos = (id: string, cx: number, cy: number, done?: boolean) => {
    // Only a real move counts: pressing a node's grip without dragging runs
    // this too, with the position it already has.
    const at = byId.get(id);
    if (!SAVE_LAYOUTS && (!at || at.cx !== cx || at.cy !== cy)) noteMove(model);
    setOverrides((cur) => ({ ...cur, [id]: { cx, cy } }));
    if (!done || !SAVE_LAYOUTS) return;
    editing.onPlaceShapes("state", { [id]: { x: cx - STATE_W / 2, y: cy - hOf(id) / 2 } }, currentPlaces());
    // The saved place draws it from now on.
    setOverrides((cur) => { const next = { ...cur }; delete next[id]; return next; });
  };
  const tidyUp = () => { if (editing.onTidyUp("state")) setOverrides({}); };
  const presenting = !!useArtifactFullscreen()?.presenting;

  // Selecting states (click, Shift-click, a box), moving them together, the
  // keys, copy and paste (canvas-selection.tsx).
  const rectsById = useMemo(() => new Map(placed.map((p) => [p.ref.id, { x: p.cx - STATE_W / 2, y: p.cy - p.h / 2, w: STATE_W, h: p.h }])), [placed]);
  // The transitions drawn (both ends on this diagram): one can be selected.
  const drawnTransitions = useMemo(() => transitions.filter((c) => rectsById.has(c.fromId) && rectsById.has(c.toId)), [transitions, rectsById]);
  const drawnLines = useMemo(() => new Set(drawnTransitions.map((c) => c.id)), [drawnTransitions]);
  // What each shape and line is called: for screen readers, and the lists
  // in the selection bar and the line bar.
  const shapeName = (id: string) => {
    const st = states.find((x) => x.id === id);
    return st ? `State “${st.text}”` : id;
  };
  const lineName = (id: string) => {
    const c = (model.connections ?? []).find((x) => x.id === id);
    return c ? `Transition from ${shapeName(c.fromId)} to ${shapeName(c.toId)}` : "Transition";
  };
  const shapeList = [...rectsById.keys()].map((id) => ({ id, name: shapeName(id) }));
  const sel = useShapeSelection({
    view: "state", model, rects: rectsById, shellApi, presenting,
    lines: drawnLines, onDeleteLine: editing.onDeleteConnection,
    nameOf: shapeName, lineNameOf: lineName,
    canEdit: editing.canEdit,
    preview: (places) => {
      if (!SAVE_LAYOUTS) noteMove(model);
      setOverrides((cur) => {
        const next = { ...cur };
        for (const [id, p] of Object.entries(places)) next[id] = { cx: p.x + STATE_W / 2, cy: p.y + hOf(id) / 2 };
        return next;
      });
    },
    commit: (places, mergeKey) => {
      if (!SAVE_LAYOUTS) return;
      editing.onPlaceShapes("state", places, currentPlaces(), mergeKey);
      setOverrides((cur) => { const next = { ...cur }; for (const id of Object.keys(places)) delete next[id]; return next; });
    },
    onDeleteMany: editing.onDeleteMany,
    onPaste: (clip, dx, dy) => {
      const made = editing.onPasteShapes("state", clip, dx, dy, currentPlaces());
      if (made && !SAVE_LAYOUTS) {
        setOverrides((cur) => {
          const next = { ...cur };
          for (const id of made.ids) { const p = made.places[id]; if (p) next[id] = { cx: p.x + STATE_W / 2, cy: p.y + hOf(id) / 2 }; }
          return next;
        });
      }
      return made;
    },
  });

  // Drawing a transition from a dot on a state's side (let go on the same
  // state for a self-transition), or moving one end of the selected
  // transition to another state (canvas-connectors.tsx).
  const connect = useConnectorDrag({ shellApi, rects: rectsById, canEdit: editing.canEdit });
  const startConnDrag = (fromId: string, e: React.PointerEvent, from: Point) =>
    connect.start(e, from, { exclude: fromId, allowSelf: true, done: (toId) => editing.onAddConnection(fromId, toId) });
  const startEndDrag = (c: Connection, end: "from" | "to", e: React.PointerEvent, fixed: Point) =>
    connect.start(e, fixed, {
      allowSelf: true,
      done: (id) => {
        if (id === (end === "from" ? c.fromId : c.toId)) return;
        editing.onUpdateConnection(c.id, end === "from" ? { fromId: id } : { toId: id });
      },
    });
  /** A transition's line: a small loop above a state back to itself,
   *  otherwise the connector route (src/lib/canvas/connector.ts); its ends,
   *  and where its event goes. */
  const lineOf = (c: Connection) => {
    const a = rectsById.get(c.fromId), b = rectsById.get(c.toId);
    if (!a || !b) return null;
    if (c.fromId === c.toId) {
      const x = a.x + a.w / 2, y = a.y;
      return {
        path: `M ${x - 18} ${y} C ${x - 18} ${y - 34}, ${x + 18} ${y - 34}, ${x + 18} ${y}`,
        from: { x: x - 18, y }, to: { x: x + 18, y }, mid: { x, y: y - 44 },
      };
    }
    const r = connectorRoute(a, b);
    return { path: roundedPath(r.points), from: r.points[0], to: r.points[r.points.length - 1], mid: r.mid };
  };

  // The selection bar and the line bar sit right after their state or
  // transition in the page, so Tab goes state, its bar, the next state.
  const barAfter = (id: string) => presenting || sel.selection.ids[0] !== id ? null : (
    <SelectionBar
      ids={sel.selection.ids} rects={rectsById} actions={sel.actions}
      connect={{
        what: "transition",
        targets: shapeList.map((t) => (t.id === sel.selection.ids[0] ? { ...t, name: `${t.name} (loop back to itself)` } : t)),
        onPick: (to) => editing.onAddConnection(sel.selection.ids[0], to),
      }}
    />
  );
  const lineBarAfter = (c: Connection) => {
    const l = presenting || sel.line !== c.id ? null : lineOf(c);
    return l ? (
      <LineBar
        lineId={c.id} at={l.mid} fromId={c.fromId} toId={c.toId} shapes={shapeList} what="transition" allowSelf
        onChange={(end, id) => editing.onUpdateConnection(c.id, end === "from" ? { fromId: id } : { toId: id })}
        onDelete={() => editing.onDeleteConnection(c.id)}
      />
    ) : null;
  };

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  // Closing the form removes the field that had focus; hand it back to the
  // button that opened it.
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [refocus, setRefocus] = useState(false);
  useEffect(() => {
    if (!refocus) return;
    addButton.current?.focus({ preventScroll: true });
    setRefocus(false);
  }, [refocus]);
  const closeAdd = () => { setDraft(""); setAdding(false); setRefocus(true); };
  const commitAdd = () => {
    const t = draft.trim();
    if (t) revealNew(editing.onAddState(t));
    closeAdd();
  };
  // Present mode (full screen, showing to others): the add form is hidden
  // by the shell, so the legend stays even if the form was open.
  // Turning Present on drops the add form from the screen; close it too, so
  // leaving Present does not bring it back with its field grabbing focus.
  // (The "Add state" button is gone as well, so there is no focus to hand
  // back.)
  useEffect(() => {
    if (presenting) { setDraft(""); setAdding(false); }
  }, [presenting]);

  return (
    // The frame the selection keys answer for (canvas-selection.tsx).
    <div ref={(el) => { sel.frameRef.current = el; grown.rootRef.current = el; }} className="h-full w-full">
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="State diagram"
      viewId="state"
      apiRef={shellApi}
      shapes={placed.map((p) => ({ x: p.cx - STATE_W / 2, y: p.cy - p.h / 2, w: STATE_W, h: p.h }))}
      onSelectBox={sel.onSelectBox}
      onBackgroundPress={sel.onBackgroundPress}
      // Empty: aim at the middle, where the "add a state" prompt is drawn.
      initialFocus={states.length === 0 ? { x: width / 2, y: 0, w: 0, h: 0 } : undefined}
      bottomLeft={adding && !presenting ? undefined : <Legend />}
      bottomRight={
        adding ? (
          <div
            className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm"
            // Esc anywhere in the form (its field or either button) closes it
            // as Cancel does, and is marked handled so it does not also take
            // the artifact out of full screen.
            onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeAdd(); } }}
          >
            <input
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              // preventDefault: focus returns to "Add state" on commit, and the
              // same keystroke's keypress would press it again. On Esc it
              // marks the key handled (see the form above).
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(); } if (e.key === "Escape") { e.preventDefault(); closeAdd(); } }}
              placeholder="New state"
              aria-label="New state name"
              className="h-8 w-44 min-w-0 flex-1 text-sm px-2 rounded border bg-background"
            />
            <button onClick={commitAdd} title="Add state" aria-label="Add state" className="h-8 w-8 shrink-0 flex items-center justify-center rounded hover:bg-muted"><Plus className="size-4" /></button>
            <button onClick={closeAdd} title="Cancel" aria-label="Cancel" className="h-8 w-8 shrink-0 flex items-center justify-center rounded hover:bg-muted"><X className="size-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1" data-no-pan>
            {/* Only once the person has arranged the diagram by hand. */}
            {saved && (
              <button onClick={tidyUp} title="Put every state back in the automatic layout (Undo brings your arrangement back)"
                className="h-8 px-2.5 rounded-md bg-card text-xs flex items-center gap-1.5 hover:bg-muted">
                <Wand2 className="size-3.5" /> Tidy up
              </button>
            )}
            <button ref={addButton} onClick={() => setAdding(true)} data-no-pan className="h-8 px-2.5 rounded-md border border-separator-strong bg-card text-xs flex items-center gap-1.5 hover:border-primary/60">
              <Plus className="size-3.5 text-primary" /> Add state
            </button>
          </div>
        )
      }
    >
      {states.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground pointer-events-none">
          <span>No states yet.</span>
          <button onClick={() => setAdding(true)} data-no-pan data-edit-control className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-separator-strong bg-card px-3 py-1.5 text-xs hover:border-primary/60">
            <Wand2 className="size-3.5 text-primary" /> Add a state
          </button>
        </div>
      )}
      <FlashRing key={flashId ?? "idle"} rect={flashId ? rectFor(flashId) : null} />
      {!presenting && <SelectionOutlines ids={sel.selection.ids} rects={rectsById} />}
      {!presenting && <SnapGuides guides={sel.guides} />}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
        <defs>
          <marker id="sd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
        </defs>
        {placed.filter((p) => p.ref.isInitial).map((p) => {
          const dotX = p.cx - STATE_W / 2 - 34, dotY = p.cy;
          return (
            <g key={`init-${p.ref.id}`}>
              <circle cx={dotX} cy={dotY} r={6} fill="var(--color-foreground)" />
              <path d={`M ${dotX + 6} ${dotY} L ${p.cx - STATE_W / 2} ${p.cy}`} stroke="var(--color-foreground)" strokeWidth={1.75} markerEnd="url(#sd-arrow)" />
            </g>
          );
        })}
        {drawnTransitions.map((c) => {
          const l = lineOf(c);
          if (!l) return null;
          const selected = sel.line === c.id;
          return (
            <g key={c.id}>
              {/* A wide, invisible stroke to click: selects the transition;
               *  a double-click types its event. */}
              {!presenting && (
                <path
                  d={l.path} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke"
                  data-no-pan data-edit-control className="cursor-pointer"
                  onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); sel.selectLine(c.id); }}
                  onDoubleClick={() => sel.editLineLabel(c.id)}
                />
              )}
              {selected && (
                <path
                  d={l.path} fill="none" stroke="var(--color-primary)" strokeOpacity={0.6} strokeWidth={7}
                  strokeLinecap="round" pointerEvents="none" data-edit-control
                />
              )}
              <path
                d={l.path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75}
                strokeLinecap="round" markerEnd="url(#sd-arrow)"
              />
            </g>
          );
        })}
      </svg>

      {placed.map((p) => (
        <Fragment key={p.ref.id}>
        <StateNodeView
          node={p}
          onDrag={(dx, dy, done) => patchPos(p.ref.id, p.cx + dx, p.cy + dy, done)}
          canEdit={editing.canEdit}
          onPress={(e) => sel.pressShape(p.ref.id, e)}
          onGrip={(e) => {
            // A grip on one of several selected shapes moves them all; on
            // any other, just that shape. Either way with snap guides.
            const ids = sel.selection.ids;
            return sel.dragSelection(e, ids.length > 1 && ids.includes(p.ref.id) ? ids : [p.ref.id]);
          }}
          onDelete={() => editing.onDeleteAny(p.ref.id)}
          onUpdateText={(text) => editing.onUpdateItem(p.ref.id, { text })}
          onToggleInitial={() => editing.onUpdateItem(p.ref.id, { isInitial: !p.ref.isInitial })}
          onToggleFinal={() => editing.onUpdateItem(p.ref.id, { isFinal: !p.ref.isFinal })}
          onStartConnect={(e, from) => startConnDrag(p.ref.id, e, from)}
        />
        {barAfter(p.ref.id)}
        </Fragment>
      ))}

      {drawnTransitions.map((c) => {
        // Above a loop; otherwise the middle of the line as drawn above.
        const m = lineOf(c)?.mid;
        if (!m) return null;
        return (
          <Fragment key={`lbl-${c.id}`}>
          <LineLabel
            lineId={c.id} x={m.x} y={m.y} onSelect={() => sel.selectLine(c.id)} name={lineName(c.id)}
            value={c.label ?? ""} placeholder="Add event"
            fieldLabel="Transition: event [guard] / action"
            onChange={(label) => editing.onUpdateConnection(c.id, { label })}
            onDelete={() => editing.onDeleteConnection(c.id)}
            deleteLabel={`Delete transition${c.label ? ` ${c.label}` : ""}`}
          />
          {lineBarAfter(c)}
          </Fragment>
        );
      })}
      {!presenting && <ConnectorPreview live={connect.live} rects={rectsById} color="var(--color-primary)" />}
      {!presenting && (() => {
        const c = drawnTransitions.find((x) => x.id === sel.line);
        const l = c && lineOf(c);
        if (!c || !l) return null;
        return <ConnectorEnds from={l.from} to={l.to} onStart={(e, end) => startEndDrag(c, end, e, end === "from" ? l.to : l.from)} />;
      })()}
    </CanvasShell>
    {sel.liveRegion}
    {sel.pasteDialog}
    </div>
  );
}

function StateNodeView({
  node, onDrag, onDelete, onUpdateText, onToggleInitial, onToggleFinal, onStartConnect, canEdit, onPress, onGrip,
}: {
  node: Placed;
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
  onUpdateText: (t: string) => void;
  onToggleInitial: () => void;
  onToggleFinal: () => void;
  /** A press on one of the dots on its sides: draw a transition from `from`. */
  onStartConnect: (e: React.PointerEvent, from: Point) => void;
}) {
  const worldDrag = useWorldDrag();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (onGrip(e)) return;
    if (!canEdit()) return;
    // A press that never moved is a click, not a move: nothing to save.
    let last: { dx: number; dy: number } | null = null;
    const finish = () => { if (last) onDrag(last.dx, last.dy, true); };
    worldDrag(e, (dx, dy) => { last = { dx, dy }; onDrag(dx, dy); }, { up: finish, cancel: finish });
  };

  return (
    <div
      data-node
      data-state-node={node.ref.id}
      data-shape-id={node.ref.id}
      onPointerDown={onPress}
      className="group absolute rounded-xl border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      style={{
        // Its own height at least, taller when the text needs it.
        left: node.cx - STATE_W / 2, top: node.cy - node.h / 2, width: STATE_W, minHeight: STATE_H, zIndex: LAYER.shape,
        ...(node.ref.isFinal ? { boxShadow: "0 0 0 2px var(--color-card), 0 0 0 4px var(--color-primary)" } : {}),
      }}
    >
      {/* The grip, the delete X, the initial/final toggles and the connect
       *  handle only edit: Present mode hides them (data-edit-control). The
       *  initial dot and the final ring themselves are drawn elsewhere and
       *  stay. States move only by the grip, so while presenting a drag on
       *  one pans the view instead (CanvasShell). */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical data-no-pan data-edit-control onPointerDown={onPointerDown} className="size-3.5 text-muted-foreground/70 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0" />
          <IdChip id={node.ref.id} tone="primary" />
        </div>
        <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete state ${node.ref.text}`} className="relative before:absolute before:-inset-1 before:content-[''] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0">
          <X className="size-3" />
        </button>
      </div>
      <div className="text-xs font-medium leading-snug break-words">
        <InlineEdit value={node.ref.text} onChange={onUpdateText} multiline activate="double" label="State" />
      </div>
      <div className="mt-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition" data-no-pan data-edit-control>
        <button onClick={onToggleInitial} title={node.ref.isInitial ? "Initial state (click to unmark)" : "Mark as initial state"} aria-pressed={!!node.ref.isInitial} aria-label="Initial state"
          className={node.ref.isInitial ? "text-primary" : "text-muted-foreground hover:text-foreground"}>
          <CircleDot className="size-3" />
        </button>
        <button onClick={onToggleFinal} title={node.ref.isFinal ? "Final state (click to unmark)" : "Mark as final state"} aria-pressed={!!node.ref.isFinal} aria-label="Final state"
          className={"text-[9px] font-mono-tight " + (node.ref.isFinal ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
          final
        </button>
      </div>
      <ConnectHandles
        rect={{ x: node.cx - STATE_W / 2, y: node.cy - node.h / 2, w: STATE_W, h: node.h }}
        onStart={onStartConnect}
        title="Drag to another state to draw a transition, or let go on this one to loop back"
      />
    </div>
  );
}

function Legend() {
  // `look` carries no display class, so the hint below can be `hidden` on a
  // narrow canvas without a bare `flex` beside it at the same weight.
  const look = "items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground";
  const chip = `flex ${look}`;
  return (
    <>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-full bg-foreground" /> Initial</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-full border-2 border-primary" /> Final (ring)</span>
      {/* How to edit: describes handles Present mode hides, so it goes too. */}
      <span data-edit-control className={`hidden @min-[640px]:flex ${look}`}>Click to select · drag to move · double-click to type · drag a side dot to another state, or back onto this one to loop</span>
    </>
  );
}

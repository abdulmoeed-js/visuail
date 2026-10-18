import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessModel, Connection, StateItem, NodeLayout } from "@/data/samples";
import { Plus, X, GripVertical, CircleDot, Wand2 } from "lucide-react";
import { CanvasShell, followPointer, useWorldDrag } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { useRevealNew, FlashRing } from "./canvas-reveal";
import { InlineEdit } from "./InlineEdit";
import { edgePoint, roundedPath } from "@/lib/canvas/geometry";
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

interface Placed { ref: StateItem; cx: number; cy: number; }
type Pos = Record<string, { cx: number; cy: number }>;

/** A four-column grid until the person arranges the diagram; then their
 *  saved places (top-left corners), with a drag in progress drawn on top. In
 *  an arranged diagram a new state starts at its grid place, moved down until
 *  it is clear of the others. */
function layout(states: StateItem[], overrides: Pos, saved?: Record<string, NodeLayout>) {
  const floating = new Set<string>();
  const placed: Placed[] = states.map((s, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const naturalCx = LEFT_PAD + col * (STATE_W + COL_GAP) + STATE_W / 2;
    const naturalCy = TOP_PAD + row * (STATE_H + ROW_GAP) + STATE_H / 2;
    const o = overrides[s.id], sv = saved?.[s.id];
    if (saved && !sv && !o) floating.add(s.id);
    return { ref: s, cx: o?.cx ?? (sv ? sv.x + STATE_W / 2 : naturalCx), cy: o?.cy ?? (sv ? sv.y + STATE_H / 2 : naturalCy) };
  });
  if (floating.size > 0) {
    const rectOf = (p: Placed) => ({ x: p.cx - STATE_W / 2, y: p.cy - STATE_H / 2, w: STATE_W, h: STATE_H });
    const taken = placed.filter((p) => !floating.has(p.ref.id)).map(rectOf);
    for (const p of placed) {
      if (!floating.has(p.ref.id)) continue;
      // Room for the start dot to the left and a loop above.
      const r = placeClear(rectOf(p), taken, 44);
      p.cx = r.x + STATE_W / 2;
      p.cy = r.y + STATE_H / 2;
      taken.push(r);
    }
  }
  const width = Math.max(900, ...placed.map((p) => p.cx + STATE_W / 2 + 60));
  const height = Math.max(560, ...placed.map((p) => p.cy + STATE_H / 2 + 60));
  return { placed, width, height };
}

/** Where a transition leaves state `a` towards `b`. */
const stateEdgePoint = (a: Placed, b: Placed) => edgePoint({ cx: a.cx, cy: a.cy, w: STATE_W, h: STATE_H }, b);

interface Props {
  model: ProcessModel;
  editing: import("@/lib/artifact-editing").ArtifactEditing;
}

export function StateDiagramView({ model, editing }: Props) {
  const [overrides, setOverrides] = useCanvasViewState<Pos>("state:overrides", {});
  const [pendingConn, setPendingConn] = useState<null | { fromId: string; fromX: number; fromY: number; toX: number; toY: number }>(null);
  const states = useMemo(() => model.states ?? [], [model.states]);
  const saved = layoutOf(model, "state")?.nodes;
  const { placed, width, height } = useMemo(() => layout(states, overrides, saved), [states, overrides, saved]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.ref.id, p])), [placed]);
  const rectFor = (id: string) => {
    const p = byId.get(id);
    return p ? { x: p.cx - STATE_W / 2, y: p.cy - STATE_H / 2, w: STATE_W, h: STATE_H } : null;
  };
  const { apiRef: shellApi, revealNew, flashId } = useRevealNew(rectFor);
  const transitions = model.connections ?? [];

  const noteMove = useNoteLayoutMove();
  const placedRef = useRef(placed);
  placedRef.current = placed;
  /** A move: drawn live while it lasts; saved, as one undo step, when it
   *  ends (see SAVE_LAYOUTS). */
  const patchPos = (id: string, cx: number, cy: number, done?: boolean) => {
    // Only a real move counts: pressing a node's grip without dragging runs
    // this too, with the position it already has.
    const at = byId.get(id);
    if (!SAVE_LAYOUTS && (!at || at.cx !== cx || at.cy !== cy)) noteMove(model);
    setOverrides((cur) => ({ ...cur, [id]: { cx, cy } }));
    if (!done || !SAVE_LAYOUTS) return;
    editing.onPlaceShapes("state", { [id]: { x: cx - STATE_W / 2, y: cy - STATE_H / 2 } },
      Object.fromEntries(placedRef.current.map((p) => [p.ref.id, { x: p.cx - STATE_W / 2, y: p.cy - STATE_H / 2 }])));
    // The saved place draws it from now on.
    setOverrides((cur) => { const next = { ...cur }; delete next[id]; return next; });
  };
  const tidyUp = () => { if (editing.onTidyUp("state")) setOverrides({}); };

  const startConnDrag = (fromId: string, e: React.PointerEvent, contentEl: HTMLElement | null) => {
    const from = byId.get(fromId);
    if (!from) return;
    setPendingConn({ fromId, fromX: from.cx + STATE_W / 2, fromY: from.cy, toX: from.cx + STATE_W / 2, toY: from.cy });
    const move = (ev: PointerEvent) => {
      if (!contentEl) return;
      const rect = contentEl.getBoundingClientRect();
      const scale = contentEl.offsetWidth ? rect.width / contentEl.offsetWidth : 1;
      setPendingConn((cur) => cur ? { ...cur, toX: (ev.clientX - rect.left) / scale, toY: (ev.clientY - rect.top) / scale } : cur);
    };
    const up = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest("[data-state-node]") as HTMLElement | null;
      const toId = target?.dataset.stateNode;
      if (toId) editing.onAddConnection(fromId, toId);
      setPendingConn(null);
    };
    // Cancelled (a pinch, the browser): no line is drawn.
    followPointer(e, { move, up, cancel: () => setPendingConn(null) });
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
  const presenting = !!useArtifactFullscreen()?.presenting;
  // Turning Present on drops the add form from the screen; close it too, so
  // leaving Present does not bring it back with its field grabbing focus.
  // (The "Add state" button is gone as well, so there is no focus to hand
  // back.)
  useEffect(() => {
    if (presenting) { setDraft(""); setAdding(false); }
  }, [presenting]);

  return (
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="State diagram"
      viewId="state"
      apiRef={shellApi}
      shapes={placed.map((p) => ({ x: p.cx - STATE_W / 2, y: p.cy - STATE_H / 2, w: STATE_W, h: STATE_H }))}
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
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
        <defs>
          <marker id="sd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-primary)" />
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
        {transitions.map((c) => {
          const a = byId.get(c.fromId), b = byId.get(c.toId);
          if (!a || !b) return null;
          if (a === b || c.fromId === c.toId) {
            // Self-transition: small loop above the state.
            const x = a.cx, y = a.cy - STATE_H / 2;
            const path = `M ${x - 18} ${y} C ${x - 18} ${y - 34}, ${x + 18} ${y - 34}, ${x + 18} ${y}`;
            return (
              <g key={c.id}>
                <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth={1.75} markerEnd="url(#sd-arrow)" />
                {c.label && <text x={x} y={y - 38} textAnchor="middle" fill="var(--color-primary)" fontSize="10" fontFamily="var(--font-mono)">{c.label}</text>}
              </g>
            );
          }
          const from = stateEdgePoint(a, b), to = stateEdgePoint(b, a);
          const midX = (from.x + to.x) / 2, midY = (from.y + to.y) / 2;
          const path = roundedPath([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
          return (
            <g key={c.id}>
              <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#sd-arrow)" />
              {c.label && <text x={midX + 6} y={midY - 6} fill="var(--color-primary)" fontSize="10" fontFamily="var(--font-mono)">{c.label}</text>}
            </g>
          );
        })}
        {pendingConn && (
          <path d={`M ${pendingConn.fromX} ${pendingConn.fromY} L ${pendingConn.toX} ${pendingConn.toY}`}
            fill="none" stroke="var(--color-primary)" strokeWidth={1.9} strokeLinecap="round" strokeDasharray="4 3" opacity={0.8} />
        )}
      </svg>

      {placed.map((p) => (
        <StateNodeView
          key={p.ref.id}
          node={p}
          onDrag={(dx, dy, done) => patchPos(p.ref.id, p.cx + dx, p.cy + dy, done)}
          canEdit={editing.canEdit}
          onDelete={() => editing.onDeleteAny(p.ref.id)}
          onUpdateText={(text) => editing.onUpdateItem(p.ref.id, { text })}
          onToggleInitial={() => editing.onUpdateItem(p.ref.id, { isInitial: !p.ref.isInitial })}
          onToggleFinal={() => editing.onUpdateItem(p.ref.id, { isFinal: !p.ref.isFinal })}
          onStartConnect={(e, contentEl) => startConnDrag(p.ref.id, e, contentEl)}
        />
      ))}

      {transitions.map((c) => {
        const a = byId.get(c.fromId), b = byId.get(c.toId);
        if (!a || !b) return null;
        const x = a === b ? a.cx : (a.cx + b.cx) / 2;
        const y = a === b ? a.cy - STATE_H / 2 - 44 : (a.cy + b.cy) / 2;
        return (
          <TransitionLabel key={`lbl-${c.id}`} x={x} y={y} conn={c}
            onUpdate={(patch) => editing.onUpdateConnection(c.id, patch)}
            onDelete={() => editing.onDeleteConnection(c.id)} />
        );
      })}
    </CanvasShell>
  );
}

function StateNodeView({
  node, onDrag, onDelete, onUpdateText, onToggleInitial, onToggleFinal, onStartConnect, canEdit,
}: {
  node: Placed;
  /** Called with `done` once more when the drag ends. */
  onDrag: (dx: number, dy: number, done?: boolean) => void;
  /** Asked before a drag starts (a viewer is told who is editing). */
  canEdit: () => boolean;
  onDelete: () => void;
  onUpdateText: (t: string) => void;
  onToggleInitial: () => void;
  onToggleFinal: () => void;
  onStartConnect: (e: React.PointerEvent, contentEl: HTMLElement | null) => void;
}) {
  const worldDrag = useWorldDrag();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
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
      className="group absolute rounded-xl border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      style={{
        left: node.cx - STATE_W / 2, top: node.cy - STATE_H / 2, width: STATE_W, height: STATE_H, zIndex: 10,
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
        <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete state ${node.ref.text}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0">
          <X className="size-3" />
        </button>
      </div>
      <div className="text-xs font-medium leading-snug break-words">
        <InlineEdit value={node.ref.text} onChange={onUpdateText} multiline />
      </div>
      <div className="mt-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition" data-no-pan data-edit-control>
        <button onClick={onToggleInitial} title="Toggle initial state"
          className={node.ref.isInitial ? "text-primary" : "text-muted-foreground hover:text-foreground"}>
          <CircleDot className="size-3" />
        </button>
        <button onClick={onToggleFinal} title="Toggle final state"
          className={"text-[9px] font-mono-tight " + (node.ref.isFinal ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
          final
        </button>
      </div>
      <div
        data-no-pan
        data-edit-control
        onPointerDown={(e) => { e.stopPropagation(); onStartConnect(e, (e.currentTarget.closest("[data-canvas-content]") as HTMLElement) ?? null); }}
        className="absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-primary bg-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 hover:bg-primary transition cursor-crosshair before:absolute before:-inset-2 before:content-['']"
        title="Drag to another state to connect (drag to itself for a self-transition)"
      />
    </div>
  );
}

function TransitionLabel({
  x, y, conn, onUpdate, onDelete,
}: {
  x: number; y: number; conn: Connection;
  onUpdate: (patch: Partial<Connection>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const presenting = !!useArtifactFullscreen()?.presenting;
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  // Present mode shows the event without its editor; close the editor too,
  // so leaving Present does not reopen it with its field grabbing focus.
  useEffect(() => { if (presenting) setOpen(false); }, [presenting]);
  // Esc while the editor is open (in its field, on Delete, or on the event
  // chip itself) closes it without saving what was typed, and is marked
  // handled so it does not also take the artifact out of full screen. Focus
  // goes back to the chip first, so the field's blur sees the old text and
  // saves nothing.
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (!open || e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (fieldRef.current) fieldRef.current.value = conn.label ?? "";
    chipRef.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  const chip = "rounded border border-primary/60 bg-card px-1.5 py-0.5 text-[10px] font-mono-tight text-primary";
  // Presenting: the transition's event stays, as plain words that do not
  // open the edit/delete editor (and a drag over them pans). An unnamed
  // transition's "event" placeholder is only an invitation to edit, so it
  // goes.
  if (presenting) {
    if (!conn.label) return null;
    return (
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y, zIndex: 20 }}>
        <span className={`block ${chip}`}>{conn.label}</span>
      </div>
    );
  }
  return (
    <div data-no-pan onKeyDown={onEditorKeyDown} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y, zIndex: 20 }}>
      <button
        ref={chipRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`${chip} hover:bg-primary/10 transition`}
      >
        {conn.label || "event"}
      </button>
      {open && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 w-52 rounded-lg border bg-card shadow-lg p-2 flex flex-col gap-2">
          <input
            ref={fieldRef}
            autoFocus
            defaultValue={conn.label ?? ""}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = (e.target as HTMLInputElement).value;
              if (v !== (conn.label ?? "")) onUpdate({ label: v });
              setOpen(false);
            }}
            onBlur={(e) => { if (e.target.value !== (conn.label ?? "")) onUpdate({ label: e.target.value }); }}
            placeholder="event [guard] / action"
            aria-label="Transition: event [guard] / action"
            className="w-full text-[11px] px-2 py-1 rounded border bg-background"
          />
          <button onClick={() => { onDelete(); setOpen(false); }} className="w-full text-[11px] px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10">
            Delete transition
          </button>
        </div>
      )}
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
      <span data-edit-control className={`hidden @min-[640px]:flex ${look}`}>Drag connect-handle to link · drag onto self for a self-transition</span>
    </>
  );
}

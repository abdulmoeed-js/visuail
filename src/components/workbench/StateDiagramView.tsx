import { useMemo, useState } from "react";
import type { ProcessModel, Connection, StateItem } from "@/data/samples";
import { Plus, X, GripVertical, CircleDot, Wand2 } from "lucide-react";
import { CanvasShell, useCanvas } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { IdChip } from "./atoms";

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

function layout(states: StateItem[], overrides: Pos) {
  const placed: Placed[] = states.map((s, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const naturalCx = LEFT_PAD + col * (STATE_W + COL_GAP) + STATE_W / 2;
    const naturalCy = TOP_PAD + row * (STATE_H + ROW_GAP) + STATE_H / 2;
    const o = overrides[s.id];
    return { ref: s, cx: o?.cx ?? naturalCx, cy: o?.cy ?? naturalCy };
  });
  const width = Math.max(900, ...placed.map((p) => p.cx + STATE_W / 2 + 60));
  const height = Math.max(560, ...placed.map((p) => p.cy + STATE_H / 2 + 60));
  return { placed, width, height };
}

function roundedPath(points: { x: number; y: number }[], r = 12): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const inRatio = inLen === 0 ? 0 : rr / inLen;
    const outRatio = outLen === 0 ? 0 : rr / outLen;
    const p1 = { x: cur.x - (cur.x - prev.x) * inRatio, y: cur.y - (cur.y - prev.y) * inRatio };
    const p2 = { x: cur.x + (next.x - cur.x) * outRatio, y: cur.y + (next.y - cur.y) * outRatio };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function edgePoint(a: Placed, b: Placed) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (dx === 0 && dy === 0) return { x: a.cx, y: a.cy - STATE_H / 2 };
  if (Math.abs(dx) > Math.abs(dy)) return { x: a.cx + Math.sign(dx) * STATE_W / 2, y: a.cy };
  return { x: a.cx, y: a.cy + Math.sign(dy) * STATE_H / 2 };
}

interface Props {
  model: ProcessModel;
  editing: import("@/lib/artifact-editing").ArtifactEditing;
}

export function StateDiagramView({ model, editing }: Props) {
  const [overrides, setOverrides] = useState<Pos>({});
  const [pendingConn, setPendingConn] = useState<null | { fromId: string; fromX: number; fromY: number; toX: number; toY: number }>(null);
  const states = useMemo(() => model.states ?? [], [model.states]);
  const { placed, width, height } = useMemo(() => layout(states, overrides), [states, overrides]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.ref.id, p])), [placed]);
  const transitions = model.connections ?? [];

  const patchPos = (id: string, cx: number, cy: number) =>
    setOverrides((cur) => ({ ...cur, [id]: { cx, cy } }));

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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest("[data-state-node]") as HTMLElement | null;
      const toId = target?.dataset.stateNode;
      if (toId) editing.onAddConnection(fromId, toId);
      setPendingConn(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const commitAdd = () => {
    const t = draft.trim();
    if (t) editing.onAddState(t);
    setDraft(""); setAdding(false);
  };

  return (
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="State diagram — fullscreen"
      bottomLeft={<Legend />}
      bottomRight={
        adding ? (
          <div className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm">
            <input
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
              placeholder="New state"
              className="h-8 w-44 text-sm px-2 rounded border bg-background"
            />
            <button onClick={commitAdd} className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><Plus className="size-4" /></button>
            <button onClick={() => { setAdding(false); setDraft(""); }} className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><X className="size-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} data-no-pan className="h-8 px-2.5 rounded-md border bg-card/95 backdrop-blur shadow-sm text-xs flex items-center gap-1.5 hover:border-primary/60">
            <Plus className="size-3.5 text-primary" /> Add state
          </button>
        )
      }
    >
      {states.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground pointer-events-none">
          <span>No states yet.</span>
          <button onClick={() => setAdding(true)} data-no-pan className="pointer-events-auto flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs hover:border-primary/60 shadow-sm">
            <Wand2 className="size-3.5 text-primary" /> Add a state
          </button>
        </div>
      )}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none" }}>
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
          const from = edgePoint(a, b), to = edgePoint(b, a);
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
          onDrag={(dx, dy) => patchPos(p.ref.id, p.cx + dx, p.cy + dy)}
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
  node, onDrag, onDelete, onUpdateText, onToggleInitial, onToggleFinal, onStartConnect,
}: {
  node: Placed;
  onDrag: (dx: number, dy: number) => void;
  onDelete: () => void;
  onUpdateText: (t: string) => void;
  onToggleInitial: () => void;
  onToggleFinal: () => void;
  onStartConnect: (e: React.PointerEvent, contentEl: HTMLElement | null) => void;
}) {
  const { zoom } = useCanvas();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => onDrag((ev.clientX - start.x) / zoom, (ev.clientY - start.y) / zoom);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical data-no-pan onPointerDown={onPointerDown} className="size-3.5 text-muted-foreground/70 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0" />
          <IdChip id={node.ref.id} tone="primary" />
        </div>
        <button onClick={onDelete} data-no-pan className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0">
          <X className="size-3" />
        </button>
      </div>
      <div className="text-xs font-medium leading-snug break-words">
        <InlineEdit value={node.ref.text} onChange={onUpdateText} multiline />
      </div>
      <div className="mt-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition" data-no-pan>
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
        onPointerDown={(e) => { e.stopPropagation(); onStartConnect(e, (e.currentTarget.closest("[data-canvas-content]") as HTMLElement) ?? null); }}
        className="absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-primary bg-card shadow-sm opacity-0 group-hover:opacity-100 hover:scale-125 transition cursor-crosshair"
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
  return (
    <div data-no-pan className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y, zIndex: 20 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded border border-primary/60 bg-card px-1.5 py-0.5 text-[10px] font-mono-tight text-primary shadow-sm hover:bg-primary/10 transition"
      >
        {conn.label || "event"}
      </button>
      {open && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 w-52 rounded-lg border bg-card shadow-lg p-2 flex flex-col gap-2">
          <input
            autoFocus
            defaultValue={conn.label ?? ""}
            onKeyDown={(e) => { if (e.key === "Enter") { onUpdate({ label: (e.target as HTMLInputElement).value }); setOpen(false); } }}
            onBlur={(e) => onUpdate({ label: e.target.value })}
            placeholder="event [guard] / action"
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
  const chip = "flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground";
  return (
    <>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-full bg-foreground" /> Initial</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-full border-2 border-primary" /> Final (ring)</span>
      <span className={chip}>Drag connect-handle to link · drag onto self for a self-transition</span>
    </>
  );
}

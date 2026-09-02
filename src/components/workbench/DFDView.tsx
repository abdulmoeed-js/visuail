import { useMemo, useState } from "react";
import type { ProcessModel, Connection } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { cn } from "@/lib/utils";
import { Plus, X, GripVertical, Database, Square, CircleDot } from "lucide-react";
import { CanvasShell, useCanvas } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { IdChip } from "./atoms";

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
}

type Pos = Record<string, { cx: number; cy: number }>;

function layoutRow(ids: { id: string; text: string }[], y: number, w: number, h: number, labelFor: (i: number) => string, kind: NodeKind, overrides: Pos): DFDNode[] {
  const totalW = ids.length * w + Math.max(0, ids.length - 1) * COL_GAP;
  const startX = Math.max(40, 500 - totalW / 2);
  return ids.map((it, i) => {
    const naturalCx = startX + i * (w + COL_GAP) + w / 2;
    const o = overrides[it.id];
    return { kind, id: it.id, text: it.text, label: labelFor(i), cx: o?.cx ?? naturalCx, cy: o?.cy ?? y, w, h };
  });
}

function layout(model: ProcessModel, overrides: Pos) {
  const entities = layoutRow(model.externalEntities ?? [], TOP_PAD + ENTITY_H / 2, ENTITY_W, ENTITY_H, () => "", "entity", overrides);
  const processes = layoutRow(model.steps, TOP_PAD + ENTITY_H + ROW_GAP + PROC_H / 2, PROC_W, PROC_H, (i) => `${i + 1}.0`, "process", overrides);
  const stores = layoutRow(model.dataStores ?? [], TOP_PAD + ENTITY_H + ROW_GAP + PROC_H + ROW_GAP + STORE_H / 2, STORE_W, STORE_H, (i) => `D${i + 1}`, "store", overrides);
  const all = [...entities, ...processes, ...stores];
  const width = Math.max(1000, ...all.map((n) => n.cx + n.w / 2 + 60));
  const height = Math.max(600, ...all.map((n) => n.cy + n.h / 2 + 60));
  return { nodes: all, width, height };
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

function edgePoint(a: DFDNode, b: DFDNode) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: a.cx + Math.sign(dx) * a.w / 2, y: a.cy };
  }
  return { x: a.cx, y: a.cy + Math.sign(dy) * a.h / 2 };
}

interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

export function DFDView({ model, editing }: Props) {
  const [overrides, setOverrides] = useState<Pos>({});
  const [pendingConn, setPendingConn] = useState<null | { fromId: string; fromX: number; fromY: number; toX: number; toY: number }>(null);
  const { nodes, width, height } = useMemo(() => layout(model, overrides), [model, overrides]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const flows = model.connections ?? [];

  const patchPos = (id: string, cx: number, cy: number) =>
    setOverrides((cur) => ({ ...cur, [id]: { cx, cy } }));

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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = el?.closest("[data-dfd-node]") as HTMLElement | null;
      const toId = target?.dataset.dfdNode;
      if (toId && toId !== fromId) editing.onAddConnection(fromId, toId);
      setPendingConn(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const [adding, setAdding] = useState<null | "process" | "store" | "entity">(null);
  const [draft, setDraft] = useState("");
  const commitAdd = () => {
    const t = draft.trim();
    if (!t || !adding) { setAdding(null); setDraft(""); return; }
    if (adding === "process") editing.onAddStep(t);
    else if (adding === "store") editing.onAddDataStore(t);
    else editing.onAddExternalEntity(t);
    setDraft(""); setAdding(null);
  };

  const isEmpty = model.steps.length === 0 && (model.dataStores ?? []).length === 0 && (model.externalEntities ?? []).length === 0;

  return (
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="Data flow diagram — fullscreen"
      bottomLeft={<Legend />}
      bottomRight={
        adding ? (
          <div className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm">
            <input
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") { setAdding(null); setDraft(""); } }}
              placeholder={adding === "process" ? "New process" : adding === "store" ? "New data store" : "New external entity"}
              className="h-8 w-52 text-sm px-2 rounded border bg-background"
            />
            <button onClick={commitAdd} className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><Plus className="size-4" /></button>
            <button onClick={() => { setAdding(null); setDraft(""); }} className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><X className="size-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1" data-no-pan>
            <button onClick={() => setAdding("process")} className="h-8 px-2.5 rounded-md border bg-card/95 backdrop-blur shadow-sm text-xs flex items-center gap-1.5 hover:border-primary/60">
              <CircleDot className="size-3.5 text-primary" /> Process
            </button>
            <button onClick={() => setAdding("store")} className="h-8 px-2.5 rounded-md border bg-card/95 backdrop-blur shadow-sm text-xs flex items-center gap-1.5 hover:border-primary/60">
              <Database className="size-3.5 text-primary" /> Data store
            </button>
            <button onClick={() => setAdding("entity")} className="h-8 px-2.5 rounded-md border bg-card/95 backdrop-blur shadow-sm text-xs flex items-center gap-1.5 hover:border-primary/60">
              <Square className="size-3.5 text-primary" /> External entity
            </button>
          </div>
        )
      }
    >
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
          Add a process, data store, or external entity below to start the diagram.
        </div>
      )}
      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none" }}>
        <defs>
          <marker id="dfd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-verified)" />
          </marker>
        </defs>
        {flows.map((c) => {
          const a = byId.get(c.fromId), b = byId.get(c.toId);
          if (!a || !b) return null;
          const from = edgePoint(a, b), to = edgePoint(b, a);
          const midX = (from.x + to.x) / 2, midY = (from.y + to.y) / 2;
          const path = roundedPath([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
          return (
            <g key={c.id}>
              <path d={path} fill="none" stroke="var(--color-verified)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#dfd-arrow)" />
              {c.label && (
                <text x={midX + 6} y={midY - 6} fill="var(--color-verified)" fontSize="10" fontFamily="var(--font-mono)">{c.label}</text>
              )}
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
          onDrag={(dx, dy) => patchPos(n.id, n.cx + dx, n.cy + dy)}
          onDelete={() => editing.onDeleteAny(n.id)}
          onUpdate={(text) => editing.onUpdateItem(n.id, { text })}
          onStartConnect={(e, contentEl) => startConnDrag(n.id, e, contentEl)}
        />
      ))}

      {flows.map((c) => {
        const a = byId.get(c.fromId), b = byId.get(c.toId);
        if (!a || !b) return null;
        return (
          <FlowLabel
            key={`lbl-${c.id}`}
            x={(a.cx + b.cx) / 2} y={(a.cy + b.cy) / 2}
            conn={c}
            onUpdate={(patch) => editing.onUpdateConnection(c.id, patch)}
            onDelete={() => editing.onDeleteConnection(c.id)}
          />
        );
      })}
    </CanvasShell>
  );
}

function DFDNodeView({
  node, onDrag, onDelete, onUpdate, onStartConnect,
}: {
  node: DFDNode;
  onDrag: (dx: number, dy: number) => void;
  onDelete: () => void;
  onUpdate: (text: string) => void;
  onStartConnect: (e: React.PointerEvent, contentEl: HTMLElement | null) => void;
}) {
  const { zoom } = useCanvas();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      onDrag((ev.clientX - last.x) / zoom, (ev.clientY - last.y) / zoom);
      last = { x: ev.clientX, y: ev.clientY };
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const style: React.CSSProperties = {
    left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h, zIndex: 10,
  };

  const header = (
    <div className="flex items-center justify-between gap-1 px-2 pt-1.5">
      <div className="flex items-center gap-1 min-w-0">
        <GripVertical data-no-pan onPointerDown={onPointerDown} className="size-3.5 text-muted-foreground/70 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0" />
        {node.label && <IdChip id={node.label} tone="primary" />}
      </div>
      <button onClick={onDelete} data-no-pan className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition shrink-0">
        <X className="size-3" />
      </button>
    </div>
  );

  const connectHandle = (
    <div
      data-no-pan
      onPointerDown={(e) => { e.stopPropagation(); onStartConnect(e, (e.currentTarget.closest("[data-canvas-content]") as HTMLElement) ?? null); }}
      className="absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-verified bg-card shadow-sm opacity-0 group-hover:opacity-100 hover:scale-125 transition cursor-crosshair"
      title="Drag to another node to connect"
    />
  );

  if (node.kind === "process") {
    return (
      <div data-node data-dfd-node={node.id} className="group absolute rounded-full border-2 border-primary/60 bg-card shadow-sm flex flex-col items-center justify-center gap-0.5 text-center px-3" style={style}>
        {header}
        <div className="text-xs font-medium leading-snug break-words px-1">
          <InlineEdit value={node.text} onChange={onUpdate} multiline />
        </div>
        {connectHandle}
      </div>
    );
  }
  if (node.kind === "store") {
    return (
      <div data-node data-dfd-node={node.id} className="group absolute border-t-2 border-b-2 border-primary/60 bg-card shadow-sm flex flex-col justify-center gap-0.5 px-2" style={style}>
        {header}
        <div className="text-xs font-medium leading-snug break-words px-1">
          <InlineEdit value={node.text} onChange={onUpdate} multiline />
        </div>
        {connectHandle}
      </div>
    );
  }
  return (
    <div data-node data-dfd-node={node.id} className="group absolute rounded-md border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-0.5" style={style}>
      {header}
      <div className="text-xs font-medium leading-snug break-words px-2 pb-1.5">
        <InlineEdit value={node.text} onChange={onUpdate} multiline />
      </div>
      {connectHandle}
    </div>
  );
}

function FlowLabel({
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
        className="rounded border border-verified/60 bg-card px-1.5 py-0.5 text-[10px] font-mono-tight text-verified shadow-sm hover:bg-verified/10 transition"
      >
        {conn.label || "label"}
      </button>
      {open && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 w-52 rounded-lg border bg-card shadow-lg p-2 flex flex-col gap-2">
          <input
            autoFocus
            defaultValue={conn.label ?? ""}
            onKeyDown={(e) => { if (e.key === "Enter") { onUpdate({ label: (e.target as HTMLInputElement).value }); setOpen(false); } }}
            onBlur={(e) => onUpdate({ label: e.target.value })}
            placeholder="Data flow label"
            className="w-full text-[11px] px-2 py-1 rounded border bg-background"
          />
          <button onClick={() => { onDelete(); setOpen(false); }} className="w-full text-[11px] px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10">
            Delete flow
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
      <span className={chip}><CircleDot className="size-3 text-primary" /> Process</span>
      <span className={cn(chip)}><Database className="size-3 text-primary" /> Data store</span>
      <span className={chip}><Square className="size-3 text-primary" /> External entity</span>
      <span className={chip}>Drag connect-handle to link · click a flow label to rename</span>
    </>
  );
}

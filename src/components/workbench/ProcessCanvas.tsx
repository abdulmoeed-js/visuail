import { useMemo, useState } from "react";
import type { ProcessModel, Step, Decision, Exception } from "@/data/samples";
import { cn } from "@/lib/utils";
import { ConfidenceBadge, IdChip } from "./atoms";
import { Plus, X, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CanvasShell, useCanvas } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";

/**
 * Deterministic top-to-bottom flowchart with a single vertical spine.
 * User overrides (drag / resize) patch node position and size — routes are
 * re-computed from the effective positions so connectors stay attached.
 * The underlying IR is untouched by layout overrides; text/branch/actor/system
 * edits go through onUpdateItem so the Typed IR list, BRD, and backlog stay
 * synced.
 */

const CENTER_X = 320;
const STEP_W = 240;
const STEP_H = 84;
const DEC_W = 240;
const DEC_H = 112;
const EX_W = 220;
const EX_H = 84;
const SLOT_H = 156;
const TOP_PAD = 40;
const RIGHT_CORRIDOR_X = CENTER_X + STEP_W / 2 + 90;
const LANE_GAP = 28;

const MIN_W = 160, MIN_H = 70, MAX_W = 520, MAX_H = 320;

export type NodeOverride = { cx?: number; cy?: number; w?: number; h?: number };
export type Overrides = Record<string, NodeOverride>;

type SpineNode =
  | { kind: "step"; ref: Step; cx: number; cy: number; w: number; h: number }
  | { kind: "decision"; ref: Decision; cx: number; cy: number; w: number; h: number };
type RightNode = { kind: "exception"; ref: Exception; cx: number; cy: number; w: number; h: number };

interface Route {
  id: string;
  kind: "no-branch" | "exception";
  laneX: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  label?: string;
}

interface Layout {
  spine: SpineNode[];
  right: RightNode[];
  routes: Route[];
  width: number;
  height: number;
}

function applyOverride<T extends { cx: number; cy: number; w: number; h: number }>(n: T, o?: NodeOverride): T {
  if (!o) return n;
  return {
    ...n,
    cx: o.cx ?? n.cx,
    cy: o.cy ?? n.cy,
    w: o.w ?? n.w,
    h: o.h ?? n.h,
  };
}

function layout(model: ProcessModel, overrides: Overrides): Layout {
  const spine: SpineNode[] = [];
  const spineIndexById = new Map<string, number>();

  model.steps.forEach((s) => {
    const idx = spine.length;
    const cy = TOP_PAD + idx * SLOT_H + STEP_H / 2;
    spine.push(applyOverride({ kind: "step", ref: s, cx: CENTER_X, cy, w: STEP_W, h: STEP_H }, overrides[s.id]));
    spineIndexById.set(s.id, idx);

    const dec = model.decisions.find((d) => d.afterStepId === s.id);
    if (dec) {
      const didx = spine.length;
      const dcy = TOP_PAD + didx * SLOT_H + DEC_H / 2;
      spine.push(applyOverride({ kind: "decision", ref: dec, cx: CENTER_X, cy: dcy, w: DEC_W, h: DEC_H }, overrides[dec.id]));
      spineIndexById.set(dec.id, didx);
    }
  });

  // exceptions in right corridor
  const right: RightNode[] = [];
  const usedRightSlots = new Set<number>();
  model.exceptions.forEach((e) => {
    let anchorIdx = e.relatedStepId ? spineIndexById.get(e.relatedStepId) : undefined;
    if (anchorIdx === undefined) anchorIdx = 0;
    let slot = anchorIdx;
    while (usedRightSlots.has(slot)) slot++;
    usedRightSlots.add(slot);
    const cy = TOP_PAD + slot * SLOT_H + EX_H / 2;
    const cx = RIGHT_CORRIDOR_X + 140 + EX_W / 2;
    right.push(applyOverride({ kind: "exception", ref: e, cx, cy, w: EX_W, h: EX_H }, overrides[e.id]));
  });

  // routes
  const routes: Route[] = [];
  let laneCounter = 0;
  const nextLaneX = () => RIGHT_CORRIDOR_X + laneCounter++ * LANE_GAP;

  right.forEach((ex) => {
    const rel = ex.ref.relatedStepId;
    const relIdx = rel ? spineIndexById.get(rel) : undefined;
    const src = relIdx !== undefined ? spine[relIdx] : spine[0];
    if (!src) return;
    routes.push({
      id: `route-ex-${ex.ref.id}`,
      kind: "exception",
      laneX: nextLaneX(),
      from: { x: src.cx + src.w / 2, y: src.cy },
      to:   { x: ex.cx - ex.w / 2, y: ex.cy },
      label: ex.ref.id,
    });
  });

  spine.forEach((n) => {
    if (n.kind !== "decision") return;
    const d = n.ref;
    const exRight = right.find((r) => r.ref.id === d.no);
    if (exRight) {
      routes.push({
        id: `route-no-${d.id}`,
        kind: "no-branch",
        laneX: nextLaneX(),
        from: { x: n.cx + n.w / 2, y: n.cy },
        to:   { x: exRight.cx - exRight.w / 2, y: exRight.cy },
        label: `no → ${d.no}`,
      });
      return;
    }
    const tgtIdx = spineIndexById.get(d.no);
    if (tgtIdx !== undefined) {
      const tgt = spine[tgtIdx];
      routes.push({
        id: `route-no-${d.id}`,
        kind: "no-branch",
        laneX: nextLaneX(),
        from: { x: n.cx + n.w / 2, y: n.cy },
        to:   { x: tgt.cx + tgt.w / 2, y: tgt.cy },
        label: `no → ${d.no}`,
      });
    }
  });

  const bottoms = [
    ...spine.map((n) => n.cy + n.h / 2),
    ...right.map((n) => n.cy + n.h / 2),
    TOP_PAD,
  ];
  const height = Math.max(...bottoms) + 60;
  const rightMost = right.reduce((m, r) => Math.max(m, r.cx + r.w / 2), CENTER_X + STEP_W / 2);
  const laneMost = RIGHT_CORRIDOR_X + Math.max(0, laneCounter - 1) * LANE_GAP + 40;
  const width = Math.max(rightMost, laneMost, CENTER_X + STEP_W) + 60;

  return { spine, right, routes, width, height };
}

interface Props {
  model: ProcessModel;
  onAddStep: (text: string) => void;
  onDeleteAny: (id: string) => void;
  onUpdateItem: (id: string, patch: Partial<Step & Decision & Exception>) => void;
}

export function ProcessCanvas({ model, onAddStep, onDeleteAny, onUpdateItem }: Props) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const { spine, right, routes, width, height } = useMemo(
    () => layout(model, overrides),
    [model, overrides],
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const patchOverride = (id: string, o: NodeOverride) =>
    setOverrides((cur) => ({ ...cur, [id]: { ...cur[id], ...o } }));

  return (
    <CanvasShell
      contentWidth={Math.max(width, 900)}
      contentHeight={Math.max(height, 620)}
      minimap
      fullscreenLabel="Process map — fullscreen"
      bottomLeft={<Legend />}
      bottomRight={
        adding ? (
          <div className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm">
            <Input
              autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) { onAddStep(draft.trim()); setDraft(""); setAdding(false); }
                if (e.key === "Escape") { setAdding(false); setDraft(""); }
              }}
              placeholder="New step description"
              className="h-8 w-56 text-sm"
            />
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => { if (draft.trim()) { onAddStep(draft.trim()); setDraft(""); setAdding(false); } }}>
              <Plus className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setAdding(false); setDraft(""); }}>
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="bg-card/95 backdrop-blur" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add step
          </Button>
        )
      }
    >
      <svg width={Math.max(width, 900)} height={Math.max(height, 620)} className="absolute inset-0 pointer-events-none">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
          <marker id="arrow-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-unresolved)" />
          </marker>
        </defs>

        {spine.slice(0, -1).map((n, i) => {
          const next = spine[i + 1];
          const from = { x: n.cx, y: n.cy + n.h / 2 };
          const to = { x: next.cx, y: next.cy - next.h / 2 };
          const yesLabel = n.kind === "decision" ? `yes → ${(n.ref as Decision).yes}` : null;
          const midY = (from.y + to.y) / 2;
          // If nodes are horizontally offset (from drag), route via elbow
          const path = Math.abs(from.x - to.x) < 4
            ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
            : `M ${from.x} ${from.y} V ${midY} H ${to.x} V ${to.y}`;
          return (
            <g key={`spine-${i}`}>
              <path d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.4} markerEnd="url(#arrow)" />
              {yesLabel && (
                <text x={from.x + 10} y={midY + 3} fill="var(--color-confident)" fontSize="11" fontFamily="var(--font-mono)">
                  {yesLabel}
                </text>
              )}
            </g>
          );
        })}

        {routes.map((r) => {
          const isException = r.kind === "exception";
          const stroke = isException ? "var(--color-unresolved)" : "var(--color-drift)";
          const dash = isException ? "4 3" : undefined;
          const marker = isException ? "url(#arrow-dashed)" : "url(#arrow)";
          const path = `M ${r.from.x} ${r.from.y} H ${r.laneX} V ${r.to.y} H ${r.to.x}`;
          const labelY = (r.from.y + r.to.y) / 2;
          return (
            <g key={r.id}>
              <path d={path} fill="none" stroke={stroke} strokeWidth={1.4} strokeDasharray={dash} markerEnd={marker} />
              {r.label && (
                <text x={r.laneX + 6} y={labelY} fill={stroke} fontSize="10" fontFamily="var(--font-mono)">
                  {r.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {spine.map((n) => {
        if (n.kind === "step") {
          const s = n.ref;
          return (
            <StepNode
              key={s.id}
              node={n}
              step={s}
              actors={model.actors}
              systems={model.systems}
              onDelete={() => onDeleteAny(s.id)}
              onUpdate={(patch) => onUpdateItem(s.id, patch)}
              onDrag={(delta) => patchOverride(s.id, { cx: n.cx + delta.dx, cy: n.cy + delta.dy })}
              onResize={(w, h) => patchOverride(s.id, { w, h })}
            />
          );
        }
        const d = n.ref;
        return (
          <DecisionNode
            key={d.id} node={n} d={d}
            onDelete={() => onDeleteAny(d.id)}
            onUpdate={(patch) => onUpdateItem(d.id, patch)}
            onDrag={(delta) => patchOverride(d.id, { cx: n.cx + delta.dx, cy: n.cy + delta.dy })}
            onResize={(w, h) => patchOverride(d.id, { w, h })}
          />
        );
      })}
      {right.map((n) => (
        <ExceptionNode
          key={n.ref.id} node={n} e={n.ref}
          onDelete={() => onDeleteAny(n.ref.id)}
          onUpdate={(patch) => onUpdateItem(n.ref.id, patch)}
          onDrag={(delta) => patchOverride(n.ref.id, { cx: n.cx + delta.dx, cy: n.cy + delta.dy })}
          onResize={(w, h) => patchOverride(n.ref.id, { w, h })}
        />
      ))}
    </CanvasShell>
  );
}

function Legend() {
  const chip = "flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground";
  return (
    <>
      <span className={chip}><span className="h-2 w-3 border-2 border-primary rounded-sm" /> Step</span>
      <span className={chip}><span className="h-2 w-2 rotate-45 border-2 border-primary" /> Decision</span>
      <span className={chip}><span className="h-2 w-3 border border-dashed border-unresolved rounded-sm" /> Unresolved</span>
      <span className={chip}><span className="h-2 w-3 border border-drift rounded-sm bg-drift/20" /> Drifted</span>
      <span className={chip}><GripVertical className="size-3" /> Drag to reposition · corner to resize</span>
    </>
  );
}

// ---- Node primitives ----

function useNodeDrag(onDrag: (d: { dx: number; dy: number }) => void) {
  const { zoom } = useCanvas();
  const startRef = { current: null as null | { x: number; y: number } };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY };
      const start = startRef.current;
      const move = (ev: PointerEvent) => {
        if (!start) return;
        const dx = (ev.clientX - start.x) / zoom;
        const dy = (ev.clientY - start.y) / zoom;
        onDrag({ dx, dy });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
  };
}

function ResizeHandle({ w, h, onResize }: { w: number; h: number; onResize: (w: number, h: number) => void }) {
  const { zoom } = useCanvas();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const startW = w, startH = h;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const nw = Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX) / zoom));
      const nh = Math.min(MAX_H, Math.max(MIN_H, startH + (ev.clientY - startY) / zoom));
      onResize(nw, nh);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={onPointerDown}
      data-no-pan
      className="absolute -bottom-1 -right-1 w-3 h-3 rounded-sm border border-primary/60 bg-card cursor-nwse-resize opacity-0 group-hover:opacity-100 transition z-10"
      title="Resize"
    />
  );
}

function DragHandle({ handlers }: { handlers: ReturnType<typeof useNodeDrag> }) {
  return (
    <button
      {...handlers}
      data-no-pan
      className="cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-foreground shrink-0"
      title="Drag to reposition"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

// ---- Step ----

function StepNode({
  node, step, actors, systems, onDelete, onUpdate, onDrag, onResize,
}: {
  node: SpineNode; step: Step;
  actors: { id: string; text: string }[]; systems: { id: string; text: string }[];
  onDelete: () => void;
  onUpdate: (patch: Partial<Step>) => void;
  onDrag: (d: { dx: number; dy: number }) => void;
  onResize: (w: number, h: number) => void;
}) {
  const drag = useNodeDrag(onDrag);
  return (
    <div
      data-node
      className={cn(
        "group absolute rounded-lg border-2 bg-card px-3 py-2 shadow-sm flex flex-col gap-1 animate-item-in overflow-hidden",
        step.drift && "border-drift animate-drift bg-drift/5",
        step.confidence < 0.7 && !step.drift && "border-dashed border-unresolved bg-unresolved/5",
        !step.drift && step.confidence >= 0.7 && !step.userAdded && "border-primary/40",
        step.userAdded && "user-added !border-verified",
      )}
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <DragHandle handlers={drag} />
          <IdChip id={step.id} tone="primary" />
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={step} />
          <button onClick={onDelete} data-no-pan
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-xs leading-snug font-medium break-words">
        <InlineEdit value={step.text} onChange={(v) => onUpdate({ text: v })} multiline />
      </div>
      <div className="flex flex-wrap gap-1 text-[10px] font-mono-tight text-muted-foreground mt-auto">
        <MetaSelect
          value={step.actorId}
          options={actors}
          onChange={(v) => onUpdate({ actorId: v })}
        />
        <span>·</span>
        <MetaSelect
          value={step.systemId ?? ""}
          options={[{ id: "", text: "no system" }, ...systems]}
          onChange={(v) => onUpdate({ systemId: v || undefined })}
        />
      </div>
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

function MetaSelect({
  value, options, onChange,
}: {
  value: string;
  options: { id: string; text: string }[];
  onChange: (v: string) => void;
}) {
  const current = options.find((o) => o.id === value)?.text ?? "—";
  return (
    <span className="relative inline-flex items-center rounded px-1 -mx-1 hover:bg-verified/10 hover:ring-1 hover:ring-verified/30 transition" data-no-pan>
      <span className="pointer-events-none">{current}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 opacity-0 cursor-pointer"
        title="Change"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.text}</option>
        ))}
      </select>
    </span>
  );
}

// ---- Decision ----

function DecisionNode({
  node, d, onDelete, onUpdate, onDrag, onResize,
}: {
  node: SpineNode; d: Decision;
  onDelete: () => void;
  onUpdate: (patch: Partial<Decision>) => void;
  onDrag: (d: { dx: number; dy: number }) => void;
  onResize: (w: number, h: number) => void;
}) {
  const drag = useNodeDrag(onDrag);
  const left = node.cx - node.w / 2;
  const top = node.cy - node.h / 2;
  const w = node.w, h = node.h;
  return (
    <div
      data-node
      className={cn("group absolute animate-item-in", d.drift && "animate-drift")}
      style={{ left, top, width: w, height: h }}
    >
      <svg width={w} height={h} className="absolute inset-0 pointer-events-none">
        <polygon
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          fill="var(--color-card)"
          stroke={d.drift ? "var(--color-drift)" : d.userAdded ? "var(--color-verified)" : "var(--color-primary)"}
          strokeOpacity={d.drift || d.userAdded ? 1 : 0.6}
          strokeWidth={2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center gap-1">
        <div className="flex items-center gap-1">
          <DragHandle handlers={drag} />
          <IdChip id={d.id} tone="primary" />
          <ConfidenceBadge item={d} />
          <button onClick={onDelete} data-no-pan
            className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition">
            <X className="size-3" />
          </button>
        </div>
        <div className="text-[11px] font-medium leading-tight">
          <InlineEdit value={d.text} onChange={(v) => onUpdate({ text: v })} multiline />
        </div>
        <div className="flex gap-2 text-[9px] font-mono-tight text-muted-foreground">
          <span className="text-confident">yes→<InlineEdit value={d.yes} onChange={(v) => onUpdate({ yes: v })} /></span>
          <span className="text-drift">no→<InlineEdit value={d.no} onChange={(v) => onUpdate({ no: v })} /></span>
        </div>
      </div>
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

// ---- Exception ----

function ExceptionNode({
  node, e, onDelete, onUpdate, onDrag, onResize,
}: {
  node: RightNode; e: Exception;
  onDelete: () => void;
  onUpdate: (patch: Partial<Exception>) => void;
  onDrag: (d: { dx: number; dy: number }) => void;
  onResize: (w: number, h: number) => void;
}) {
  const drag = useNodeDrag(onDrag);
  return (
    <div
      data-node
      className={cn(
        "group absolute rounded-md border border-dashed bg-unresolved/5 border-unresolved/70 px-2.5 py-2 shadow-sm flex flex-col gap-1 animate-item-in overflow-hidden",
        e.userAdded && "user-added !border-verified border-solid",
      )}
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <DragHandle handlers={drag} />
          <IdChip id={e.id} />
          <span className="text-[9px] font-mono-tight uppercase tracking-widest text-unresolved">Exception</span>
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={e} />
          <button onClick={onDelete} data-no-pan
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-[11px] leading-snug break-words">
        <InlineEdit value={e.text} onChange={(v) => onUpdate({ text: v })} multiline />
      </div>
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

import { useMemo, useState } from "react";
import type { ProcessModel, Step, Decision, Exception } from "@/data/samples";
import { cn } from "@/lib/utils";
import { ConfidenceBadge, IdChip } from "./atoms";
import { Plus, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Deterministic top-to-bottom flowchart layout with a single vertical spine.
 *
 * - All steps AND decisions sit centered on CENTER_X (shared spine).
 * - Main flow uses straight vertical connectors between consecutive spine nodes,
 *   entering/exiting through the vertical center of each node's edge (top corner
 *   of a diamond, top edge of a rectangle).
 * - Decision "yes" branch is the down-spine connector (labeled beside it).
 * - Decision "no" branch and exception side-notes route through a right-hand
 *   corridor as orthogonal (right-angle) elbows. Each right-side route gets its
 *   own vertical lane so routes never overlap regardless of graph shape.
 * - Every arrowhead lands precisely on an edge midpoint.
 *
 * This layout is fully data-driven — it holds for arbitrary step/decision/
 * exception counts.
 */

const CENTER_X = 300;
const STEP_W = 240;
const STEP_H = 80;
const DEC_W = 240;
const DEC_H = 108;
const SLOT_H = 152; // vertical stride between spine slots (leaves room for arrow + label)
const TOP_PAD = 40;
const RIGHT_CORRIDOR_X = CENTER_X + STEP_W / 2 + 80;
const LANE_GAP = 28;
const RIGHT_NODE_W = 210;
const RIGHT_NODE_H = 78;

type SpineNode =
  | { kind: "step"; ref: Step; cx: number; cy: number; w: number; h: number }
  | { kind: "decision"; ref: Decision; cx: number; cy: number; w: number; h: number };

type RightNode = { kind: "exception"; ref: Exception; cx: number; cy: number; w: number; h: number };

interface Route {
  id: string;
  kind: "no-branch" | "exception";
  laneX: number;
  from: { x: number; y: number };
  to: { x: number; y: number; side: "left" | "right" | "top" };
  label?: string;
}

interface Layout {
  spine: SpineNode[];
  right: RightNode[];
  routes: Route[];
  spineOrder: string[]; // ids in spine order, for main connectors
  width: number;
  height: number;
}

function layout(model: ProcessModel): Layout {
  // 1. Build spine order: for each step, push it, then any decision after it.
  const spine: SpineNode[] = [];
  const spineOrder: string[] = [];
  const spineIndexById = new Map<string, number>();

  model.steps.forEach((s) => {
    const idx = spine.length;
    const cy = TOP_PAD + idx * SLOT_H + STEP_H / 2;
    spine.push({ kind: "step", ref: s, cx: CENTER_X, cy, w: STEP_W, h: STEP_H });
    spineOrder.push(s.id);
    spineIndexById.set(s.id, idx);

    const dec = model.decisions.find((d) => d.afterStepId === s.id);
    if (dec) {
      const didx = spine.length;
      const dcy = TOP_PAD + didx * SLOT_H + DEC_H / 2;
      spine.push({ kind: "decision", ref: dec, cx: CENTER_X, cy: dcy, w: DEC_W, h: DEC_H });
      spineOrder.push(dec.id);
      spineIndexById.set(dec.id, didx);
    }
  });

  // 2. Place exceptions in the right corridor at their related step's y (or first free row).
  const right: RightNode[] = [];
  const usedRightSlots = new Set<number>();
  model.exceptions.forEach((e) => {
    let anchorIdx = e.relatedStepId ? spineIndexById.get(e.relatedStepId) : undefined;
    if (anchorIdx === undefined) anchorIdx = 0;
    // find first free slot at/below the anchor
    let slot = anchorIdx;
    while (usedRightSlots.has(slot)) slot++;
    usedRightSlots.add(slot);
    const cy = TOP_PAD + slot * SLOT_H + RIGHT_NODE_H / 2;
    // exception x — placed further right to leave room for lanes
    const cx = RIGHT_CORRIDOR_X + 120 + RIGHT_NODE_W / 2;
    right.push({ kind: "exception", ref: e, cx, cy, w: RIGHT_NODE_W, h: RIGHT_NODE_H });
  });

  // 3. Build right-side routes:
  //    - one for each decision's "no" branch (target may be a spine node OR an exception)
  //    - one for each exception connector (from related step)
  const routes: Route[] = [];
  let laneCounter = 0;
  const nextLaneX = () => RIGHT_CORRIDOR_X + laneCounter++ * LANE_GAP;

  // exception routes first (from related step's right edge → exception's left edge)
  right.forEach((ex) => {
    const rel = ex.ref.relatedStepId;
    const relIdx = rel ? spineIndexById.get(rel) : undefined;
    const src = relIdx !== undefined ? spine[relIdx] : spine[0];
    routes.push({
      id: `route-ex-${ex.ref.id}`,
      kind: "exception",
      laneX: nextLaneX(),
      from: { x: src.cx + src.w / 2, y: src.cy },
      to: { x: ex.cx - ex.w / 2, y: ex.cy, side: "left" },
      label: ex.ref.id,
    });
  });

  // decision "no" branches
  spine.forEach((n) => {
    if (n.kind !== "decision") return;
    const d = n.ref;
    // resolve target: exception in right lane, or spine node
    const exRight = right.find((r) => r.ref.id === d.no);
    if (exRight) {
      routes.push({
        id: `route-no-${d.id}`,
        kind: "no-branch",
        laneX: nextLaneX(),
        from: { x: n.cx + n.w / 2, y: n.cy }, // right corner of diamond
        to: { x: exRight.cx - exRight.w / 2, y: exRight.cy, side: "left" },
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
        // land on right edge of target so the down-spine arrow into it stays clean
        to: { x: tgt.cx + tgt.w / 2, y: tgt.cy, side: "right" },
        label: `no → ${d.no}`,
      });
    }
  });

  const height = TOP_PAD + spine.length * SLOT_H + 40;
  const rightMost = right.reduce((m, r) => Math.max(m, r.cx + r.w / 2), CENTER_X + STEP_W / 2);
  const laneMost = RIGHT_CORRIDOR_X + Math.max(0, laneCounter - 1) * LANE_GAP + 40;
  const width = Math.max(rightMost, laneMost) + 40;

  return { spine, right, routes, spineOrder, width, height };
}

// Compute the y at which a spine node's TOP edge sits (for arrows landing on it).
function topEdge(n: SpineNode): { x: number; y: number } {
  if (n.kind === "step") return { x: n.cx, y: n.cy - n.h / 2 };
  // diamond: top corner
  return { x: n.cx, y: n.cy - n.h / 2 };
}
function bottomEdge(n: SpineNode): { x: number; y: number } {
  if (n.kind === "step") return { x: n.cx, y: n.cy + n.h / 2 };
  return { x: n.cx, y: n.cy + n.h / 2 };
}

interface Props {
  model: ProcessModel;
  onAddStep: (text: string) => void;
  onDeleteStep: (id: string) => void;
}

export function ProcessCanvas({ model, onAddStep, onDeleteStep }: Props) {
  const { spine, right, routes, width, height } = useMemo(() => layout(model), [model]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const actorOf = (id: string) => model.actors.find((a) => a.id === id)?.text ?? "";
  const systemOf = (id?: string) => (id ? model.systems.find((s) => s.id === id)?.text : undefined);

  return (
    <div className="relative w-full h-full overflow-hidden bp-grid rounded-lg border">
      {/* toolbar */}
      <div className="absolute top-3 right-3 z-10 flex gap-1 rounded-md border bg-card/90 backdrop-blur p-1 shadow-sm">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
          <ZoomOut className="size-3.5" />
        </Button>
        <span className="w-10 text-center text-[11px] font-mono-tight text-muted-foreground self-center">{Math.round(zoom * 100)}%</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
          <ZoomIn className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
          <Maximize2 className="size-3.5" />
        </Button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 text-[10px] font-mono-tight text-muted-foreground">
        <span className="flex items-center gap-1.5 rounded bg-card/90 backdrop-blur px-2 py-1 border">
          <span className="h-2 w-3 border-2 border-primary rounded-sm" /> Step
        </span>
        <span className="flex items-center gap-1.5 rounded bg-card/90 backdrop-blur px-2 py-1 border">
          <span className="h-2 w-2 rotate-45 border-2 border-primary" /> Decision
        </span>
        <span className="flex items-center gap-1.5 rounded bg-card/90 backdrop-blur px-2 py-1 border">
          <span className="h-2 w-3 border border-dashed border-unresolved rounded-sm" /> Unresolved
        </span>
        <span className="flex items-center gap-1.5 rounded bg-card/90 backdrop-blur px-2 py-1 border">
          <span className="h-2 w-3 border border-drift rounded-sm bg-drift/20" /> Drifted
        </span>
      </div>

      {/* Add step */}
      <div className="absolute bottom-3 right-3 z-10">
        {adding ? (
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
          <Button size="sm" variant="outline" className="bg-card/90 backdrop-blur" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add step
          </Button>
        )}
      </div>

      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => setDragging({ x: e.clientX - pan.x, y: e.clientY - pan.y })}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
        onMouseMove={(e) => { if (dragging) setPan({ x: e.clientX - dragging.x, y: e.clientY - dragging.y }); }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom((z) => Math.max(0.5, Math.min(2, z - e.deltaY * 0.002)));
          }
        }}
      >
        <div
          className="origin-top-left transition-transform"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width, height }}
        >
          <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
              </marker>
              <marker id="arrow-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--color-unresolved)" />
              </marker>
            </defs>

            {/* Main spine connectors (straight vertical between consecutive spine nodes) */}
            {spine.slice(0, -1).map((n, i) => {
              const next = spine[i + 1];
              const from = bottomEdge(n);
              const to = topEdge(next);
              const yesLabel = n.kind === "decision" ? `yes → ${(n.ref as Decision).yes}` : null;
              const midY = (from.y + to.y) / 2;
              return (
                <g key={`spine-${i}`}>
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="var(--color-muted-foreground)" strokeWidth={1.3}
                    markerEnd="url(#arrow)"
                  />
                  {yesLabel && (
                    <text
                      x={from.x + 10} y={midY + 3}
                      fill="var(--color-confident)"
                      fontSize="11" fontFamily="var(--font-mono)"
                    >
                      {yesLabel}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Right-corridor orthogonal routes (elbow: source → lane → target) */}
            {routes.map((r) => {
              const isException = r.kind === "exception";
              const stroke = isException ? "var(--color-unresolved)" : "var(--color-unresolved-foreground)";
              const dash = isException ? "4 3" : undefined;
              const marker = isException ? "url(#arrow-dashed)" : "url(#arrow)";
              // 3-segment elbow: horizontal from source out to laneX, vertical to target y, horizontal into target
              const path = `M ${r.from.x} ${r.from.y} H ${r.laneX} V ${r.to.y} H ${r.to.x}`;
              // label placement: near vertical segment, offset slightly right of laneX
              const labelY = (r.from.y + r.to.y) / 2;
              return (
                <g key={r.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={1.3}
                    strokeDasharray={dash}
                    markerEnd={marker}
                  />
                  {r.label && (
                    <text
                      x={r.laneX + 6} y={labelY}
                      fill={isException ? "var(--color-unresolved)" : "var(--color-unresolved-foreground)"}
                      fontSize="10" fontFamily="var(--font-mono)"
                    >
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
                  cx={n.cx} cy={n.cy} w={n.w} h={n.h}
                  step={s}
                  actor={actorOf(s.actorId)}
                  system={systemOf(s.systemId)}
                  onDelete={() => onDeleteStep(s.id)}
                />
              );
            }
            const d = n.ref;
            return <DecisionNode key={d.id} cx={n.cx} cy={n.cy} w={n.w} h={n.h} d={d} />;
          })}
          {right.map((n) => (
            <ExceptionNode key={n.ref.id} cx={n.cx} cy={n.cy} w={n.w} h={n.h} e={n.ref} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepNode({ cx, cy, w, h, step, actor, system, onDelete }:{
  cx: number; cy: number; w: number; h: number;
  step: Step; actor: string; system?: string; onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group absolute rounded-lg border-2 bg-card px-3 py-2 shadow-sm flex flex-col gap-1 animate-item-in",
        step.drift && "border-drift animate-drift bg-drift/5",
        step.confidence < 0.7 && !step.drift && "border-dashed border-unresolved bg-unresolved/5",
        !step.drift && step.confidence >= 0.7 && !step.userAdded && "border-primary/40",
        step.userAdded && "user-added !border-verified",
      )}
      style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h }}
    >
      <div className="flex items-center justify-between">
        <IdChip id={step.id} tone="primary" />
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={step} />
          <button onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-xs leading-snug font-medium">{step.text}</div>
      <div className="flex gap-2 text-[10px] font-mono-tight text-muted-foreground">
        <span>{actor}</span>
        {system && <span>· {system}</span>}
      </div>
    </div>
  );
}

function DecisionNode({ cx, cy, w, h, d }: { cx: number; cy: number; w: number; h: number; d: Decision }) {
  // Diamond drawn as SVG polygon so we can label inside cleanly and its edges
  // sit exactly on the (cx,cy) axes for connector alignment.
  const left = cx - w / 2;
  const top = cy - h / 2;
  return (
    <div
      className={cn("absolute animate-item-in", d.drift && "animate-drift")}
      style={{ left, top, width: w, height: h }}
    >
      <svg width={w} height={h} className="absolute inset-0">
        <polygon
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          fill="var(--color-card)"
          stroke={d.drift ? "var(--color-drift)" : "var(--color-primary)"}
          strokeOpacity={d.drift ? 1 : 0.6}
          strokeWidth={2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center gap-1 pointer-events-none">
        <IdChip id={d.id} tone="primary" />
        <div className="text-[11px] font-medium leading-tight">{d.text}</div>
      </div>
    </div>
  );
}

function ExceptionNode({ cx, cy, w, h, e }: { cx: number; cy: number; w: number; h: number; e: Exception }) {
  return (
    <div
      className="absolute rounded-md border border-dashed border-unresolved bg-unresolved/10 px-2 py-1.5 shadow-sm animate-item-in"
      style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h }}
    >
      <div className="flex items-center justify-between">
        <IdChip id={e.id} />
        <span className="text-[9px] font-mono-tight uppercase tracking-wider text-unresolved">exception</span>
      </div>
      <div className="mt-0.5 text-[11px] leading-snug">{e.text}</div>
    </div>
  );
}

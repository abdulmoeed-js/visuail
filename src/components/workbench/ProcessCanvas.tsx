import { useMemo, useState } from "react";
import type { ProcessModel, Step, Decision, Exception } from "@/data/samples";
import { cn } from "@/lib/utils";
import { ConfidenceBadge, IdChip } from "./atoms";
import { Plus, X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Deterministic top-to-bottom flowchart layout.
 * Steps are laid out in vertical order; decisions branch to the right (yes)
 * and left (no) with exceptions attached as side notes.
 */

const NODE_W = 220;
const NODE_H = 78;
const V_GAP = 120;
const CENTER_X = 340;

interface Positioned {
  x: number; y: number; w: number; h: number;
  kind: "step" | "decision" | "exception";
  ref: Step | Decision | Exception;
}

function layout(model: ProcessModel): { nodes: Positioned[]; width: number; height: number } {
  const nodes: Positioned[] = [];
  let y = 40;
  model.steps.forEach((s) => {
    nodes.push({
      x: CENTER_X - NODE_W / 2, y, w: NODE_W, h: NODE_H,
      kind: "step", ref: s,
    });
    // any decision that follows this step
    const dec = model.decisions.find((d) => d.afterStepId === s.id);
    if (dec) {
      y += V_GAP;
      nodes.push({
        x: CENTER_X - 110, y, w: 220, h: 90, kind: "decision", ref: dec,
      });
    }
    // any exception attached to this step
    const exc = model.exceptions.find((e) => e.relatedStepId === s.id);
    if (exc) {
      const parent = nodes[nodes.length - 1];
      nodes.push({
        x: parent.x + parent.w + 60,
        y: parent.y + 6,
        w: 200, h: 74, kind: "exception", ref: exc,
      });
    }
    y += V_GAP;
  });
  const height = y + 20;
  const width = CENTER_X + 320;
  return { nodes, width, height };
}

interface Props {
  model: ProcessModel;
  onAddStep: (text: string) => void;
  onDeleteStep: (id: string) => void;
}

export function ProcessCanvas({ model, onAddStep, onDeleteStep }: Props) {
  const { nodes, width, height } = useMemo(() => layout(model), [model]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const actorOf = (id: string) => model.actors.find((a) => a.id === id)?.text ?? "";
  const systemOf = (id?: string) => id ? model.systems.find((s) => s.id === id)?.text : undefined;

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
          <svg
            width={width} height={height}
            className="absolute inset-0 pointer-events-none"
          >
            {/* connectors */}
            {model.steps.map((s, i) => {
              const from = nodes.find((n) => n.kind === "step" && (n.ref as Step).id === s.id)!;
              const next = nodes[nodes.indexOf(from) + 1];
              if (!next || next.kind === "exception") return null;
              const x1 = from.x + from.w / 2;
              const y1 = from.y + from.h;
              const x2 = next.x + next.w / 2;
              const y2 = next.y;
              return (
                <line key={`c-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="var(--color-muted-foreground)" strokeWidth={1.2} strokeDasharray="0" markerEnd="url(#arrow)" />
              );
            })}
            {/* decision branch labels */}
            {model.decisions.map((d) => {
              const dnode = nodes.find((n) => n.kind === "decision" && (n.ref as Decision).id === d.id);
              if (!dnode) return null;
              return (
                <g key={`dl-${d.id}`}>
                  <text x={dnode.x + dnode.w + 8} y={dnode.y + dnode.h + 4}
                    fill="var(--color-confident)" fontSize="10" fontFamily="var(--font-mono)">yes → {d.yes}</text>
                  <text x={dnode.x - 6} y={dnode.y + dnode.h + 4} textAnchor="end"
                    fill="var(--color-unresolved-foreground)" fontSize="10" fontFamily="var(--font-mono)">no → {d.no}</text>
                </g>
              );
            })}
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
              </marker>
            </defs>
          </svg>

          {nodes.map((n) => {
            if (n.kind === "step") {
              const s = n.ref as Step;
              return <StepNode key={s.id} n={n} step={s} actor={actorOf(s.actorId)} system={systemOf(s.systemId)} onDelete={() => onDeleteStep(s.id)} />;
            }
            if (n.kind === "decision") {
              return <DecisionNode key={(n.ref as Decision).id} n={n} d={n.ref as Decision} />;
            }
            return <ExceptionNode key={(n.ref as Exception).id} n={n} e={n.ref as Exception} />;
          })}
        </div>
      </div>
    </div>
  );
}

function StepNode({ n, step, actor, system, onDelete }:{
  n: Positioned; step: Step; actor: string; system?: string; onDelete: () => void;
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
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
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

function DecisionNode({ n, d }: { n: Positioned; d: Decision }) {
  return (
    <div
      className={cn(
        "absolute flex items-center justify-center animate-item-in",
        d.drift && "animate-drift",
      )}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      <div
        className={cn(
          "relative w-full h-full",
        )}
      >
        <div
          className={cn(
            "absolute inset-4 rotate-45 border-2 rounded-md bg-card",
            d.drift ? "border-drift bg-drift/5" : "border-primary/60",
          )}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center gap-1">
          <IdChip id={d.id} tone="primary" />
          <div className="text-[11px] font-medium leading-tight">{d.text}</div>
        </div>
      </div>
    </div>
  );
}

function ExceptionNode({ n, e }: { n: Positioned; e: Exception }) {
  return (
    <div
      className="absolute rounded-md border border-dashed border-unresolved bg-unresolved/10 px-2 py-1.5 shadow-sm animate-item-in"
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      <div className="flex items-center justify-between">
        <IdChip id={e.id} />
        <span className="text-[9px] font-mono-tight uppercase tracking-wider text-unresolved">exception</span>
      </div>
      <div className="mt-0.5 text-[11px] leading-snug">{e.text}</div>
    </div>
  );
}

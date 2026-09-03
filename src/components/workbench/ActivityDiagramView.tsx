import { useMemo, useState } from "react";
import type { ProcessModel, Step, Decision } from "@/data/samples";
import { decisionBranches } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Plus, X, GripVertical } from "lucide-react";
import { CanvasShell } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { IdChip, ConfidenceBadge } from "./atoms";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Activity Diagram with real swimlanes, from the corpus's Activity Diagram
// material -- the explicit gap it called out was "formalize fork/join and
// swimlane-by-actor rendering," since ProcessCanvas's "swimlane" shape is a
// decorative container, not a layout system. This view partitions the
// canvas into one vertical lane per actor and positions every step/decision
// by (lane = its actor, row = its position in the overall sequence) --
// lane constrains X, sequence order constrains Y, so the top-to-bottom flow
// stays readable while showing who does what. Reuses ProcessCanvas's data
// and edit actions entirely (steps/decisions/branches/actors already
// exist); the only new thing here is this layout and lane chrome. Fork/join
// reuses the existing gateway-parallel decision shape, rendered as a
// synchronization bar instead of a diamond in this view specifically.

const LANE_W = 240;
const LANE_HEADER_H = 44;
const LEFT_PAD = 20;
const TOP_PAD = LANE_HEADER_H + 40;
const ROW_H = 130;
const NODE_W = 200, NODE_H = 76;
const DEC_W = 180, DEC_H = 84;
const BAR_W = 160, BAR_H = 14;

interface SeqItem { kind: "step" | "decision"; ref: Step | Decision; row: number; laneActorId: string; }

function buildSequence(model: ProcessModel): SeqItem[] {
  const seq: SeqItem[] = [];
  const seenDecisions = new Set<string>();
  let row = 0;
  model.steps.forEach((s) => {
    seq.push({ kind: "step", ref: s, row: row++, laneActorId: s.actorId });
    const dec = model.decisions.find((d) => d.afterStepId === s.id && !seenDecisions.has(d.id));
    if (dec) { seenDecisions.add(dec.id); seq.push({ kind: "decision", ref: dec, row: row++, laneActorId: s.actorId }); }
  });
  model.decisions.forEach((d) => {
    if (seenDecisions.has(d.id)) return;
    seenDecisions.add(d.id);
    seq.push({ kind: "decision", ref: d, row: row++, laneActorId: model.actors[0]?.id ?? "" });
  });
  return seq;
}

interface Placed extends SeqItem { cx: number; cy: number; w: number; h: number; }

function layout(model: ProcessModel) {
  const seq = buildSequence(model);
  const lanes = model.actors;
  const laneX = (actorId: string) => {
    const idx = Math.max(0, lanes.findIndex((a) => a.id === actorId));
    return LEFT_PAD + idx * LANE_W;
  };
  const placed: Placed[] = seq.map((it) => {
    const isBar = it.kind === "decision" && (it.ref as Decision).shape === "gateway-parallel";
    const w = it.kind === "decision" ? (isBar ? BAR_W : DEC_W) : NODE_W;
    const h = it.kind === "decision" ? (isBar ? BAR_H : DEC_H) : NODE_H;
    return { ...it, cx: laneX(it.laneActorId) + LANE_W / 2, cy: TOP_PAD + it.row * ROW_H + ROW_H / 2, w, h };
  });
  const width = Math.max(900, LEFT_PAD + Math.max(1, lanes.length) * LANE_W + 40);
  const height = Math.max(560, TOP_PAD + seq.length * ROW_H + 60);
  return { placed, lanes, laneX, width, height };
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

// Bottom-center to top-center, whether the two nodes share a lane (a
// straight vertical line) or not (the caller bends the path horizontally at
// a midpoint Y between these two points -- same technique DFD's cross-node
// routing already uses).
function edge(a: Placed, b: Placed) {
  return { from: { x: a.cx, y: a.cy + a.h / 2 }, to: { x: b.cx, y: b.cy - b.h / 2 } };
}

interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

export function ActivityDiagramView({ model, editing }: Props) {
  const { placed, lanes, width, height } = useMemo(() => layout(model), [model]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.ref.id, p])), [placed]);

  const [addingLane, setAddingLane] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const commitAdd = (actorId: string) => {
    const t = draft.trim();
    if (t) {
      const newId = editing.onAddStep(t);
      if (typeof newId === "string") editing.onUpdateItem(newId, { actorId });
    }
    setDraft(""); setAddingLane(null);
  };

  const [addingActor, setAddingActor] = useState(false);
  const [actorDraft, setActorDraft] = useState("");
  const commitActor = () => {
    const t = actorDraft.trim();
    if (t) editing.onAddActor(t);
    setActorDraft(""); setAddingActor(false);
  };

  return (
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="Activity diagram — fullscreen"
      bottomLeft={
        <span className="flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground">
          One lane per actor · sequence flows top-to-bottom, lane shows who
        </span>
      }
      bottomRight={
        addingActor ? (
          <div className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm">
            <input autoFocus value={actorDraft} onChange={(e) => setActorDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitActor(); if (e.key === "Escape") { setAddingActor(false); setActorDraft(""); } }}
              placeholder="New lane (actor)" className="h-8 w-40 text-sm px-2 rounded border bg-background" />
            <button onClick={commitActor} className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><Plus className="size-4" /></button>
            <button onClick={() => { setAddingActor(false); setActorDraft(""); }} className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><X className="size-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAddingActor(true)} data-no-pan className="h-8 px-2.5 rounded-md border bg-card/95 backdrop-blur shadow-sm text-xs flex items-center gap-1.5 hover:border-primary/60">
            <Plus className="size-3.5 text-primary" /> Add lane
          </button>
        )
      }
    >
      {lanes.map((a, i) => (
        <div key={a.id} className="absolute top-0 bottom-0 border-r border-dashed border-border/70" style={{ left: LEFT_PAD + i * LANE_W, width: LANE_W }}>
          <div className="sticky top-0 flex items-center justify-between gap-1 border-b bg-muted/40 px-2" style={{ height: LANE_HEADER_H }} data-no-pan>
            <span className="text-xs font-semibold truncate">{a.text}</span>
            {addingLane === a.id ? (
              <div className="flex items-center gap-0.5 shrink-0">
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitAdd(a.id); if (e.key === "Escape") { setAddingLane(null); setDraft(""); } }}
                  placeholder="New step" className="h-6 w-24 text-[11px] px-1.5 rounded border bg-background" />
                <button onClick={() => commitAdd(a.id)} className="text-primary"><Plus className="size-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setAddingLane(a.id)} className="text-muted-foreground hover:text-primary transition shrink-0"><Plus className="size-3.5" /></button>
            )}
          </div>
        </div>
      ))}

      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none" }}>
        <defs>
          <marker id="ad-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
        </defs>
        {placed.map((p, i) => {
          if (p.kind === "decision") return null;
          const next = placed[i + 1];
          if (!next) return null;
          // A step's implicit "next" edge only applies going into another
          // step directly beneath it in sequence -- if a decision follows,
          // its branches (below) own the routing instead.
          const { from, to } = edge(p, next);
          const midY = (from.y + to.y) / 2;
          const path = Math.abs(from.x - to.x) < 4
            ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
            : roundedPath([from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]);
          return <path key={`seq-${p.ref.id}`} d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#ad-arrow)" />;
        })}
        {placed.filter((p) => p.kind === "decision").map((p) => {
          const d = p.ref as Decision;
          return decisionBranches(d).map((b) => {
            const target = byId.get(b.targetId);
            if (!target) return null;
            const { from, to } = edge(p, target);
            const midY = (from.y + to.y) / 2;
            const path = Math.abs(from.x - to.x) < 4
              ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
              : roundedPath([from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]);
            return (
              <g key={`${d.id}-${b.id}`}>
                <path d={path} fill="none" stroke="var(--color-drift)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#ad-arrow)" />
                <text x={from.x + 8} y={from.y + 14} fill="var(--color-drift)" fontSize="10" fontFamily="var(--font-mono)">{b.label}</text>
              </g>
            );
          });
        })}
      </svg>

      {placed.map((p) =>
        p.kind === "step" ? (
          <ActivityStepNode key={p.ref.id} node={p} step={p.ref as Step} onDelete={() => editing.onDeleteAny(p.ref.id)}
            onUpdate={(text) => editing.onUpdateItem(p.ref.id, { text })} />
        ) : (
          <ActivityDecisionNode key={p.ref.id} node={p} d={p.ref as Decision} onDelete={() => editing.onDeleteAny(p.ref.id)}
            onUpdate={(text) => editing.onUpdateItem(p.ref.id, { text })}
            onAddBranch={() => {
              const branches = decisionBranches(p.ref as Decision);
              const id = `${p.ref.id}-b${branches.length}-${Math.random().toString(36).slice(2, 6)}`;
              editing.onUpdateItem(p.ref.id, { branches: [...branches, { id, label: `Option ${branches.length + 1}`, targetId: "—" }] });
            }}
            onUpdateBranch={(bid, patch) => {
              const branches = decisionBranches(p.ref as Decision);
              editing.onUpdateItem(p.ref.id, { branches: branches.map((b) => (b.id === bid ? { ...b, ...patch } : b)) });
            }}
            onRemoveBranch={(bid) => {
              const branches = decisionBranches(p.ref as Decision);
              editing.onUpdateItem(p.ref.id, { branches: branches.filter((b) => b.id !== bid) });
            }} />
        ),
      )}
    </CanvasShell>
  );
}

function ActivityStepNode({
  node, step, onDelete, onUpdate,
}: {
  node: Placed; step: Step;
  onDelete: () => void;
  onUpdate: (t: string) => void;
}) {
  return (
    <div
      data-node
      className="group absolute rounded-xl border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h, zIndex: 10 }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <GripVertical className="size-3.5 text-muted-foreground/70 shrink-0" />
          <IdChip id={step.id} tone="primary" />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ConfidenceBadge item={step} />
          <button onClick={onDelete} data-no-pan className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-xs font-medium leading-snug break-words">
        <InlineEdit value={step.text} onChange={onUpdate} multiline />
      </div>
    </div>
  );
}

function ActivityDecisionNode({
  node, d, onDelete, onUpdate, onAddBranch, onUpdateBranch, onRemoveBranch,
}: {
  node: Placed; d: Decision;
  onDelete: () => void;
  onUpdate: (t: string) => void;
  onAddBranch: () => void;
  onUpdateBranch: (branchId: string, patch: { label?: string; targetId?: string }) => void;
  onRemoveBranch: (branchId: string) => void;
}) {
  const isBar = d.shape === "gateway-parallel";
  const branches = decisionBranches(d);

  if (isBar) {
    return (
      <div
        data-node
        className="group absolute rounded-sm bg-foreground shadow-sm flex items-center justify-center"
        style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h, zIndex: 10 }}
        title="Fork / join"
      >
        <button onClick={onDelete} data-no-pan className="absolute -top-4 right-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
          <X className="size-3" />
        </button>
        <IdChip id={d.id} />
      </div>
    );
  }

  return (
    <div
      data-node
      className="group absolute rounded-xl border-2 border-drift/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h, zIndex: 10 }}
    >
      <div className="flex items-center justify-between gap-1">
        <IdChip id={d.id} />
        <button onClick={onDelete} data-no-pan className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
          <X className="size-3" />
        </button>
      </div>
      <div className="text-[11px] font-medium leading-snug break-words">
        <InlineEdit value={d.text} onChange={onUpdate} multiline />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button data-no-pan className="text-[9px] font-mono-tight text-muted-foreground hover:text-primary underline decoration-dotted underline-offset-2 transition self-start mt-auto">
            {branches.length} branch{branches.length === 1 ? "" : "es"} ▾
          </button>
        </PopoverTrigger>
        <PopoverContent data-no-pan className="w-64 p-2" align="start">
          <div className="flex flex-col gap-1 text-[11px] font-mono-tight max-h-56 overflow-y-auto">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center gap-1">
                <InlineEdit value={b.label} onChange={(v) => onUpdateBranch(b.id, { label: v })} className="text-primary" />
                <span className="text-muted-foreground">→</span>
                <InlineEdit value={b.targetId} onChange={(v) => onUpdateBranch(b.id, { targetId: v })} />
                {branches.length > 2 && (
                  <button onClick={() => onRemoveBranch(b.id)} className="ml-auto text-muted-foreground hover:text-destructive transition">
                    <X className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={onAddBranch} className="mt-1.5 flex items-center gap-1 text-muted-foreground hover:text-primary transition">
            <Plus className="size-3" /> Add branch
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

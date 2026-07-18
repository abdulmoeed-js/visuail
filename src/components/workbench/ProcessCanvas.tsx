import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProcessModel, Step, Decision, Exception, Connection, CrowMarker } from "@/data/samples";
import { cn } from "@/lib/utils";
import { ConfidenceBadge, IdChip } from "./atoms";
import {
  Plus, X, GripVertical, Square, Diamond, AlertTriangle, Wand2,
  PanelRightOpen, PanelRightClose, Circle, FileText, ChevronsRight,
  Layers, ArrowUpToLine, ArrowDownToLine, Zap, Rows3,
  Table2, Boxes, GitBranch,

} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CanvasShell, useCanvas } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { RefineControl } from "./RefineControl";
import { applyProposal, type Proposal } from "@/lib/refine";


/**
 * Deterministic top-to-bottom flowchart with a single vertical spine.
 * Nodes auto-size to their content via a ResizeObserver that reports each
 * node's natural size — the layout consumes those measurements so the spine
 * and connectors reflow after content changes.
 *
 * Additions:
 *  - Shape variants (Flowchart + BPMN) render distinct outlines while sharing
 *    the same drag/resize/connect/inline-edit surface as extracted nodes.
 *  - Snap-to-grid (GRID) on drop and drag for intentional placement.
 *  - Z-order: each node has an optional `z` in overrides; clicking auto-brings
 *    to front; explicit up/down buttons in the header.
 */

const CENTER_X = 320;
const STEP_W = 260;
const STEP_H = 84;
const DEC_W = 260;
const DEC_H = 130;
const EX_W = 240;
const EX_H = 84;
const V_GAP = 56;
const TOP_PAD = 40;
const RIGHT_CORRIDOR_X = CENTER_X + STEP_W / 2 + 90;
const LANE_GAP = 28;
const GRID = 20;

const MIN_W = 160, MIN_H = 70, MAX_W = 640, MAX_H = 600;

const snap = (v: number) => Math.round(v / GRID) * GRID;

export type NodeOverride = { cx?: number; cy?: number; w?: number; h?: number; z?: number };
export type Overrides = Record<string, NodeOverride>;
export type Measured = Record<string, { w: number; h: number }>;

type StepShape = NonNullable<Step["shape"]>;
type DecisionShape = NonNullable<Decision["shape"]>;

type SpineNode =
  | { kind: "step"; ref: Step; cx: number; cy: number; w: number; h: number; z: number }
  | { kind: "decision"; ref: Decision; cx: number; cy: number; w: number; h: number; z: number };
type RightNode = { kind: "exception"; ref: Exception; cx: number; cy: number; w: number; h: number; z: number };

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

function defaultSizeFor(kind: "step" | "decision" | "exception", shape?: string) {
  if (kind === "decision") return { w: DEC_W, h: DEC_H };
  if (kind === "exception") return { w: EX_W, h: EX_H };
  // step variants: sensible defaults
  switch (shape) {
    case "event": return { w: 180, h: 180 };
    case "terminator": return { w: 240, h: 72 };
    case "swimlane": return { w: 520, h: 320 };
    case "subroutine": return { w: 280, h: 84 };
    case "document": return { w: 260, h: 96 };
    case "io": return { w: 260, h: 84 };
    case "offpage": return { w: 240, h: 88 };
    case "task": return { w: 260, h: 84 };
    case "uml-class":
    case "uml-interface": return { w: 240, h: 200 };
    case "er-entity": return { w: 240, h: 180 };
    case "uml-lifeline": return { w: 140, h: 360 };
    default: return { w: STEP_W, h: STEP_H };
  }
}


function effSize(id: string, defW: number, defH: number, overrides: Overrides, measured: Measured) {
  const o = overrides[id];
  const m = measured[id];
  return { w: o?.w ?? m?.w ?? defW, h: o?.h ?? m?.h ?? defH };
}

function zOf(id: string, overrides: Overrides) {
  return overrides[id]?.z ?? 0;
}

function layout(model: ProcessModel, overrides: Overrides, measured: Measured): Layout {
  const spine: SpineNode[] = [];
  const spineIndexById = new Map<string, number>();
  let cursor = TOP_PAD;

  const pushSpine = (
    kind: "step" | "decision",
    ref: Step | Decision,
    defW: number,
    defH: number,
  ) => {
    const id = ref.id;
    const { w, h } = effSize(id, defW, defH, overrides, measured);
    const naturalCy = cursor + h / 2;
    const cx = overrides[id]?.cx ?? CENTER_X;
    const cy = overrides[id]?.cy ?? naturalCy;
    spine.push({ kind, ref: ref as never, cx, cy, w, h, z: zOf(id, overrides) });
    spineIndexById.set(id, spine.length - 1);
    cursor = naturalCy + h / 2 + V_GAP;
  };

  const seenDecisions = new Set<string>();
  model.steps.forEach((s) => {
    const def = defaultSizeFor("step", s.shape);
    pushSpine("step", s, def.w, def.h);
    const dec = model.decisions.find((d) => d.afterStepId === s.id && !seenDecisions.has(d.id));
    if (dec) { seenDecisions.add(dec.id); pushSpine("decision", dec, DEC_W, DEC_H); }
  });
  // Render any orphan decisions (e.g. user-added via palette before any step).
  model.decisions.forEach((d) => {
    if (seenDecisions.has(d.id)) return;
    seenDecisions.add(d.id);
    pushSpine("decision", d, DEC_W, DEC_H);
  });

  const right: RightNode[] = [];
  const occupiedYs: number[] = [];
  model.exceptions.forEach((e) => {
    const { w, h } = effSize(e.id, EX_W, EX_H, overrides, measured);
    const anchor = e.relatedStepId ? spine[spineIndexById.get(e.relatedStepId) ?? 0] : spine[0];
    let cy = overrides[e.id]?.cy ?? anchor?.cy ?? TOP_PAD + h / 2;
    if (overrides[e.id]?.cy === undefined) {
      while (occupiedYs.some((y) => Math.abs(y - cy) < h + 20)) cy += h + 20;
    }
    occupiedYs.push(cy);
    const cx = overrides[e.id]?.cx ?? RIGHT_CORRIDOR_X + 140 + w / 2;
    right.push({ kind: "exception", ref: e, cx, cy, w, h, z: zOf(e.id, overrides) });
  });

  const routes: Route[] = [];
  let laneCounter = 0;
  const nextLaneX = () => RIGHT_CORRIDOR_X + laneCounter++ * LANE_GAP;

  right.forEach((ex) => {
    const rel = ex.ref.relatedStepId;
    const relIdx = rel ? spineIndexById.get(rel) : undefined;
    const src = relIdx !== undefined ? spine[relIdx] : spine[0];
    if (!src) return;
    routes.push({
      id: `route-ex-${ex.ref.id}`, kind: "exception", laneX: nextLaneX(),
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
        id: `route-no-${d.id}`, kind: "no-branch", laneX: nextLaneX(),
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
        id: `route-no-${d.id}`, kind: "no-branch", laneX: nextLaneX(),
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
  const rightMost = right.reduce((m, r) => Math.max(m, r.cx + r.w / 2), CENTER_X + STEP_W / 2);
  const spineRightMost = spine.reduce((m, n) => Math.max(m, n.cx + n.w / 2), CENTER_X + STEP_W / 2);
  const laneMost = RIGHT_CORRIDOR_X + Math.max(0, laneCounter - 1) * LANE_GAP + 40;
  const width = Math.max(rightMost, spineRightMost, laneMost, CENTER_X + STEP_W) + 60;
  const height = Math.max(...bottoms) + 60;

  return { spine, right, routes, width, height };
}

interface Props {
  model: ProcessModel;
  onAddStep: (text: string, shape?: Step["shape"]) => string | void;
  onAddDecision?: (text: string, shape?: Decision["shape"]) => string | void;
  onAddException?: (text: string) => string | void;
  onAddConnection?: (fromId: string, toId: string) => string | void;
  onDeleteConnection?: (id: string) => void;
  onUpdateConnection?: (id: string, patch: Partial<Connection>) => void;
  onDeleteAny: (id: string) => void;
  onUpdateItem: (id: string, patch: Record<string, unknown>) => void;
  onApplyRefinement?: (p: Proposal) => void;
}

interface PaletteItem {
  kind: "step" | "decision" | "exception";
  shape?: StepShape | DecisionShape;
  label: string;
  hint: string;
  Icon: typeof Square;
}

const PALETTE_MIME = "application/x-visuail-shape";

const FLOWCHART_ITEMS: PaletteItem[] = [
  { kind: "step", shape: "step", label: "Step", hint: "Rectangle", Icon: Square },
  { kind: "step", shape: "terminator", label: "Terminator", hint: "Start / End", Icon: Circle },
  { kind: "step", shape: "document", label: "Document", hint: "Wavy bottom", Icon: FileText },
  { kind: "step", shape: "io", label: "Input / Output", hint: "Parallelogram", Icon: ChevronsRight },
  { kind: "step", shape: "subroutine", label: "Subroutine", hint: "Double bars", Icon: Layers },
  { kind: "step", shape: "offpage", label: "Off-page ref", hint: "Pentagon", Icon: ChevronsRight },
  { kind: "decision", shape: "decision", label: "Decision", hint: "Diamond", Icon: Diamond },
  { kind: "exception", label: "Exception", hint: "Dashed", Icon: AlertTriangle },
];

const BPMN_ITEMS: PaletteItem[] = [
  { kind: "step", shape: "task", label: "Task", hint: "Rounded rect", Icon: Square },
  { kind: "decision", shape: "gateway-exclusive", label: "Gateway (XOR)", hint: "Exclusive", Icon: Diamond },
  { kind: "decision", shape: "gateway-parallel", label: "Gateway (AND)", hint: "Parallel", Icon: Diamond },
  { kind: "step", shape: "event", label: "Event", hint: "Circle", Icon: Circle },
  { kind: "step", shape: "swimlane", label: "Swimlane", hint: "Container", Icon: Rows3 },
];

const UML_ITEMS: PaletteItem[] = [
  { kind: "step", shape: "uml-class", label: "Class", hint: "Name / attrs / methods", Icon: Boxes },
  { kind: "step", shape: "uml-interface", label: "Interface", hint: "«interface»", Icon: Boxes },
  { kind: "step", shape: "uml-lifeline", label: "Lifeline", hint: "Sequence · stub", Icon: GitBranch },
];

const DB_ITEMS: PaletteItem[] = [
  { kind: "step", shape: "er-entity", label: "Entity", hint: "Table · attrs", Icon: Table2 },
];

type PaletteTab = "flow" | "bpmn" | "uml" | "db";
const PALETTE_TABS: { id: PaletteTab; label: string; items: PaletteItem[] }[] = [
  { id: "flow", label: "Flowchart", items: FLOWCHART_ITEMS },
  { id: "bpmn", label: "BPMN", items: BPMN_ITEMS },
  { id: "uml", label: "UML", items: UML_ITEMS },
  { id: "db", label: "Database", items: DB_ITEMS },
];

export function ProcessCanvas({
  model, onAddStep, onAddDecision, onAddException,
  onAddConnection, onDeleteConnection, onUpdateConnection,
  onDeleteAny, onUpdateItem, onApplyRefinement,
}: Props) {

  const [overrides, setOverrides] = useState<Overrides>({});
  const [measured, setMeasured] = useState<Measured>({});
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [zCounter, setZCounter] = useState(1);
  const [pendingConn, setPendingConn] = useState<null | {
    fromId: string; fromX: number; fromY: number; toX: number; toY: number;
  }>(null);

  const reportMeasure = useCallback((id: string, w: number, h: number) => {
    setMeasured((cur) => {
      const prev = cur[id];
      if (prev && Math.abs(prev.h - h) < 1 && Math.abs(prev.w - w) < 1) return cur;
      return { ...cur, [id]: { w, h } };
    });
  }, []);

  const { spine, right, routes, width, height } = useMemo(
    () => layout(model, overrides, measured),
    [model, overrides, measured],
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const patchOverride = (id: string, o: NodeOverride) =>
    setOverrides((cur) => ({ ...cur, [id]: { ...cur[id], ...o } }));

  const bringToFront = useCallback((id: string) => {
    setZCounter((z) => {
      const next = z + 1;
      setOverrides((cur) => ({ ...cur, [id]: { ...cur[id], z: next } }));
      return next;
    });
  }, []);
  const sendToBack = useCallback((id: string) => {
    setOverrides((cur) => {
      const minZ = Math.min(0, ...Object.values(cur).map((o) => o?.z ?? 0)) - 1;
      return { ...cur, [id]: { ...cur[id], z: minZ } };
    });
  }, []);

  const handleRefine = (p: Proposal) => {
    if (onApplyRefinement) onApplyRefinement(p);
    else {
      // eslint-disable-next-line no-console
      console.warn("ProcessCanvas: onApplyRefinement not provided; refinement dropped");
      applyProposal(p, model);
    }
  };

  const geomById = useMemo(() => {
    const m = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    spine.forEach((n) => m.set(n.ref.id, { cx: n.cx, cy: n.cy, w: n.w, h: n.h }));
    right.forEach((n) => m.set(n.ref.id, { cx: n.cx, cy: n.cy, w: n.w, h: n.h }));
    return m;
  }, [spine, right]);

  const manualConnections = model.connections ?? [];

  const handleDrop = (cx: number, cy: number, e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    if (!raw) return;
    let payload: { kind: string; shape?: string };
    try { payload = JSON.parse(raw); } catch { return; }
    const sx = snap(cx), sy = snap(cy);
    let newId: string | void = undefined;
    if (payload.kind === "step") {
      const label = defaultLabelFor(payload.shape);
      newId = onAddStep(label, payload.shape as Step["shape"]);
    } else if (payload.kind === "decision") {
      const label = payload.shape?.startsWith("gateway") ? "Gateway" : "New decision";
      newId = onAddDecision?.(label, payload.shape as Decision["shape"]);
    } else if (payload.kind === "exception") {
      newId = onAddException?.("New exception");
    }
    if (typeof newId === "string") {
      patchOverride(newId, { cx: sx, cy: sy });
      bringToFront(newId);
      // Seed sectioned content for class/interface/entity boxes.
      if (payload.kind === "step") {
        if (payload.shape === "uml-class") {
          onUpdateItem(newId, {
            sections: { attributes: ["- id: string"], methods: ["+ save()"] },
          });
        } else if (payload.shape === "uml-interface") {
          onUpdateItem(newId, {
            sections: { stereotype: "«interface»", methods: ["+ execute()"] },
          });
        } else if (payload.shape === "er-entity") {
          onUpdateItem(newId, {
            sections: { attributes: ["id · PK", "name · varchar"] },
          });
        }
      }
    }

  };

  const insertStarter = () => {
    const centerX = snap(320);
    const y0 = snap(100);
    const gap = 160;
    const a = onAddStep("Request", "terminator");
    const b = onAddStep("Review", "step");
    const c = onAddDecision?.("Approve?", "decision");
    if (typeof a === "string") patchOverride(a, { cx: centerX, cy: y0 });
    if (typeof b === "string") patchOverride(b, { cx: centerX, cy: y0 + gap });
    if (typeof c === "string") patchOverride(c, { cx: centerX, cy: y0 + gap * 2 });
    if (typeof a === "string" && typeof b === "string") onAddConnection?.(a, b);
    if (typeof b === "string" && typeof c === "string") onAddConnection?.(b, c);
  };

  const isEmpty = model.steps.length === 0 && model.decisions.length === 0 && model.exceptions.length === 0;

  const routeBetween = (fromId: string, toId: string) => {
    const a = geomById.get(fromId);
    const b = geomById.get(toId);
    if (!a || !b) return null;
    const dy = b.cy - a.cy;
    const dx = b.cx - a.cx;
    if (Math.abs(dx) < 10 && Math.abs(dy) > 20) {
      const from = { x: a.cx, y: a.cy + Math.sign(dy) * (a.h / 2) };
      const to = { x: b.cx, y: b.cy - Math.sign(dy) * (b.h / 2) };
      return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    const fromRight = { x: a.cx + a.w / 2, y: a.cy };
    const toLeft = { x: b.cx - b.w / 2, y: b.cy };
    const laneX = Math.max(fromRight.x, toLeft.x) + 40;
    return `M ${fromRight.x} ${fromRight.y} H ${laneX} V ${toLeft.y} H ${toLeft.x}`;
  };

  const startConnDrag = (fromId: string, e: React.PointerEvent) => {
    const g = geomById.get(fromId);
    if (!g) return;
    const startX = g.cx + g.w / 2;
    const startY = g.cy;
    setPendingConn({ fromId, fromX: startX, fromY: startY, toX: startX, toY: startY });
    const contentEl = (e.currentTarget as HTMLElement).closest("[data-canvas-content]") as HTMLElement | null;
    const move = (ev: PointerEvent) => {
      if (!contentEl) return;
      const rect = contentEl.getBoundingClientRect();
      const scaleX = contentEl.offsetWidth ? rect.width / contentEl.offsetWidth : 1;
      const cx = (ev.clientX - rect.left) / scaleX;
      const cy = (ev.clientY - rect.top) / scaleX;
      setPendingConn((cur) => cur ? { ...cur, toX: cx, toY: cy } : cur);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const node = el?.closest("[data-node-id]") as HTMLElement | null;
      const toId = node?.dataset.nodeId;
      if (toId && toId !== fromId) onAddConnection?.(fromId, toId);
      setPendingConn(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Assemble a single render list sorted by z so overlap ordering is deterministic.
  type RenderItem =
    | { kind: "step"; node: SpineNode }
    | { kind: "decision"; node: SpineNode }
    | { kind: "exception"; node: RightNode };
  const items: RenderItem[] = useMemo(() => {
    const list: RenderItem[] = [];
    spine.forEach((n) => list.push({ kind: n.kind, node: n }));
    right.forEach((n) => list.push({ kind: "exception", node: n }));
    list.sort((a, b) => a.node.z - b.node.z);
    return list;
  }, [spine, right]);

  return (
    <CanvasShell
      contentWidth={Math.max(width, 900)}
      contentHeight={Math.max(height, 620)}
      minimap
      fullscreenLabel="Process map — fullscreen"
      bottomLeft={<Legend />}
      onCanvasDrop={handleDrop}
      overlay={
        <ShapePalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((o) => !o)}
          showStarter={isEmpty}
          onInsertStarter={insertStarter}
        />
      }
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
      <svg
        width={Math.max(width, 900)}
        height={Math.max(height, 620)}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
          <marker id="arrow-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-unresolved)" />
          </marker>
          <marker id="arrow-verified" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-verified)" />
          </marker>
        </defs>

        {spine.slice(0, -1).map((n, i) => {
          const next = spine[i + 1];
          if (overrides[n.ref.id]?.cx !== undefined || overrides[next.ref.id]?.cx !== undefined) return null;
          if (n.ref.userAdded || next.ref.userAdded) return null;
          const from = { x: n.cx, y: n.cy + n.h / 2 };
          const to = { x: next.cx, y: next.cy - next.h / 2 };
          const yesLabel = n.kind === "decision" ? `yes → ${(n.ref as Decision).yes}` : null;
          const midY = (from.y + to.y) / 2;
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

        {manualConnections.map((c) => {
          const d = routeBetween(c.fromId, c.toId);
          if (!d) return null;
          return (
            <path key={c.id} d={d} fill="none" stroke="var(--color-verified)" strokeWidth={1.6} markerEnd="url(#arrow-verified)" />
          );
        })}

        {pendingConn && (
          <path
            d={`M ${pendingConn.fromX} ${pendingConn.fromY} L ${pendingConn.toX} ${pendingConn.toY}`}
            fill="none" stroke="var(--color-verified)" strokeWidth={1.6}
            strokeDasharray="4 3" opacity={0.8}
          />
        )}
      </svg>

      {items.map((it) => {
        if (it.kind === "step") {
          const n = it.node;
          const s = n.ref as Step;
          const hasHeightOverride = overrides[s.id]?.h !== undefined;
          return (
            <StepNode
              key={s.id} node={n} step={s} model={model}
              actors={model.actors} systems={model.systems}
              autoHeight={!hasHeightOverride}
              onMeasure={(w, h) => reportMeasure(s.id, w, h)}
              onDelete={() => onDeleteAny(s.id)}
              onUpdate={(patch) => onUpdateItem(s.id, patch as Record<string, unknown>)}
              onDrag={(delta) => patchOverride(s.id, { cx: snap(n.cx + delta.dx), cy: snap(n.cy + delta.dy) })}
              onResize={(w, h) => patchOverride(s.id, { w: snap(w), h: snap(h) })}
              onRefine={handleRefine}
              onStartConnect={onAddConnection ? (e) => startConnDrag(s.id, e) : undefined}
              onSelect={() => bringToFront(s.id)}
              onBringToFront={() => bringToFront(s.id)}
              onSendToBack={() => sendToBack(s.id)}
              z={n.z}
            />
          );
        }
        if (it.kind === "decision") {
          const n = it.node;
          const d = n.ref as Decision;
          const hasHeightOverride = overrides[d.id]?.h !== undefined;
          return (
            <DecisionNode
              key={d.id} node={n} d={d} model={model}
              autoHeight={!hasHeightOverride}
              onMeasure={(w, h) => reportMeasure(d.id, w, h)}
              onDelete={() => onDeleteAny(d.id)}
              onUpdate={(patch) => onUpdateItem(d.id, patch as Record<string, unknown>)}
              onDrag={(delta) => patchOverride(d.id, { cx: snap(n.cx + delta.dx), cy: snap(n.cy + delta.dy) })}
              onResize={(w, h) => patchOverride(d.id, { w: snap(w), h: snap(h) })}
              onRefine={handleRefine}
              onStartConnect={onAddConnection ? (e) => startConnDrag(d.id, e) : undefined}
              onSelect={() => bringToFront(d.id)}
              onBringToFront={() => bringToFront(d.id)}
              onSendToBack={() => sendToBack(d.id)}
              z={n.z}
            />
          );
        }
        const n = it.node;
        const e = n.ref;
        const hasHeightOverride = overrides[e.id]?.h !== undefined;
        return (
          <ExceptionNode
            key={e.id} node={n} e={e} model={model}
            autoHeight={!hasHeightOverride}
            onMeasure={(w, h) => reportMeasure(e.id, w, h)}
            onDelete={() => onDeleteAny(e.id)}
            onUpdate={(patch) => onUpdateItem(e.id, patch as Record<string, unknown>)}
            onDrag={(delta) => patchOverride(e.id, { cx: snap(n.cx + delta.dx), cy: snap(n.cy + delta.dy) })}
            onResize={(w, h) => patchOverride(e.id, { w: snap(w), h: snap(h) })}
            onRefine={handleRefine}
            onStartConnect={onAddConnection ? (ev) => startConnDrag(e.id, ev) : undefined}
            onSelect={() => bringToFront(e.id)}
            onBringToFront={() => bringToFront(e.id)}
            onSendToBack={() => sendToBack(e.id)}
            z={n.z}
          />
        );
      })}

      {manualConnections.map((c) => {
        const a = geomById.get(c.fromId);
        const b = geomById.get(c.toId);
        if (!a || !b) return null;
        const mx = (a.cx + b.cx) / 2;
        const my = (a.cy + b.cy) / 2;
        return (
          <button
            key={`del-${c.id}`}
            data-no-pan
            data-conn-delete={c.id}
            onClick={(e) => { e.stopPropagation(); onDeleteConnection?.(c.id); }}
            title="Delete connector"
            className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/60 bg-card text-primary shadow-sm opacity-70 hover:opacity-100 hover:bg-primary hover:text-primary-foreground transition flex items-center justify-center"
            style={{ left: mx, top: my, zIndex: 40 }}
          >
            <X className="size-3" />
          </button>
        );
      })}
    </CanvasShell>
  );
}

function defaultLabelFor(shape?: string) {
  switch (shape) {
    case "terminator": return "Start";
    case "document": return "Document";
    case "io": return "Input / Output";
    case "subroutine": return "Subroutine";
    case "offpage": return "Off-page";
    case "task": return "Task";
    case "event": return "Event";
    case "swimlane": return "Swimlane";
    case "uml-class": return "ClassName";
    case "uml-interface": return "InterfaceName";
    case "uml-lifeline": return "Actor";
    case "er-entity": return "Table";
    default: return "New step";
  }
}


// -------- Palette --------

function ShapePalette({
  open, onToggle, showStarter, onInsertStarter,
}: {
  open: boolean; onToggle: () => void;
  showStarter: boolean; onInsertStarter: () => void;
}) {
  const [tab, setTab] = useState<PaletteTab>("flow");
  const items = PALETTE_TABS.find((t) => t.id === tab)?.items ?? FLOWCHART_ITEMS;
  return (
    <div className="absolute top-3 left-3 z-30 flex items-start gap-2" data-no-pan>
      <Button
        size="icon" variant="outline" className="h-8 w-8 bg-card/95 backdrop-blur shadow-sm"
        onClick={onToggle}
        title={open ? "Hide shape palette" : "Show shape palette"}
      >
        {open ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
      </Button>
      {open && (
        <div className="rounded-xl border bg-card/95 backdrop-blur shadow-lg w-[240px] overflow-hidden">
          <div className="flex border-b bg-muted/40">
            {PALETTE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex-1 px-2 py-2 text-[10px] font-mono-tight uppercase tracking-wider transition",
                  tab === t.id
                    ? "bg-card text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-2">
            <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground px-1 pb-1.5">
              Drag to canvas
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((it) => (
                <PaletteTile key={`${it.kind}-${it.shape ?? "x"}`} item={it} />
              ))}
            </div>
            {showStarter && (
              <>
                <div className="my-2 h-px bg-border" />
                <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground px-1 pb-1.5">
                  Starters
                </div>
                <Button
                  size="sm" variant="outline" className="w-full h-8 justify-start gap-1.5"
                  onClick={onInsertStarter}
                >
                  <Wand2 className="size-3.5 text-primary" />
                  <span className="text-xs">Request → Review → Decision</span>
                </Button>
              </>
            )}
            <div className="mt-2 text-[10px] text-muted-foreground leading-snug px-1">
              Hover a node for its connect handle. Snap-to-grid keeps placement tidy.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PaletteTile({ item }: { item: PaletteItem }) {
  const { label, hint, Icon, kind, shape } = item;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_MIME, JSON.stringify({ kind, shape }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group relative flex flex-col items-start gap-1 rounded-md border bg-background/80 px-2 py-2 cursor-grab active:cursor-grabbing hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm transition"
      title={`Drag ${label.toLowerCase()} onto the canvas`}
    >
      <div className="flex items-center gap-1.5 w-full">
        <ShapeGlyph kind={kind} shape={shape} />
        <div className="text-[11px] font-medium leading-tight truncate">{label}</div>
      </div>
      <div className="text-[9px] font-mono-tight text-muted-foreground leading-tight pl-6 truncate w-full">{hint}</div>
      <div className="absolute inset-0 rounded-md ring-0 group-active:ring-2 group-active:ring-primary/40 pointer-events-none transition" />
    </div>
  );
}

function ShapeGlyph({ kind, shape }: { kind: PaletteItem["kind"]; shape?: string }) {
  // Tiny preview so the palette isn't a wall of identical icons.
  const stroke = "currentColor";
  if (kind === "exception") {
    return <AlertTriangle className="size-4 text-unresolved shrink-0" />;
  }
  if (kind === "decision") {
    if (shape === "gateway-parallel") {
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 20" fill="none">
          <polygon points="10,2 18,10 10,18 2,10" stroke={stroke} strokeWidth="1.4" />
          <path d="M10 6v8M6 10h8" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    }
    if (shape === "gateway-exclusive") {
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 20" fill="none">
          <polygon points="10,2 18,10 10,18 2,10" stroke={stroke} strokeWidth="1.4" />
          <path d="M7 7l6 6M13 7l-6 6" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    }
    return <Diamond className="size-4 text-primary shrink-0" />;
  }
  // step variants
  switch (shape) {
    case "terminator":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 12" fill="none">
          <rect x="1" y="1" width="18" height="10" rx="5" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "document":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 16" fill="none">
          <path d="M2 2h16v10c-2 2-6-2-8 0s-6 2-8 0V2z" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "io":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 12" fill="none">
          <polygon points="4,2 18,2 16,10 2,10" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "subroutine":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 12" fill="none">
          <rect x="1" y="1" width="18" height="10" stroke={stroke} strokeWidth="1.4" />
          <path d="M4 1v10M16 1v10" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "offpage":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 12" fill="none">
          <polygon points="1,1 15,1 19,6 15,11 1,11" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "task":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 12" fill="none">
          <rect x="1" y="1" width="18" height="10" rx="2" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "event":
      return (
        <svg className="size-4 text-primary shrink-0" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke={stroke} strokeWidth="1.4" />
        </svg>
      );
    case "swimlane":
      return <Rows3 className="size-4 text-primary shrink-0" />;
    default:
      return <Square className="size-4 text-primary shrink-0" />;
  }
}

function Legend() {
  const chip = "flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground";
  return (
    <>
      <span className={chip}><span className="h-2 w-3 border-2 border-primary rounded-sm" /> Step</span>
      <span className={chip}><span className="h-2 w-2 rotate-45 border-2 border-primary" /> Decision</span>
      <span className={chip}><span className="h-2 w-3 border border-dashed border-unresolved rounded-sm" /> Unresolved</span>
      <span className={chip}><span className="h-2 w-3 border border-drift rounded-sm bg-drift/20" /> Drifted</span>
      <span className={chip}><GripVertical className="size-3" /> Drag · corner to resize · snap-to-grid</span>
    </>
  );
}

// ---- Node primitives ----

function useNodeDrag(onDrag: (d: { dx: number; dy: number }) => void, onSelect?: () => void) {
  const { zoom } = useCanvas();
  const startRef = { current: null as null | { x: number; y: number } };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect?.();
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

function useMeasure(onMeasure: (w: number, h: number) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onMeasure(el.offsetWidth, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);
  return ref;
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
      className="absolute bottom-0 right-0 w-3 h-3 rounded-sm border border-primary/60 bg-card cursor-nwse-resize opacity-0 group-hover:opacity-100 transition z-10"
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

function ConnectHandle({ onStartConnect }: { onStartConnect: (e: React.PointerEvent) => void }) {
  return (
    <div
      data-no-pan
      onPointerDown={(e) => { e.stopPropagation(); onStartConnect(e); }}
      className="absolute -right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-verified bg-card shadow-sm opacity-0 group-hover:opacity-100 hover:scale-125 transition cursor-crosshair z-10"
      title="Drag to another node to connect"
    />
  );
}

function ZOrderButtons({ onFront, onBack }: { onFront: () => void; onBack: () => void }) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition" data-no-pan>
      <button
        onClick={(e) => { e.stopPropagation(); onFront(); }}
        title="Bring to front"
        className="text-muted-foreground hover:text-foreground p-0.5"
      >
        <ArrowUpToLine className="size-3" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onBack(); }}
        title="Send to back"
        className="text-muted-foreground hover:text-foreground p-0.5"
      >
        <ArrowDownToLine className="size-3" />
      </button>
    </div>
  );
}

// -------- Shape frame (SVG background for step variants) --------

function ShapeFrame({
  shape, drift, userAdded, lowConf, children, insetClass,
}: {
  shape?: string; drift?: boolean; userAdded?: boolean; lowConf?: boolean;
  children: ReactNode;
  insetClass?: string;
}) {
  const strokeColor = drift ? "var(--color-drift)"
    : userAdded ? "var(--color-verified)"
    : lowConf ? "var(--color-unresolved)"
    : "var(--color-primary)";
  const strokeOpacity = drift || userAdded ? 1 : lowConf ? 0.9 : 0.6;
  const strokeDash = lowConf && !drift && !userAdded ? "5 3" : undefined;
  const strokeW = 2;
  const fill = drift ? "color-mix(in oklab, var(--color-drift) 6%, var(--color-card))"
    : lowConf ? "color-mix(in oklab, var(--color-unresolved) 6%, var(--color-card))"
    : "var(--color-card)";

  const inset = insetClass ?? "inset-0";

  const common = {
    stroke: strokeColor,
    strokeOpacity,
    strokeWidth: strokeW,
    strokeDasharray: strokeDash,
    fill,
    vectorEffect: "non-scaling-stroke" as const,
  };

  let bg: ReactNode = null;
  switch (shape) {
    case "terminator":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">
          <rect x="1" y="1" width="98" height="38" rx="20" ry="20" {...common} />
        </svg>
      );
      break;
    case "document":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 60" preserveAspectRatio="none" width="100%" height="100%">
          <path d="M1 1 H99 V50 Q75 62 50 50 T1 50 Z" {...common} />
        </svg>
      );
      break;
    case "io":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">
          <polygon points="15,2 99,2 85,38 1,38" {...common} />
        </svg>
      );
      break;
    case "subroutine":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">
          <rect x="1" y="1" width="98" height="38" {...common} />
          <line x1="8" y1="1" x2="8" y2="39" {...common} />
          <line x1="92" y1="1" x2="92" y2="39" {...common} />
        </svg>
      );
      break;
    case "offpage":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">
          <polygon points="1,1 85,1 99,20 85,39 1,39" {...common} />
        </svg>
      );
      break;
    case "task":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">
          <rect x="1" y="1" width="98" height="38" rx="8" ry="8" {...common} />
        </svg>
      );
      break;
    case "event":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
          <ellipse cx="50" cy="50" rx="48" ry="48" {...common} />
        </svg>
      );
      break;
    case "swimlane":
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
          <rect x="1" y="1" width="98" height="98" rx="4" {...common} strokeDasharray="4 3" fill="color-mix(in oklab, var(--color-primary) 3%, var(--color-card))" />
          <line x1="1" y1="14" x2="99" y2="14" {...common} strokeDasharray={undefined} />
        </svg>
      );
      break;
    default:
      // "step" / undefined → simple rounded rect
      bg = (
        <svg className={cn("absolute pointer-events-none", inset)} viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%">
          <rect x="1" y="1" width="98" height="38" rx="6" ry="6" {...common} />
        </svg>
      );
      break;
  }
  return (
    <>
      {bg}
      {children}
    </>
  );
}

// ---- Step ----

function StepNode({
  node, step, actors, systems, model, autoHeight, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, z,
}: {
  node: SpineNode; step: Step; model: ProcessModel;
  actors: { id: string; text: string }[]; systems: { id: string; text: string }[];
  autoHeight: boolean;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Step>) => void;
  onDrag: (d: { dx: number; dy: number }) => void;
  onResize: (w: number, h: number) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (e: React.PointerEvent) => void;
  onSelect: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  z: number;
}) {
  const drag = useNodeDrag(onDrag, onSelect);
  const ref = useMeasure(onMeasure);

  const shape = step.shape ?? "step";
  const isShaped = shape !== "step";
  const lowConf = step.confidence < 0.7 && !step.drift;

  // Padding tuned per shape so content sits inside the visible outline.
  const padClass =
    shape === "event" ? "px-6 py-6 items-center justify-center text-center"
    : shape === "io" ? "px-6 py-2"
    : shape === "offpage" ? "pl-3 pr-8 py-2"
    : shape === "subroutine" ? "px-6 py-2"
    : shape === "document" ? "px-3 pt-2 pb-4"
    : shape === "swimlane" ? "px-3 pt-8 pb-3"
    : shape === "terminator" ? "px-6 py-2 items-center justify-center text-center"
    : "px-3 py-2";

  // For the default (non-shaped) rendering keep the current bordered card look
  // exactly as before to preserve the extracted-artifact aesthetic.
  const baseClass = isShaped
    ? "relative bg-transparent"
    : cn(
        "relative rounded-lg border-2 bg-card shadow-sm",
        step.drift && "border-drift animate-drift bg-drift/5",
        lowConf && "border-dashed border-unresolved bg-unresolved/5",
        !step.drift && !lowConf && !step.userAdded && "border-primary/40",
        step.userAdded && "user-added !border-verified",
      );

  const contentInner = (
    <>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <DragHandle handlers={drag} />
          <IdChip id={step.id} tone="primary" />
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={step} />
          <ZOrderButtons onFront={onBringToFront} onBack={onSendToBack} />
          <RefineControl node={{ id: step.id, kind: "step", text: step.text }} model={model} onApply={onRefine} />
          <button onClick={onDelete} data-no-pan
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-xs leading-snug font-medium break-words">
        <InlineEdit value={step.text} onChange={(v) => onUpdate({ text: v })} multiline />
      </div>
      {shape !== "swimlane" && shape !== "event" && (
        <div className="flex flex-wrap gap-1 text-[10px] font-mono-tight text-muted-foreground mt-auto">
          <MetaSelect value={step.actorId} options={actors} onChange={(v) => onUpdate({ actorId: v })} />
          <span>·</span>
          <MetaSelect
            value={step.systemId ?? ""}
            options={[{ id: "", text: "no system" }, ...systems]}
            onChange={(v) => onUpdate({ systemId: v || undefined })}
          />
        </div>
      )}
    </>
  );

  const minH = defaultSizeFor("step", shape).h;

  return (
    <div
      ref={ref}
      data-node
      data-node-id={step.id}
      onPointerDown={() => onSelect()}
      className={cn("group absolute animate-item-in flex flex-col gap-1", baseClass, padClass)}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: minH,
        zIndex: 10 + z,
        ...(autoHeight ? {} : { height: node.h }),
      }}
    >
      {isShaped ? (
        <ShapeFrame shape={shape} drift={step.drift} userAdded={step.userAdded} lowConf={lowConf}>
          <div className="relative flex flex-col gap-1 w-full h-full min-h-0">{contentInner}</div>
        </ShapeFrame>
      ) : (
        contentInner
      )}
      {onStartConnect && <ConnectHandle onStartConnect={onStartConnect} />}
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

// ---- Decision (diamond / gateway) ----

function DecisionNode({
  node, d, model, autoHeight, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, z,
}: {
  node: SpineNode; d: Decision; model: ProcessModel;
  autoHeight: boolean;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Decision>) => void;
  onDrag: (delta: { dx: number; dy: number }) => void;
  onResize: (w: number, h: number) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (e: React.PointerEvent) => void;
  onSelect: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  z: number;
}) {
  const drag = useNodeDrag(onDrag, onSelect);
  const ref = useMeasure(onMeasure);
  const shape = d.shape ?? "decision";
  const isGateway = shape !== "decision";
  const gatewayGlyph = shape === "gateway-parallel" ? "+" : "×";
  const stroke = d.drift ? "var(--color-drift)" : d.userAdded ? "var(--color-verified)" : "var(--color-primary)";
  const fill = d.drift
    ? "color-mix(in oklab, var(--color-drift) 6%, var(--color-card))"
    : "var(--color-card)";

  return (
    <div
      ref={ref}
      data-node
      data-node-id={d.id}
      onPointerDown={() => onSelect()}
      className={cn("group absolute animate-item-in", d.drift && "animate-drift")}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: DEC_H,
        zIndex: 10 + z,
        ...(autoHeight ? {} : { height: node.h }),
      }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <polygon
          points="50,2 98,50 50,98 2,50"
          fill={fill}
          stroke={stroke}
          strokeOpacity={d.drift || d.userAdded ? 1 : 0.7}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {isGateway && (
          <text x="50" y="58" textAnchor="middle" fontSize="28" fill={stroke} fontFamily="var(--font-mono)">
            {gatewayGlyph}
          </text>
        )}
      </svg>
      <div
        className="relative flex flex-col items-center justify-center text-center gap-1"
        style={{ padding: "14% 18%" }}
      >
        <div className="flex items-center gap-1 flex-wrap justify-center">
          <DragHandle handlers={drag} />
          <IdChip id={d.id} tone="primary" />
          <ConfidenceBadge item={d} />
          <ZOrderButtons onFront={onBringToFront} onBack={onSendToBack} />
          <RefineControl node={{ id: d.id, kind: "decision", text: d.text }} model={model} onApply={onRefine} />
          <button onClick={onDelete} data-no-pan
            className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition">
            <X className="size-3" />
          </button>
        </div>

        <div className="text-[11px] font-medium leading-tight break-words w-full">
          <InlineEdit value={d.text} onChange={(v) => onUpdate({ text: v })} multiline />
        </div>
        {!isGateway && (
          <div className="flex gap-2 text-[9px] font-mono-tight text-muted-foreground flex-wrap justify-center">
            <span className="text-confident">yes→<InlineEdit value={d.yes} onChange={(v) => onUpdate({ yes: v })} /></span>
            <span className="text-drift">no→<InlineEdit value={d.no} onChange={(v) => onUpdate({ no: v })} /></span>
          </div>
        )}
      </div>
      {onStartConnect && <ConnectHandle onStartConnect={onStartConnect} />}
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

// ---- Exception ----

function ExceptionNode({
  node, e, model, autoHeight, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, z,
}: {
  node: RightNode; e: Exception; model: ProcessModel;
  autoHeight: boolean;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Exception>) => void;
  onDrag: (d: { dx: number; dy: number }) => void;
  onResize: (w: number, h: number) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (ev: React.PointerEvent) => void;
  onSelect: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  z: number;
}) {
  const drag = useNodeDrag(onDrag, onSelect);
  const ref = useMeasure(onMeasure);
  return (
    <div
      ref={ref}
      data-node
      data-node-id={e.id}
      onPointerDown={() => onSelect()}
      className={cn(
        "group absolute rounded-md border border-dashed bg-unresolved/5 border-unresolved/70 px-2.5 py-2 shadow-sm flex flex-col gap-1 animate-item-in",
        e.userAdded && "user-added !border-verified border-solid",
      )}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: EX_H,
        zIndex: 10 + z,
        ...(autoHeight ? {} : { height: node.h }),
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <DragHandle handlers={drag} />
          <IdChip id={e.id} />
          <span className="text-[9px] font-mono-tight uppercase tracking-widest text-unresolved">
            <Zap className="inline size-2.5 -mt-0.5" /> Exception
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={e} />
          <ZOrderButtons onFront={onBringToFront} onBack={onSendToBack} />
          <RefineControl node={{ id: e.id, kind: "exception", text: e.text }} model={model} onApply={onRefine} />
          <button onClick={onDelete} data-no-pan
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-[11px] leading-snug break-words">
        <InlineEdit value={e.text} onChange={(v) => onUpdate({ text: v })} multiline />
      </div>
      {onStartConnect && <ConnectHandle onStartConnect={onStartConnect} />}
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

// Silence unused-import warnings.
export const _pc_unused = { useEffect };

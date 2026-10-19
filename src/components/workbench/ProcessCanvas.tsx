import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decisionBranches, type BaseItem, type ProcessModel, type Step, type Decision, type DecisionBranch, type Exception, type Connection, type CrowMarker, type NodeLayout, type ViewId } from "@/data/samples";
import { cn } from "@/lib/utils";
import { gradeOf } from "@/lib/grade";
import { ConfidenceBadge, IdChip } from "./atoms";
import {
  Plus, X, GripVertical, Square, Diamond, AlertTriangle, Wand2,
  PanelRightOpen, PanelRightClose, Circle, FileText, ChevronsRight,
  Layers, Zap, Rows3,
  Table2, Boxes, GitBranch, MoreHorizontal, BookOpen,

} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CanvasShell, useWorldDrag } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { SelectionBar, SelectionOutlines, SnapGuides, useShapeSelection } from "./canvas-selection";
import type { ShapeClip } from "@/lib/canvas/clipboard";
import { isUserCreatedId } from "@/lib/item-origin";
import { useRevealNew, FlashRing } from "./canvas-reveal";
import { InlineEdit } from "./InlineEdit";
import { LineLabel } from "./LineLabel";
import { LAYER, restack } from "./canvas-layers";
import { ConnectHandles, ConnectorEnds, ConnectorPreview, LineBar, useConnectorDrag } from "./canvas-connectors";
import { connectorRoute } from "@/lib/canvas/connector";
import { edgePoint, roundedPath, type Point } from "@/lib/canvas/geometry";
import { SAVE_LAYOUTS, layoutOf, placeClear } from "@/lib/canvas/layout";
import { RefineControl } from "./RefineControl";
import { useArtifactFullscreen, isTypingTarget } from "./artifact-fullscreen";
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
// More breathing room between stacked nodes and between the main spine and
// the exception corridor -- Miro-style diagrams give connectors room to
// curve rather than packing shapes edge-to-edge.
const V_GAP = 88;
const TOP_PAD = 48;
const RIGHT_CORRIDOR_X = CENTER_X + STEP_W / 2 + 120;
const LANE_GAP = 40;
const GRID = 20;

const MIN_W = 160, MIN_H = 70, MAX_W = 640, MAX_H = 600;

const snap = (v: number) => Math.round(v / GRID) * GRID;

// Corner radius for orthogonal connector paths -- the single biggest lever
// for a Miro-like feel. A sharp 90-degree elbow reads as "generated
// wireframe"; the same route with rounded corners reads as a designed
// diagram. Clamped per-corner to half the shorter adjacent segment so it
// never overshoots on a tight turn.
const CONNECTOR_RADIUS = 14;
const connectorPath = (points: Point[]) => roundedPath(points, CONNECTOR_RADIUS);

export type NodeOverride = { cx?: number; cy?: number; w?: number; h?: number; z?: number };
/** The saved arrangement of the process map, by item id (top-left corners). */
type Saved = Record<string, NodeLayout>;
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
  /** Which side of the target `to` is on: an exception is entered from its
   *  left, a step looped back to from its right. */
  enter: "left" | "right";
  /** For a left entry, the target's right-hand side: used instead when a
   *  shape moved by hand puts the target left of the line's start. */
  toRight?: { x: number; y: number };
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

// The "document" shape's wavy bottom sits visibly above the full bounding
// box, so a spine arrow anchored at the true bottom edge leaves a gap above
// the drawn wave. Fraction of half-height to pull the anchor up by. Every
// other shape's top/bottom edge is within ~5% of the bounding box (checked
// io, offpage, terminator, event) -- not worth the same treatment.
function bottomInsetFor(shape?: string): number {
  return shape === "document" ? 0.12 : 0;
}

function effSize(id: string, defW: number, defH: number, overrides: Overrides, measured: Measured, saved?: Saved) {
  const o = overrides[id];
  const sv = saved?.[id];
  const m = measured[id];
  // A measurement of 0 is "not laid out", never a size (see useMeasure).
  // Belt and braces: `??` alone would accept it and draw the node zero wide.
  const mw = m && m.w > 0 ? m.w : undefined;
  const mh = m && m.h > 0 ? m.h : undefined;
  // A height set by hand is the least the shape takes: its text can make it
  // taller (the node is drawn with that height as its min-height, and what
  // it measures is what it needs).
  const set = o?.h ?? sv?.h;
  const h = set !== undefined && mh !== undefined ? Math.max(set, mh) : set ?? mh ?? defH;
  return { w: o?.w ?? sv?.w ?? mw ?? defW, h };
}

function zOf(id: string, overrides: Overrides) {
  return overrides[id]?.z ?? 0;
}

/** Positions in the order of precedence: a drag or resize in progress
 *  (`overrides`, this tab only), then the saved arrangement (`saved`, when
 *  the person has arranged this diagram), then the automatic layout. In an
 *  arranged diagram a shape with no saved place (just added, or arriving
 *  from a re-check) goes under the shape before it in the flow, moved down
 *  until it is clear of the others. */
function layout(model: ProcessModel, overrides: Overrides, measured: Measured, saved?: Saved): Layout {
  const spine: SpineNode[] = [];
  const spineIndexById = new Map<string, number>();
  let cursor = TOP_PAD;
  // Shapes still to be placed in an arranged diagram (see above).
  const floating = new Set<string>();

  const pushSpine = (
    kind: "step" | "decision",
    ref: Step | Decision,
    defW: number,
    defH: number,
  ) => {
    const id = ref.id;
    const { w, h } = effSize(id, defW, defH, overrides, measured, saved);
    const naturalCy = cursor + h / 2;
    const o = overrides[id], sv = saved?.[id];
    const cx = o?.cx ?? (sv ? sv.x + w / 2 : CENTER_X);
    const cy = o?.cy ?? (sv ? sv.y + h / 2 : naturalCy);
    if (saved && !sv && o?.cx === undefined) floating.add(id);
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

  // The right-side lane corridor carries one lane per exception plus one per
  // non-primary decision branch. The exception column used to sit at a fixed
  // offset regardless of how many lanes that turned out to be -- fine for a
  // couple of exceptions, but with more branches/exceptions than that, lane
  // lines run straight through the exception boxes instead of stopping at
  // them. Reserve space for a safe (deliberately generous) upper bound on
  // lane count instead: every branch of every decision, even though in
  // practice one branch per decision usually skips a lane by continuing
  // straight down the spine.
  const maxPossibleLanes = model.exceptions.length +
    model.decisions.reduce((sum, d) => sum + decisionBranches(d).length, 0);
  const exceptionColX = RIGHT_CORRIDOR_X + Math.max(1, maxPossibleLanes) * LANE_GAP + 40;

  const right: RightNode[] = [];
  const occupiedYs: number[] = [];
  model.exceptions.forEach((e) => {
    const { w, h } = effSize(e.id, EX_W, EX_H, overrides, measured, saved);
    const o = overrides[e.id], sv = saved?.[e.id];
    if (saved && !sv && o?.cx === undefined) floating.add(e.id);
    const anchor = e.relatedStepId ? spine[spineIndexById.get(e.relatedStepId) ?? 0] : spine[0];
    let cy = o?.cy ?? (sv ? sv.y + h / 2 : anchor?.cy ?? TOP_PAD + h / 2);
    if (o?.cy === undefined && !sv) {
      while (occupiedYs.some((y) => Math.abs(y - cy) < h + 20)) cy += h + 20;
    }
    occupiedYs.push(cy);
    const cx = o?.cx ?? (sv ? sv.x + w / 2 : exceptionColX + w / 2);
    right.push({ kind: "exception", ref: e, cx, cy, w, h, z: zOf(e.id, overrides) });
  });

  if (floating.size > 0) {
    const rectOf = (n: { cx: number; cy: number; w: number; h: number }) => ({ x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h });
    const taken = [...spine, ...right].filter((n) => !floating.has(n.ref.id)).map(rectOf);
    const settle = (n: { cx: number; cy: number; w: number; h: number }, want: { x: number; y: number }) => {
      const r = placeClear({ ...want, w: n.w, h: n.h }, taken, 24);
      n.cx = r.x + n.w / 2;
      n.cy = r.y + n.h / 2;
      taken.push(r);
    };
    spine.forEach((n, i) => {
      if (!floating.has(n.ref.id)) return;
      const prev = spine[i - 1];
      settle(n, prev
        ? { x: prev.cx - n.w / 2, y: prev.cy + prev.h / 2 + V_GAP }
        : { x: CENTER_X - n.w / 2, y: TOP_PAD });
    });
    right.forEach((n) => {
      if (!floating.has(n.ref.id)) return;
      const rel = n.ref.relatedStepId ? spine[spineIndexById.get(n.ref.relatedStepId) ?? -1] : undefined;
      settle(n, rel
        ? { x: rel.cx + rel.w / 2 + 120, y: rel.cy - n.h / 2 }
        : { x: exceptionColX, y: TOP_PAD });
    });
  }

  const routes: Route[] = [];
  let laneCounter = 0;
  const nextLaneX = () => RIGHT_CORRIDOR_X + laneCounter++ * LANE_GAP;

  right.forEach((ex) => {
    const rel = ex.ref.relatedStepId;
    const relIdx = rel ? spineIndexById.get(rel) : undefined;
    // Only an exception tied to a step on the map gets a line. One with no
    // step (extraction often leaves it out) used to be drawn coming off the
    // first step, which claimed a link the source never made.
    const src = relIdx !== undefined ? spine[relIdx] : undefined;
    if (!src) return;
    routes.push({
      id: `route-ex-${ex.ref.id}`, kind: "exception", laneX: nextLaneX(),
      from: { x: src.cx + src.w / 2, y: src.cy },
      to:   { x: ex.cx - ex.w / 2, y: ex.cy },
      enter: "left", toRight: { x: ex.cx + ex.w / 2, y: ex.cy },
      label: ex.ref.id,
    });
  });

  spine.forEach((n, idx) => {
    if (n.kind !== "decision") return;
    const d = n.ref;
    const branches = decisionBranches(d);
    // The one branch (if any) whose target is structurally the next spine
    // node is drawn as the plain straight-down connector below, not a lane
    // route -- generalizes the old "yes always continues down" assumption
    // to "whichever branch actually continues down, however many there are."
    const nextNode = spine[idx + 1];
    const primary = nextNode ? branches.find((b) => b.targetId === nextNode.ref.id) : undefined;

    branches.forEach((b) => {
      if (primary && b.id === primary.id) return;
      const exRight = right.find((r) => r.ref.id === b.targetId);
      if (exRight) {
        routes.push({
          id: `route-${d.id}-${b.id}`, kind: "no-branch", laneX: nextLaneX(),
          from: { x: n.cx + n.w / 2, y: n.cy },
          to:   { x: exRight.cx - exRight.w / 2, y: exRight.cy },
          enter: "left", toRight: { x: exRight.cx + exRight.w / 2, y: exRight.cy },
          label: `${b.label} → ${b.targetId}`,
        });
        return;
      }
      const tgtIdx = spineIndexById.get(b.targetId);
      if (tgtIdx !== undefined) {
        const tgt = spine[tgtIdx];
        routes.push({
          id: `route-${d.id}-${b.id}`, kind: "no-branch", laneX: nextLaneX(),
          from: { x: n.cx + n.w / 2, y: n.cy },
          to:   { x: tgt.cx + tgt.w / 2, y: tgt.cy },
          enter: "right",
          label: `${b.label} → ${b.targetId}`,
        });
      }
    });
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
  onAddStep: (text: string, shape?: Step["shape"], actorId?: string) => string | void;
  /** Lets the add bar name a new actor on the spot. Without it the bar can
   *  only offer the actors that already exist. */
  onAddActor?: (name: string) => string | void;
  onAddDecision?: (text: string, shape?: Decision["shape"]) => string | void;
  onAddException?: (text: string) => string | void;
  onAddConnection?: (fromId: string, toId: string) => string | void;
  onDeleteConnection?: (id: string) => void;
  onUpdateConnection?: (id: string, patch: Partial<Connection>) => void;
  onDeleteAny: (id: string) => void;
  onUpdateItem: (id: string, patch: Record<string, unknown>) => void;
  onApplyRefinement?: (p: Proposal) => void;
  /** Opens the Use Case Description drill-down for a step (see Workbench.tsx). */
  onOpenUseCase?: (stepId: string) => void;
  /** Saves where shapes were moved or resized to (see ArtifactEditing). */
  onPlaceShapes?: (view: ViewId, moved: Record<string, NodeLayout | null>, current: Record<string, NodeLayout>, mergeKey?: string) => boolean;
  /** Back to the automatic layout. */
  onTidyUp?: (view: ViewId) => boolean;
  /** Whether this tab may edit; says why not when it may not. */
  canEdit?: () => boolean;
  /** Several shapes at once (a selection), as one undo step. */
  onDeleteMany?: (ids: string[]) => void;
  /** Pastes copies as new items (see ArtifactEditing.onPasteShapes). */
  onPasteShapes?: (view: ViewId, clip: ShapeClip, dx: number, dy: number, current: Record<string, NodeLayout>) =>
    { ids: string[]; places: Record<string, NodeLayout> } | null;
}

interface PaletteItem {
  kind: "step" | "decision" | "exception";
  shape?: StepShape | DecisionShape;
  label: string;
  hint: string;
  Icon: typeof Square;
}

const PALETTE_MIME = "application/x-visuail-shape";
/** Width the open palette (toggle + panel) takes from the canvas's left edge,
 *  beyond the shell's normal margin -- passed to the shell so an opening view
 *  or a reveal never parks content underneath it. */
const PALETTE_INSET = 284;
/** Sentinel value for the add bar's "New actor…" choice. */
const NEW_ACTOR = "__new_actor__";
/** Boxes that are not steps in a flow (class, entity, lifeline, lane). They
 *  share the step model so they can be placed and edited, but no arrow should
 *  run through them. */
const NON_FLOW_SHAPES = new Set(["uml-class", "uml-interface", "uml-lifeline", "er-entity", "swimlane"]);

const FLOWCHART_ITEMS: PaletteItem[] = [
  { kind: "step", shape: "step", label: "Step", hint: "Rectangle", Icon: Square },
  { kind: "step", shape: "terminator", label: "Terminator", hint: "Start / End", Icon: Circle },
  { kind: "step", shape: "document", label: "Document", hint: "Wavy bottom", Icon: FileText },
  { kind: "step", shape: "io", label: "Input / Output", hint: "Parallelogram", Icon: ChevronsRight },
  { kind: "step", shape: "subroutine", label: "Subroutine", hint: "Double bars", Icon: Layers },
  { kind: "step", shape: "offpage", label: "Off-page ref", hint: "Pentagon", Icon: ChevronsRight },
  { kind: "decision", shape: "decision", label: "Decision", hint: "Diamond", Icon: Diamond },
  { kind: "exception", label: "Exception", hint: "Side path", Icon: AlertTriangle },
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
  { kind: "step", shape: "uml-lifeline", label: "Lifeline", hint: "Sequence diagram", Icon: GitBranch },
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
  model, onAddStep, onAddActor, onAddDecision, onAddException,
  onAddConnection, onDeleteConnection, onUpdateConnection,
  onDeleteAny, onUpdateItem, onApplyRefinement, onOpenUseCase,
  onPlaceShapes, onTidyUp, canEdit, onDeleteMany, onPasteShapes,
}: Props) {

  // Hand-placed positions, sizes and stacking are view state, not model
  // state. Parked in the artifact's view store so a trip to another tab and
  // back does not snap every node to the auto layout again.
  const [overrides, setOverrides] = useCanvasViewState<Overrides>("process:overrides", {});
  const [measured, setMeasured] = useState<Measured>({});

  const isEmpty = model.steps.length === 0 && model.decisions.length === 0 && model.exceptions.length === 0;
  // Present mode (full screen, showing the diagram to others): every editing
  // control is marked data-edit-control and hidden by the stylesheet; what
  // can still change the diagram without one of them is guarded here.
  const presenting = !!useArtifactFullscreen()?.presenting;

  // The shape menu (Flowchart / BPMN / UML / Database) starts closed on every
  // diagram, a newly created empty one included. It used to open by default,
  // on top of the first nodes of the diagram; then only on an empty canvas,
  // which still meant every diagram someone had just created greeted them
  // with a menu over a third of it. An empty canvas instead carries a short
  // prompt with the same three ways to begin (see EmptyDiagramPrompt), and
  // "Shapes" is one click away. An explicit toggle is remembered for this
  // artifact while it is open; it is NOT carried to other diagrams or later
  // visits, where an "open" remembered from a wide canvas would cover half
  // of a narrow one.
  const [paletteChoice, setPaletteChoice] = useCanvasViewState<boolean | null>("process:palette", null);
  const paletteOpen = paletteChoice ?? false;
  const togglePalette = () => setPaletteChoice(!paletteOpen);

  const reportMeasure = useCallback((id: string, w: number, h: number) => {
    setMeasured((cur) => {
      const prev = cur[id];
      if (prev && Math.abs(prev.h - h) < 1 && Math.abs(prev.w - w) < 1) return cur;
      return { ...cur, [id]: { w, h } };
    });
  }, []);

  // The person's own arrangement, when they have made one (see layout()).
  const saved = layoutOf(model, "process")?.nodes;
  const { spine, right, routes, width, height } = useMemo(
    () => layout(model, overrides, measured, saved),
    [model, overrides, measured, saved],
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addActorId, setAddActorId] = useState("");
  const [newActorName, setNewActorName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // Said a beat AFTER the focus move that follows an add (a screen reader
  // drops a message that arrives together with a focus change), cleared so
  // it is not found later lying beside the button as if it were current, and
  // emptied first so saying the same thing twice is still a change.
  const announceTimers = useRef<number[]>([]);
  const announce = (text: string) => {
    announceTimers.current.forEach((t) => window.clearTimeout(t));
    setAnnouncement("");
    announceTimers.current = [
      window.setTimeout(() => setAnnouncement(text), 200),
      window.setTimeout(() => setAnnouncement(""), 6000),
    ];
  };
  useEffect(() => () => { announceTimers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const draftRef = useRef<HTMLInputElement | null>(null);
  const actorNameRef = useRef<HTMLInputElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  // Picking "New actor…" with the pointer means "now I'll type the name", so
  // focus goes to the name field. Arrowing past it with the keyboard does
  // not: yanking focus out of a list someone is still stepping through is a
  // change of context they did not ask for. They reach the field with Tab.
  const pickedByKey = useRef(false);
  const [focusActorName, setFocusActorName] = useState(false);
  // Closing the bar removes the field that had focus; hand it back to the
  // button that opened the bar instead of letting it fall to the page.
  const [refocusAdd, setRefocusAdd] = useState(false);
  useEffect(() => {
    if (!refocusAdd) return;
    addButtonRef.current?.focus({ preventScroll: true });
    setRefocusAdd(false);
  }, [refocusAdd]);

  const patchOverride = (id: string, o: NodeOverride) =>
    setOverrides((cur) => ({ ...cur, [id]: { ...cur[id], ...o } }));

  // Stacking by hand: ranks recounted on every change (canvas-layers.ts),
  // so a shape clicked a thousand times still sits under the line labels
  // and the selection outline.
  const restackTo = useCallback((id: string, where: "front" | "back") => {
    setOverrides((cur) => {
      const ranks = restack(Object.fromEntries(Object.entries(cur).map(([k, o]) => [k, o?.z])), id, where);
      if (Object.entries(cur).every(([k, o]) => (o?.z ?? 0) === (ranks[k] ?? 0)) && (ranks[id] ?? 0) === (cur[id]?.z ?? 0)) return cur;
      const next = { ...cur };
      for (const [k, o] of Object.entries(next)) if (o?.z !== undefined && !(k in ranks)) next[k] = { ...o, z: undefined };
      for (const [k, z] of Object.entries(ranks)) next[k] = { ...next[k], z };
      return next;
    });
  }, [setOverrides]);
  const bringToFront = useCallback((id: string) => restackTo(id, "front"), [restackTo]);
  const sendToBack = useCallback((id: string) => restackTo(id, "back"), [restackTo]);
  // Pressing on a node brings it to the front. Not while presenting: there a
  // press on a node starts panning the view, and the stacking stays put.
  const selectNode = (id: string) => { if (!presenting) bringToFront(id); };

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

  // A drag or resize by hand, as opposed to a position this code assigns
  // (a palette drop, the starter flow). Noted so Undo can say that moves are
  // not something it steps back through -- but only when something actually
  // moved: a click on a node's grip runs the same callback with no distance.
  const noteMove = useNoteLayoutMove();
  const moveOverride = (id: string, o: NodeOverride) => {
    const g = geomById.get(id);
    const differs = (k: "cx" | "cy" | "w" | "h") => o[k] !== undefined && o[k] !== g?.[k];
    // Only while moves are not saved: once they are, Undo steps back through them.
    if (!SAVE_LAYOUTS && (!g || differs("cx") || differs("cy") || differs("w") || differs("h"))) noteMove(model);
    patchOverride(id, o);
  };
  // Where everything is drawn as of the latest render. A drag's handlers are
  // the ones from when it started; at its end they need the shapes as they
  // are now (a resize has changed the size since).
  const geomRef = useRef(geomById);
  geomRef.current = geomById;
  /** Every shape's place as drawn now: saved along with the first move, so
   *  nothing else jumps when the automatic layout stops. */
  const currentPlaces = () => Object.fromEntries(
    [...geomRef.current].map(([id, g]) => [id, { x: g.cx - g.w / 2, y: g.cy - g.h / 2 }]),
  );
  /** A move or resize: drawn live while it lasts; saved, as one undo step,
   *  when it ends. */
  const place = (id: string, o: NodeOverride, done?: boolean) => {
    moveOverride(id, o);
    if (!done || !SAVE_LAYOUTS || !onPlaceShapes) return;
    const g = geomRef.current.get(id);
    if (!g) return;
    const w = o.w ?? g.w, h = o.h ?? g.h;
    // The top as drawn: the text can make a shape taller than the height
    // set by hand (g.h), and that height is only its least.
    const at: NodeLayout = { x: (o.cx ?? g.cx) - w / 2, y: (o.cy ?? g.cy) - Math.max(h, g.h) / 2 };
    if (o.w !== undefined) at.w = w;
    if (o.h !== undefined) at.h = h;
    onPlaceShapes("process", { [id]: at }, currentPlaces());
    // The saved place draws it from now on; only the stacking stays local.
    setOverrides((cur) => {
      const next = { ...cur };
      const z = cur[id]?.z;
      if (z === undefined) delete next[id]; else next[id] = { z };
      return next;
    });
  };
  /** New shapes placed by this code (a palette drop, the starter flow). */
  const placeNew = (entries: { id: string; cx: number; cy: number; w: number; h: number }[]) => {
    if (SAVE_LAYOUTS && onPlaceShapes) {
      onPlaceShapes("process", Object.fromEntries(entries.map((e) => [e.id, { x: e.cx - e.w / 2, y: e.cy - e.h / 2 }])), currentPlaces());
    } else {
      entries.forEach((e) => patchOverride(e.id, { cx: e.cx, cy: e.cy }));
    }
  };
  const tidyUp = () => {
    if (!onTidyUp?.("process")) return;
    setOverrides({});
  };

  const { apiRef: shellApi, revealNew, flash, flashId } = useRevealNew((id) => {
    const g = geomById.get(id);
    return g ? { x: g.cx - g.w / 2, y: g.cy - g.h / 2, w: g.w, h: g.h } : null;
  });
  const flashGeom = flashId ? geomById.get(flashId) : undefined;

  // What is actually drawn, as opposed to the padded sheet it is drawn on
  // (never smaller than 900x620): the minimap draws it, and the canvas uses
  // it to judge whether part of the diagram is out of view and how far the
  // world reaches (shapes can be dragged anywhere, left of or above the start).
  const shapeRects = useMemo(
    () => [...geomById.values()].map((g) => ({ x: g.cx - g.w / 2, y: g.cy - g.h / 2, w: g.w, h: g.h })),
    [geomById],
  );
  const rectsById = useMemo(
    () => new Map([...geomById].map(([id, g]) => [id, { x: g.cx - g.w / 2, y: g.cy - g.h / 2, w: g.w, h: g.h }])),
    [geomById],
  );

  // The connectors drawn (both ends on this diagram): one can be selected.
  const drawnLines = useMemo(
    () => new Set((model.connections ?? []).filter((c) => geomById.has(c.fromId) && geomById.has(c.toId)).map((c) => c.id)),
    [model.connections, geomById],
  );

  // What each shape and line is called: for screen readers, and the lists
  // in the selection bar and the line bar.
  const shapeName = (id: string) => {
    const s = model.steps.find((x) => x.id === id); if (s) return `Step “${s.text}”`;
    const d = model.decisions.find((x) => x.id === id); if (d) return `Decision “${d.text}”`;
    const e = model.exceptions.find((x) => x.id === id); if (e) return `Exception “${e.text}”`;
    return id;
  };
  const lineName = (id: string) => {
    const c = (model.connections ?? []).find((x) => x.id === id);
    return c ? `Line from ${shapeName(c.fromId)} to ${shapeName(c.toId)}` : "Line";
  };
  const shapeList = [...rectsById.keys()].map((id) => ({ id, name: shapeName(id) }));

  // Selecting shapes (click, Shift-click, a box), moving them together, the
  // keys, copy and paste (canvas-selection.tsx).
  const sel = useShapeSelection({
    view: "process", model, rects: rectsById, shellApi, presenting,
    lines: drawnLines, onDeleteLine: onDeleteConnection,
    nameOf: shapeName, lineNameOf: lineName,
    // Alt+Shift+arrows: wider/narrower, taller/shorter, on the grid.
    onResizeBy: (id, dw, dh) => {
      const g = geomRef.current.get(id);
      if (!g) return;
      place(id, {
        ...(dw ? { w: snap(Math.min(MAX_W, Math.max(MIN_W, g.w + dw))) } : {}),
        ...(dh ? { h: snap(Math.min(MAX_H, Math.max(MIN_H, g.h + dh))) } : {}),
      }, true);
    },
    canEdit: canEdit ?? alwaysEditable,
    preview: (places) => {
      for (const [id, p] of Object.entries(places)) {
        const g = geomRef.current.get(id);
        if (g) moveOverride(id, { cx: p.x + g.w / 2, cy: p.y + g.h / 2 });
      }
    },
    commit: (places, mergeKey) => {
      if (!SAVE_LAYOUTS || !onPlaceShapes) return;
      onPlaceShapes("process", places, currentPlaces(), mergeKey);
      // The saved places draw them from now on; only stacking stays local.
      setOverrides((cur) => {
        const next = { ...cur };
        for (const id of Object.keys(places)) {
          const z = cur[id]?.z;
          if (z === undefined) delete next[id]; else next[id] = { z };
        }
        return next;
      });
    },
    onDeleteMany: (ids) => (onDeleteMany ? onDeleteMany(ids) : ids.forEach(onDeleteAny)),
    onPaste: (clip, dx, dy) => {
      const made = onPasteShapes?.("process", clip, dx, dy, currentPlaces()) ?? null;
      // Saving off: draw them where they were pasted until the page reloads.
      if (made && !SAVE_LAYOUTS) {
        for (const id of made.ids) {
          const p = made.places[id];
          if (!p) continue;
          const kind = id.startsWith("DC-") ? "decision" : id.startsWith("EX-") ? "exception" : "step";
          // The copy keeps its special shape (event, document...): size by it.
          const shape = kind === "step" ? clip.items[made.ids.indexOf(id)]?.item.shape : undefined;
          const size = defaultSizeFor(kind, typeof shape === "string" ? shape : undefined);
          patchOverride(id, { cx: p.x + size.w / 2, cy: p.y + size.h / 2 });
        }
      }
      return made;
    },
    onBringToFront: bringToFront,
    onSendToBack: sendToBack,
    snap,
  });
  /** A drag by a grip: the whole selection when that shape is part of a
   *  bigger one, else just the shape. */
  const gripGroup = useRef<Record<string, { x: number; y: number }> | null>(null);
  const gripDrag = (id: string, delta: DragDelta, done?: boolean) => {
    const ids = sel.selection.ids;
    const group = ids.length > 1 && ids.includes(id) ? ids : [id];
    if (!gripGroup.current) {
      gripGroup.current = Object.fromEntries(group.map((x) => [x, rectsById.get(x)]).filter(([, r]) => r)
        .map(([x, r]) => [x as string, { x: (r as { x: number }).x, y: (r as { y: number }).y }]));
    }
    // Lined up with the shapes around (snap guides), else on the grid.
    const moved = sel.lineUp(Object.fromEntries(Object.entries(gripGroup.current)
      .map(([x, p]) => [x, { x: p.x + delta.dx, y: p.y + delta.dy }])), !!delta.free);
    if (!done) { for (const [x, p] of Object.entries(moved)) { const g = geomRef.current.get(x); if (g) moveOverride(x, { cx: p.x + g.w / 2, cy: p.y + g.h / 2 }); } return; }
    gripGroup.current = null;
    sel.endGuides();
    if (group.length === 1) {
      const g = geomRef.current.get(id), p = moved[id];
      if (g && p) place(id, { cx: p.x + g.w / 2, cy: p.y + g.h / 2 }, true);
      return;
    }
    if (SAVE_LAYOUTS && onPlaceShapes) {
      onPlaceShapes("process", moved, currentPlaces());
      setOverrides((cur) => { const next = { ...cur }; for (const x of Object.keys(moved)) { const z = cur[x]?.z; if (z === undefined) delete next[x]; else next[x] = { z }; } return next; });
    }
  };

  // Adding from the bar asks who does the step instead of assuming. The
  // select opens on whoever did the previous step -- the likeliest answer --
  // and is right there to change before the step exists.
  const openAddBar = () => {
    const previous = model.steps.at(-1)?.actorId;
    const preset = previous && model.actors.some((a) => a.id === previous) ? previous : model.actors[0]?.id;
    // No actors yet (every from-scratch diagram): go straight to naming one,
    // rather than showing no question at all and saving the step to nobody.
    setAddActorId(preset ?? (onAddActor ? NEW_ACTOR : ""));
    setNewActorName("");
    pickedByKey.current = false;
    setFocusActorName(false);
    setAdding(true);
  };
  const closeAddBar = () => { setAdding(false); setDraft(""); setNewActorName(""); setRefocusAdd(true); };
  // Present mode hides the bar (CanvasShell drops its bottom-right slot), and
  // leaving it would mount the bar afresh, its autoFocus field taking the
  // focus nobody asked to move. Close it as Cancel does when Present starts.
  useEffect(() => {
    if (presenting && adding) closeAddBar();
    // Only the switch into Present closes it; closeAddBar is a fresh
    // function every render and adding is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting]);
  // The select can outlive its own option: an actor deleted elsewhere while
  // the bar is open. Fall back to something that exists.
  const addActorValue = addActorId === NEW_ACTOR || model.actors.some((a) => a.id === addActorId)
    ? addActorId
    : model.actors[0]?.id ?? (onAddActor ? NEW_ACTOR : "");
  // "New actor…" picked from a list of real actors is a statement that this
  // step belongs to someone new, so it needs their name; leaving it blank
  // used to save the step to nobody without a word. Only a diagram with no
  // actors at all may skip the question (the field says it is optional).
  const needsActorName = addActorValue === NEW_ACTOR && model.actors.length > 0 && !newActorName.trim();
  const commitAdd = () => {
    const text = draft.trim();
    if (!text) { draftRef.current?.focus(); return; }
    if (needsActorName) {
      actorNameRef.current?.focus();
      announce("Name the new actor first");
      return;
    }
    // What the new step will follow in the column: the last step, or the
    // decision hanging off it.
    const lastStep = model.steps.at(-1);
    const previous: Step | Decision | undefined = lastStep
      ? model.decisions.find((d) => d.afterStepId === lastStep.id) ?? lastStep
      : undefined;
    // A new actor and its first step are one gesture: the editing hook groups
    // changes made in the same handler into a single undo step.
    let actorId = "";
    let who: string | undefined;
    if (addActorValue === NEW_ACTOR) {
      const name = newActorName.trim();
      const created = name ? onAddActor?.(name) : undefined;
      if (typeof created === "string") { actorId = created; who = name; }
    } else {
      actorId = addActorValue;
      who = model.actors.find((a) => a.id === actorId)?.text;
    }
    const id = onAddStep(text, undefined, actorId);
    // Refused (someone else is editing): keep what was typed for after
    // "Take over editing"; the refusal itself has already been announced.
    if (!id) return;
    // No automatic arrow is ever drawn out of a shape the person placed by
    // hand (see the arrow rule below). So after the starter flow, or a chain
    // they built from the palette, a step added here used to hang under the
    // last shape with nothing joining them. If that last shape is the END of
    // a chain -- something leads into it and nothing leads on from it --
    // continue the chain to the new step. A decision may already have one
    // branch drawn back to an earlier shape and still be the end. A shape
    // nobody connected, or one that only feeds INTO the flow (a Start added
    // last), is left alone. Same handler as the add: one undo step.
    if (
      typeof id === "string" && previous && onAddConnection
      && isUserCreatedId(previous.id) && previous.shape != null
      && !NON_FLOW_SHAPES.has(previous.shape)
    ) {
      const conns = model.connections ?? [];
      const isDecision = previous !== lastStep;
      // A decision's branches are arrows too, once they point at something
      // that is on the canvas -- both into other shapes and out of this one.
      const branchInto = (targetId: string) =>
        model.decisions.some((d) => decisionBranches(d).some((b) => b.targetId === targetId));
      const leadsIn = conns.some((c) => c.toId === previous.id) || branchInto(previous.id);
      const leadsOut = conns.filter((c) => c.fromId === previous.id).length
        + (isDecision ? decisionBranches(previous as Decision).filter((b) => geomById.has(b.targetId)).length : 0);
      if (leadsIn && (isDecision ? leadsOut < 2 : leadsOut === 0)) onAddConnection(previous.id, id);
    }
    announce(`Step added, ${who ? `assigned to ${who}` : "not assigned to anyone yet"}: ${text}`);
    closeAddBar();
    // A step added here goes to the end of the flow, which on any real
    // diagram is off-screen. Bring it into view and point at it.
    if (typeof id === "string") revealNew(id);
  };

  const manualConnections = model.connections ?? [];

  const handleDrop = (cx: number, cy: number, e: React.DragEvent) => {
    if (presenting) return;
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    if (!raw) return;
    let payload: { kind: string; shape?: string };
    try { payload = JSON.parse(raw); } catch { return; }
    // A drop lands where it was dropped. There used to be a nudge here for
    // drops "under the palette", but it compared content coordinates with the
    // palette's size on screen, so at any pan or zoom other than the old
    // default it moved shapes that were nowhere near it. It was never needed:
    // the palette sits above the canvas and does not accept drops, so nothing
    // can be dropped beneath it in the first place.
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
    // "" is a refused add (someone else is editing): nothing to place.
    if (newId) {
      const size = defaultSizeFor(payload.kind === "decision" ? "decision" : payload.kind === "exception" ? "exception" : "step", payload.shape);
      placeNew([{ id: newId, cx: sx, cy: sy, ...size }]);
      bringToFront(newId);
      flash(newId);
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
    // Refused (someone else is editing): the rest would be refused too.
    if (!a) return;
    const b = onAddStep("Review", "step");
    const c = onAddDecision?.("Approve?", "decision");
    placeNew([
      { id: a, cx: centerX, cy: y0, ...defaultSizeFor("step", "terminator") },
      ...(b ? [{ id: b, cx: centerX, cy: y0 + gap, ...defaultSizeFor("step", "step") }] : []),
      ...(c ? [{ id: c, cx: centerX, cy: y0 + gap * 2, ...defaultSizeFor("decision") }] : []),
    ]);
    if (b) onAddConnection?.(a, b);
    if (b && c) onAddConnection?.(b, c);
  };

  /** A connector's route (src/lib/canvas/connector.ts): out of one shape
   *  and into the other across the gap between them, elbowed halfway. */
  const routeOf = (fromId: string, toId: string) => {
    const a = rectsById.get(fromId), b = rectsById.get(toId);
    return a && b ? connectorRoute(a, b) : null;
  };
  // Drawing a connector from a dot on a shape's side, or moving one end of
  // the selected connector to another shape (canvas-connectors.tsx).
  const connect = useConnectorDrag({ shellApi, rects: rectsById, canEdit: canEdit ?? alwaysEditable });
  const startConnDrag = (fromId: string, e: React.PointerEvent, from: Point) => {
    if (!onAddConnection) return;
    connect.start(e, from, { exclude: fromId, done: (toId) => onAddConnection(fromId, toId) });
  };
  const startEndDrag = (c: Connection, end: "from" | "to", e: React.PointerEvent, fixed: Point) => {
    if (!onUpdateConnection) return;
    connect.start(e, fixed, {
      exclude: end === "from" ? c.toId : c.fromId,
      done: (id) => {
        if (id === (end === "from" ? c.fromId : c.toId)) return;
        onUpdateConnection(c.id, end === "from" ? { fromId: id } : { toId: id });
      },
    });
  };

  // The selection bar and the line bar sit right after their shape or
  // line in the page, so Tab goes shape, its bar, the next shape.
  const barAfter = (id: string) => presenting || sel.selection.ids[0] !== id ? null : (
    <SelectionBar
      ids={sel.selection.ids} rects={rectsById} actions={sel.actions}
      connect={onAddConnection ? {
        what: "line", targets: shapeList.filter((t) => t.id !== sel.selection.ids[0]),
        onPick: (to) => onAddConnection(sel.selection.ids[0], to),
      } : undefined}
    />
  );
  const lineBarAfter = (c: Connection) => {
    const r = presenting || !onUpdateConnection || sel.line !== c.id ? null : routeOf(c.fromId, c.toId);
    return r && onUpdateConnection ? (
      <LineBar
        lineId={c.id} at={r.mid} fromId={c.fromId} toId={c.toId} shapes={shapeList} what="line"
        onChange={(end, id) => onUpdateConnection(c.id, end === "from" ? { fromId: id } : { toId: id })}
        onDelete={onDeleteConnection ? () => onDeleteConnection(c.id) : undefined}
      />
    ) : null;
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
    <EditGuardCtx.Provider value={canEdit ?? alwaysEditable}>
    {/* The frame the selection keys answer for (canvas-selection.tsx). */}
    <div ref={sel.frameRef} className="h-full w-full">
    <CanvasShell
      contentWidth={Math.max(width, 900)}
      contentHeight={Math.max(height, 620)}
      minimap
      fullscreenLabel="Process map"
      viewId="process"
      apiRef={shellApi}
      shapes={shapeRects}
      onSelectBox={sel.onSelectBox}
      onBackgroundPress={sel.onBackgroundPress}
      // The palette is hidden while presenting, so nothing needs the room.
      leftInset={paletteOpen && !presenting ? PALETTE_INSET : 0}
      initialFocus={spine[0] ? {
        x: spine[0].cx - spine[0].w / 2, y: spine[0].cy - spine[0].h / 2, w: spine[0].w, h: spine[0].h,
      } : undefined}
      // The add form needs the row to itself on a narrow canvas; the legend
      // steps aside while it is open rather than fighting it for space. While
      // presenting the form is hidden, so the legend is back.
      bottomLeft={adding && !presenting ? undefined : <Legend />}
      onCanvasDrop={handleDrop}
      overlay={
        <>
          <ShapePalette
            open={paletteOpen}
            onToggle={togglePalette}
            showStarter={isEmpty}
            onInsertStarter={insertStarter}
          />
          {/* Gone as soon as there is anything to look at, and while the
           *  person is already using one of the ways it offers. While
           *  presenting those ways are hidden, so an empty diagram still
           *  says it is empty (its buttons hide themselves). */}
          {isEmpty && (presenting || (!paletteOpen && !adding)) && (
            <EmptyDiagramPrompt
              onStarter={insertStarter}
              onAddStep={openAddBar}
              onOpenShapes={() => setPaletteChoice(true)}
            />
          )}
        </>
      }
      bottomRight={
        <>
          <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
          {adding ? (
            // A set width so the form is predictable beside the minimap, capped
            // to the row on a narrow canvas where the actor select then wraps
            // under the text field instead of crushing it.
            <div
              className="flex w-[26rem] max-w-full flex-wrap items-center gap-1 rounded-md border bg-card p-1 shadow-sm"
              // Esc anywhere in the bar (its buttons included) closes it as
              // Cancel does. Marked handled so full screen stays on: the
              // artifact leaves full screen only on an Esc nobody took.
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeAddBar(); }
              }}
            >
              <Input
                ref={draftRef}
                autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // preventDefault: committing hands focus back to the "Add
                  // step" button, and the same keystroke's keypress would
                  // then land on that button and open this bar again.
                  if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
                  if (e.key === "Escape") { e.preventDefault(); closeAddBar(); }
                }}
                placeholder="New step description"
                aria-label="New step description"
                className="h-8 min-w-[8rem] flex-1 basis-40 text-sm"
              />
              {model.actors.length > 0 && (
                <select
                  value={addActorValue}
                  onChange={(e) => {
                    setAddActorId(e.target.value);
                    setFocusActorName(!pickedByKey.current);
                  }}
                  onPointerDown={() => { pickedByKey.current = false; }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitAdd(); return; }
                    if (e.key === "Escape") { e.preventDefault(); closeAddBar(); return; }
                    if (e.key !== "Tab" && e.key !== "Shift") pickedByKey.current = true;
                  }}
                  aria-label="Who does this step"
                  title="Who does this step"
                  className="h-8 min-w-0 max-w-[10rem] rounded-md border bg-background px-2 text-xs text-foreground"
                >
                  {model.actors.map((a) => (
                    <option key={a.id} value={a.id}>{a.text}</option>
                  ))}
                  {onAddActor && <option value={NEW_ACTOR}>New actor…</option>}
                </select>
              )}
              {addActorValue === NEW_ACTOR && (
                <Input
                  ref={actorNameRef}
                  // Chosen from the list with the pointer: the name is the
                  // next thing to type. On a diagram with no actors this
                  // field is there from the start, and the step description
                  // keeps the focus.
                  autoFocus={model.actors.length > 0 && focusActorName}
                  aria-required={model.actors.length > 0}
                  value={newActorName} onChange={(e) => setNewActorName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
                    if (e.key === "Escape") { e.preventDefault(); closeAddBar(); }
                  }}
                  placeholder={model.actors.length ? "New actor's name (required)" : "Who does it? (optional)"}
                  aria-label={model.actors.length ? "New actor's name (required)" : "Who does this step (optional)"}
                  className="h-8 min-w-[7rem] flex-1 basis-28 text-sm"
                />
              )}
              {/* aria-disabled, not disabled: a dead button explains nothing.
               *  This one stays clickable and sends the person to the field
               *  that still needs filling in. */}
              <Button size="icon" variant="ghost"
                className="h-8 w-8 aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
                onClick={commitAdd}
                aria-disabled={!draft.trim() || needsActorName}
                title={!draft.trim() ? "Describe the step first" : needsActorName ? "Name the new actor first" : "Add step"}
                aria-label="Add step">
                <Plus className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={closeAddBar}
                title="Cancel" aria-label="Cancel">
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {/* Only once the person has arranged the map by hand. */}
              {saved && onTidyUp && (
                <Button size="sm" variant="ghost" className="bg-card/95 backdrop-blur" onClick={tidyUp}
                  title="Put every shape back in the automatic layout (Undo brings your arrangement back)">
                  <Wand2 className="size-3.5" /> Tidy up
                </Button>
              )}
              <Button ref={addButtonRef} size="sm" variant="outline" className="bg-card/95 backdrop-blur" onClick={openAddBar}>
                <Plus className="size-3.5" /> Add step
              </Button>
            </div>
          )}
        </>
      }
    >
      <svg
        width={Math.max(width, 900)}
        height={Math.max(height, 620)}
        className="absolute inset-0"
        // Lines to shapes outside the sheet (dragged left, up or far out)
        // are drawn too, not cut at its edge.
        style={{ pointerEvents: "none", overflow: "visible" }}
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
          {/* Crow's-foot markers. refX at the outer edge so the glyph sits at the end. */}
          <marker id="crow-one" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="14" markerHeight="14" orient="auto-start-reverse">
            <path d="M6 1 V11" stroke="var(--color-verified)" strokeWidth="1.4" fill="none" />
          </marker>
          <marker id="crow-many" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="14" markerHeight="14" orient="auto-start-reverse">
            <path d="M11 1 L1 6 L11 11" stroke="var(--color-verified)" strokeWidth="1.4" fill="none" />
          </marker>
          <marker id="crow-one-many" viewBox="0 0 14 12" refX="13" refY="6" markerWidth="16" markerHeight="14" orient="auto-start-reverse">
            <path d="M8 1 V11 M13 1 L3 6 L13 11" stroke="var(--color-verified)" strokeWidth="1.4" fill="none" />
          </marker>
          <marker id="crow-zero-one" viewBox="0 0 14 12" refX="13" refY="6" markerWidth="16" markerHeight="14" orient="auto-start-reverse">
            <path d="M8 1 V11" stroke="var(--color-verified)" strokeWidth="1.4" fill="none" />
            <circle cx="4" cy="6" r="2.2" stroke="var(--color-verified)" strokeWidth="1.2" fill="var(--color-background)" />
          </marker>
          <marker id="crow-zero-many" viewBox="0 0 16 12" refX="15" refY="6" markerWidth="18" markerHeight="14" orient="auto-start-reverse">
            <path d="M15 1 L5 6 L15 11" stroke="var(--color-verified)" strokeWidth="1.4" fill="none" />
            <circle cx="2" cy="6" r="2.2" stroke="var(--color-verified)" strokeWidth="1.2" fill="var(--color-background)" />
          </marker>
        </defs>


        {spine.slice(0, -1).map((n, i) => {
          const next = spine[i + 1];
          // An arrow joins two steps of the flow, wherever they have been
          // moved to: it used to vanish as soon as either end was dragged. This used to be skipped for
          // anything flagged userAdded, to keep palette-dropped boxes loose --
          // but that flag is also set by adding a step from the bar and by
          // simply rewording an extracted one, so a new step appeared
          // disconnected and an edited step lost both its arrows.
          // What must never be threaded is (a) a box that is not a step, and
          // (b) a shape the person placed by hand. (b) is read from the item,
          // not from where it sits: a palette drawing stays out of the flow
          // wherever it is.
          // A shape placed by hand is one the person created (see
          // item-origin) WITH an explicit shape: only the palette and the
          // starter flow pass one; the add bar and the lane "+" never do.
          const inFlow = (s: SpineNode) => s.kind === "decision" || !NON_FLOW_SHAPES.has((s.ref as Step).shape ?? "step");
          const placedByHand = (s: SpineNode) => isUserCreatedId(s.ref.id) && (s.ref as Step | Decision).shape != null;
          if (!inFlow(n) || !inFlow(next) || placedByHand(n) || placedByHand(next)) return null;
          const primaryBranch = n.kind === "decision"
            ? decisionBranches(n.ref as Decision).find((b) => b.targetId === next.ref.id)
            : undefined;
          const yesLabel = primaryBranch ? `${primaryBranch.label} → ${primaryBranch.targetId}` : null;
          // Down the page when the next shape is below (the usual case);
          // otherwise side to side, from the faces that look at each other.
          const below = next.cy - next.h / 2 > n.cy + n.h / 2 + 8;
          let from: Point, to: Point, path: string, midY: number;
          if (below) {
            const fromInset = n.kind === "step" ? bottomInsetFor((n.ref as Step).shape) : 0;
            from = { x: n.cx, y: n.cy + n.h / 2 * (1 - fromInset) };
            to = { x: next.cx, y: next.cy - next.h / 2 };
            midY = (from.y + to.y) / 2;
            path = Math.abs(from.x - to.x) < 4
              ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
              : connectorPath([from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]);
          } else {
            from = edgePoint(n, next);
            to = edgePoint(next, n);
            midY = (from.y + to.y) / 2;
            const midX = (from.x + to.x) / 2;
            path = from.y === n.cy
              ? connectorPath([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to])
              : connectorPath([from, { x: from.x, y: midY }, { x: to.x, y: midY }, to]);
          }
          return (
            <g key={`spine-${i}`}>
              <path
                d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75}
                strokeLinecap="round" markerEnd="url(#arrow)"
              />
              {yesLabel && (
                <text x={from.x + 10} y={midY + 4} fill="var(--color-confident-ink)" fontSize="11" fontFamily="var(--font-mono)">
                  {yesLabel}
                </text>
              )}
            </g>
          );
        })}

        {routes.map((r) => {
          const isException = r.kind === "exception";
          const stroke = isException ? "var(--color-unresolved)" : "var(--color-drift)";
          // The label is text, so it takes the darker ink of the same colour.
          const labelFill = isException ? "var(--color-unresolved-ink)" : "var(--color-drift-ink)";
          const dash = isException ? "4 3" : undefined;
          const marker = isException ? "url(#arrow-dashed)" : "url(#arrow)";
          // Out to a lane and into the target from the side it is entered
          // on. A line into a right-hand side runs beyond both ends; one into
          // a left-hand side sits between them, unless shapes moved by hand
          // put the target left of the start -- then it comes round into the
          // target's right-hand side instead of through it. (In the automatic
          // layout this is always the lane as laid out.)
          const intoLeft = r.enter === "left" && r.to.x - r.from.x >= 48;
          const end = r.enter === "left" && !intoLeft ? r.toRight ?? r.to : r.to;
          const laneX = intoLeft
            ? Math.min(Math.max(r.laneX, r.from.x + 24), end.x - 24)
            : Math.max(r.laneX, r.from.x + 24, end.x + 24);
          const path = connectorPath([r.from, { x: laneX, y: r.from.y }, { x: laneX, y: end.y }, end]);
          const labelY = (r.from.y + r.to.y) / 2;
          return (
            <g key={r.id}>
              <path
                d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round"
                strokeDasharray={dash} markerEnd={marker}
              />
              {r.label && (
                <text x={laneX + 6} y={labelY} fill={labelFill} fontSize="10" fontFamily="var(--font-mono)">
                  {r.label}
                </text>
              )}
            </g>
          );
        })}

        {manualConnections.map((c) => {
          const r = routeOf(c.fromId, c.toId);
          if (!r) return null;
          const d = connectorPath(r.points);
          const startMk = markerUrlFor(c.startMarker);
          const endMk = markerUrlFor(c.endMarker) ?? "url(#arrow-verified)";
          const selected = sel.line === c.id;
          return (
            <g key={c.id}>
              {/* A wide, invisible stroke to click: selects the connector;
               *  a double-click types its label. */}
              {!presenting && (
                <path
                  d={d} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke"
                  data-no-pan data-edit-control className="cursor-pointer"
                  onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); sel.selectLine(c.id); }}
                  onDoubleClick={() => sel.editLineLabel(c.id)}
                />
              )}
              {selected && (
                <path
                  d={d} fill="none" stroke="var(--color-primary)" strokeOpacity={0.6} strokeWidth={7}
                  strokeLinecap="round" pointerEvents="none" data-edit-control
                />
              )}
              <path
                d={d}
                fill="none"
                stroke="var(--color-verified)"
                strokeWidth={1.9}
                strokeLinecap="round"
                markerStart={startMk ?? undefined}
                markerEnd={endMk}
              />
            </g>
          );
        })}
      </svg>

      {items.map((it) => (
        <Fragment key={it.node.ref.id}>
        {(() => {
        if (it.kind === "step") {
          const n = it.node;
          const s = n.ref as Step;
          // A height set by hand, live or saved, is the least it takes.
          const setH = overrides[s.id]?.h ?? saved?.[s.id]?.h;
          return (
            <StepNode
              key={s.id} node={n} step={s} model={model}
              actors={model.actors} systems={model.systems}
              setH={setH}
              onMeasure={(w, h) => reportMeasure(s.id, w, h)}
              onDelete={() => onDeleteAny(s.id)}
              onUpdate={(patch) => onUpdateItem(s.id, patch as Record<string, unknown>)}
              onDrag={(delta, done) => gripDrag(s.id, delta, done)}
              onResize={(w, h, done) => place(s.id, { w: snap(w), ...(h !== undefined ? { h: snap(h) } : {}) }, done)}
              onRefine={handleRefine}
              onStartConnect={onAddConnection ? (e, from) => startConnDrag(s.id, e, from) : undefined}
              onSelect={(ev) => { selectNode(s.id); if (ev) sel.pressShape(s.id, ev); }}
              onBringToFront={() => bringToFront(s.id)}
              onSendToBack={() => sendToBack(s.id)}
              onOpenUseCase={onOpenUseCase ? () => onOpenUseCase(s.id) : undefined}
              z={n.z}
            />
          );
        }
        if (it.kind === "decision") {
          const n = it.node;
          const d = n.ref as Decision;
          // A height set by hand, live or saved, is the least it takes.
          const setH = overrides[d.id]?.h ?? saved?.[d.id]?.h;
          return (
            <DecisionNode
              key={d.id} node={n} d={d} model={model}
              setH={setH}
              onMeasure={(w, h) => reportMeasure(d.id, w, h)}
              onDelete={() => onDeleteAny(d.id)}
              onUpdate={(patch) => onUpdateItem(d.id, patch as Record<string, unknown>)}
              onDrag={(delta, done) => gripDrag(d.id, delta, done)}
              onResize={(w, h, done) => place(d.id, { w: snap(w), ...(h !== undefined ? { h: snap(h) } : {}) }, done)}
              onRefine={handleRefine}
              onStartConnect={onAddConnection ? (e, from) => startConnDrag(d.id, e, from) : undefined}
              onSelect={(ev) => { selectNode(d.id); if (ev) sel.pressShape(d.id, ev); }}
              onBringToFront={() => bringToFront(d.id)}
              onSendToBack={() => sendToBack(d.id)}
              z={n.z}
            />
          );
        }
        const n = it.node;
        const e = n.ref;
        // A height set by hand, live or saved, is the least it takes.
        const setH = overrides[e.id]?.h ?? saved?.[e.id]?.h;
        return (
          <ExceptionNode
            key={e.id} node={n} e={e} model={model}
            setH={setH}
            onMeasure={(w, h) => reportMeasure(e.id, w, h)}
            onDelete={() => onDeleteAny(e.id)}
            onUpdate={(patch) => onUpdateItem(e.id, patch as Record<string, unknown>)}
            onDrag={(delta, done) => gripDrag(e.id, delta, done)}
            onResize={(w, h, done) => place(e.id, { w: snap(w), ...(h !== undefined ? { h: snap(h) } : {}) }, done)}
            onRefine={handleRefine}
            onStartConnect={onAddConnection ? (ev, from) => startConnDrag(e.id, ev, from) : undefined}
            onSelect={(ev) => { selectNode(e.id); if (ev) sel.pressShape(e.id, ev); }}
            onBringToFront={() => bringToFront(e.id)}
            onSendToBack={() => sendToBack(e.id)}
            z={n.z}
          />
        );
        })()}
        {barAfter(it.node.ref.id)}
        </Fragment>
      ))}

      {!presenting && <SelectionOutlines ids={sel.selection.ids} rects={rectsById} />}
      {!presenting && <SnapGuides guides={sel.guides} />}
      {!presenting && <ConnectorPreview live={connect.live} rects={rectsById} color="var(--color-verified)" />}

      <FlashRing key={flashId ?? "idle"} rect={flashGeom ? {
        x: flashGeom.cx - flashGeom.w / 2, y: flashGeom.cy - flashGeom.h / 2, w: flashGeom.w, h: flashGeom.h,
      } : null} />

      {manualConnections.map((c) => {
        const m = routeOf(c.fromId, c.toId)?.mid;
        if (!m) return null;
        // The label is typed on the line; the ends and Delete are under "...".
        return (
          <Fragment key={`ctl-${c.id}`}>
          <LineLabel
            x={m.x} y={m.y} lineId={c.id} onSelect={() => sel.selectLine(c.id)} name={lineName(c.id)}
            value={c.label ?? ""} placeholder="Add label" tone="verified" quiet
            fieldLabel="Connector label"
            onChange={onUpdateConnection ? (label) => onUpdateConnection(c.id, { label }) : undefined}
          >
            <ConnectorControl
              conn={c}
              onDelete={() => onDeleteConnection?.(c.id)}
              onUpdate={onUpdateConnection ? (patch) => onUpdateConnection(c.id, patch) : undefined}
            />
          </LineLabel>
          {lineBarAfter(c)}
          </Fragment>
        );
      })}
      {!presenting && onUpdateConnection && (() => {
        const c = manualConnections.find((x) => x.id === sel.line);
        const r = c && routeOf(c.fromId, c.toId);
        if (!c || !r) return null;
        const p0 = r.points[0], p1 = r.points[r.points.length - 1];
        return <ConnectorEnds from={p0} to={p1} onStart={(e, end) => startEndDrag(c, end, e, end === "from" ? p1 : p0)} />;
      })()}
    </CanvasShell>
    {sel.liveRegion}
    {sel.pasteDialog}
    </div>
    </EditGuardCtx.Provider>
  );
}

/** Map a CrowMarker enum to the SVG marker URL used in the path. */
function markerUrlFor(m?: CrowMarker): string | null {
  switch (m) {
    case "one": return "url(#crow-one)";
    case "many": return "url(#crow-many)";
    case "one-many": return "url(#crow-one-many)";
    case "zero-one": return "url(#crow-zero-one)";
    case "zero-many": return "url(#crow-zero-many)";
    default: return null;
  }
}

const CROW_OPTIONS: { id: CrowMarker; label: string; glyph: string }[] = [
  { id: "none", label: "None / arrow", glyph: "→" },
  { id: "one", label: "One", glyph: "|" },
  { id: "many", label: "Many", glyph: "⋉" },
  { id: "one-many", label: "One-to-many", glyph: "|⋉" },
  { id: "zero-one", label: "Zero or one", glyph: "○|" },
  { id: "zero-many", label: "Zero or many", glyph: "○⋉" },
];

function ConnectorControl({
  conn, onDelete, onUpdate,
}: {
  conn: Connection;
  onDelete: () => void;
  onUpdate?: (patch: Partial<Connection>) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  // Hidden while presenting; close the settings then so they do not come
  // back open afterwards.
  const presenting = !!useArtifactFullscreen()?.presenting;
  useEffect(() => {
    if (presenting) setOpen(false);
  }, [presenting]);
  return (
    <div
      data-no-pan
      data-edit-control
      className="relative"
      // Esc in the open settings (label field and buttons included) closes
      // them, focus back on the button that opened them, and is marked
      // handled so full screen stays on.
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open || e.defaultPrevented) return;
        e.preventDefault();
        setOpen(false);
        toggleRef.current?.focus({ preventScroll: true });
      }}
    >
      <button
        ref={toggleRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Line ends and delete"
        aria-label={`Line options${conn.label ? ` for ${conn.label}` : ""}`}
        aria-expanded={open}
        className="h-5 w-5 rounded-full border border-primary/60 bg-card text-primary opacity-70 hover:opacity-100 focus-visible:opacity-100 hover:bg-primary hover:text-primary-foreground transition flex items-center justify-center"
      >
        <MoreHorizontal className="size-3" />
      </button>
      {open && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 w-[220px] rounded-lg border bg-card shadow-lg p-2 flex flex-col gap-2">
          {onUpdate && (
            <>
              <div>
                <div className="eyebrow text-muted-foreground mb-1">Start</div>
                <div className="flex flex-wrap gap-1">
                  {CROW_OPTIONS.map((o) => (
                    <button
                      key={`s-${o.id}`}
                      onClick={() => onUpdate({ startMarker: o.id === "none" ? undefined : o.id })}
                      aria-label={`Start: ${o.label}`}
                      aria-pressed={(conn.startMarker ?? "none") === o.id}
                      className={cn(
                        "px-1.5 py-0.5 rounded border text-[10px] font-mono-tight",
                        (conn.startMarker ?? "none") === o.id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                      title={o.label}
                    >{o.glyph}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow text-muted-foreground mb-1">End</div>
                <div className="flex flex-wrap gap-1">
                  {CROW_OPTIONS.map((o) => (
                    <button
                      key={`e-${o.id}`}
                      onClick={() => onUpdate({ endMarker: o.id === "none" ? undefined : o.id })}
                      aria-label={`End: ${o.label}`}
                      aria-pressed={(conn.endMarker ?? "none") === o.id}
                      className={cn(
                        "px-1.5 py-0.5 rounded border text-[10px] font-mono-tight",
                        (conn.endMarker ?? "none") === o.id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                      title={o.label}
                    >{o.glyph}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-[11px] px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1"
          >
            <X className="size-3" /> Delete connector
          </button>
        </div>
      )}
    </div>
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
    <div className="absolute top-3 left-3 z-30 flex items-start gap-2" data-no-pan data-edit-control>
      <Button
        size="sm" variant="outline"
        className={cn("h-8 bg-card/95 backdrop-blur gap-1.5", open ? "w-8 px-0" : "px-2.5")}
        onClick={onToggle}
        title={open ? "Hide shape palette" : "Show shape palette"}
        // One name in both states, starting with the word on the button, so
        // "click Shapes" works by voice; aria-expanded carries open/closed.
        aria-label="Shapes palette"
        aria-expanded={open}
      >
        {open ? <PanelRightClose className="size-4" /> : <><PanelRightOpen className="size-4" /><span className="text-xs">Shapes</span></>}
      </Button>
      {open && (
        <div className="rounded-xl border bg-card/95 backdrop-blur shadow-lg w-[240px] overflow-hidden">
          <div className="flex border-b bg-muted/40">
            {PALETTE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  // px-1.5, not px-2: at px-2 the four names in 12px Inter
                  // leave under a pixel spare in the 238px row. The focus
                  // ring is drawn inside the tab, whose outer edges the
                  // palette clips.
                  "flex-1 px-1.5 py-2 text-xs font-medium transition focus-visible:outline-offset-[-2px]",
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
            <div className="eyebrow text-muted-foreground px-1 pb-1.5">
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
                <div className="eyebrow text-muted-foreground px-1 pb-1.5">
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
              Drag a shape to move it, or its corner to resize. Drag a dot on its side to draw a line. Shapes line up with each other as you drag.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What a blank diagram shows instead of an open shape menu: the three ways
 *  to begin, in the middle of the canvas where the eye already is. The
 *  wrapper ignores the pointer so the canvas around the card still pans. */
function EmptyDiagramPrompt({
  onStarter, onAddStep, onOpenShapes,
}: {
  onStarter: () => void; onAddStep: () => void; onOpenShapes: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <div
        className="pointer-events-auto w-full max-w-sm rounded-xl border bg-card/95 p-4 text-center shadow-sm backdrop-blur"
        data-no-pan
      >
        <div className="text-sm font-semibold">Nothing on this diagram yet</div>
        {/* How to begin, and the ways in: editing, so hidden while
         *  presenting, which leaves only the line above. */}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground" data-edit-control>
          Begin with a ready-made flow, add steps one at a time, or drag shapes in.
        </p>
        {/* Three equal ways in, all ordinary: the project page's one solid
         *  button is Re-check (DESIGN.md 6.1). */}
        <div className="mt-3 flex flex-col items-stretch gap-1.5" data-edit-control>
          <Button size="sm" variant="outline" className="h-8 justify-center gap-1.5" onClick={onStarter}>
            <Wand2 className="size-3.5" />
            <span className="text-xs">Start with Request → Review → Decision</span>
          </Button>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={onAddStep}>
              <Plus className="size-3.5" /> <span className="text-xs">Add a step</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={onOpenShapes}>
              <PanelRightOpen className="size-3.5" /> <span className="text-xs">Show shapes</span>
            </Button>
          </div>
        </div>
      </div>
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
      className="flex flex-col items-start gap-1 rounded-md border bg-background/80 px-2 py-2 cursor-grab active:cursor-grabbing hover:border-primary/60 hover:bg-primary/5 active:bg-primary/10 transition"
      title={`Drag ${label.toLowerCase()} onto the canvas`}
    >
      <div className="flex items-center gap-1.5 w-full">
        <ShapeGlyph kind={kind} shape={shape} />
        <div className="text-[11px] font-medium leading-tight truncate">{label}</div>
      </div>
      <div className="text-[9px] font-mono-tight text-muted-foreground leading-tight pl-6 truncate w-full">{hint}</div>
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
    case "uml-class":
    case "uml-interface":
      return <Boxes className="size-4 text-primary shrink-0" />;
    case "uml-lifeline":
      return <GitBranch className="size-4 text-primary shrink-0" />;
    case "er-entity":
      return <Table2 className="size-4 text-primary shrink-0" />;
    default:
      return <Square className="size-4 text-primary shrink-0" />;
  }
}


function Legend() {
  const chip = "flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-[10px] font-mono-tight text-muted-foreground";
  return (
    <>
      <span className={chip}><span className="h-2 w-3 border-2 border-primary rounded-[2px]" /> Step</span>
      <span className={chip}><span className="h-2 w-2 rotate-45 border-2 border-primary" /> Decision</span>
      {/* The grade words from lib/grade, matching the chip on each node. One
       *  red entry: a changed source and disagreeing sources draw the same
       *  outline, and the node's chip says which it is. */}
      <span className={chip}><span className="h-2 w-3 border border-dashed border-unresolved rounded-[2px]" /> Unclear</span>
      <span className={chip}><span className="h-2 w-3 border border-drift rounded-[2px] bg-drift/20" /> Source changed or sources disagree</span>
      {/* How-to, not legend: shown only where the bar has the room for it
       *  (the bottom bar is a container-query container). The same words
       *  live in the shape palette for narrower canvases. Editing help, so
       *  hidden while presenting. */}
      <span className={cn(chip, "hidden @min-[900px]:flex")} data-edit-control><GripVertical className="size-3" /> Click to select · drag to move · double-click to type · drag a side dot to draw a line</span>
    </>
  );
}

// ---- Node primitives ----

/** May this tab move shapes? Asked when a drag starts, so a viewer is told
 *  who is editing before anything moves, rather than seeing it snap back. */
const alwaysEditable = () => true;
const EditGuardCtx = createContext<() => boolean>(alwaysEditable);

/** Drags a node by its grip. `onDrag` gets the distance from the press, in
 *  the diagram (see useWorldDrag), and is called once more with `done` when
 *  the pointer lets go or the drag is cut short (a pinch). */
/** A drag's distance; `free` while Ctrl/Cmd is held (no snapping). */
type DragDelta = { dx: number; dy: number; free?: boolean };

function useNodeDrag(onDrag: (d: DragDelta, done?: boolean) => void, onSelect?: () => void) {
  const worldDrag = useWorldDrag();
  const mayEdit = useContext(EditGuardCtx);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (!mayEdit()) return;
      onSelect?.();
      // A press that never moved is a click, not a move: nothing to save.
      let last: DragDelta | null = null;
      const finish = () => { if (last) onDrag(last, true); };
      worldDrag(e, (dx, dy, ev) => { last = { dx, dy, free: ev.metaKey || ev.ctrlKey }; onDrag(last); }, { up: finish, cancel: finish });
    },
  };
}

function useMeasure(onMeasure: (w: number, h: number) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Keep the latest callback in a ref so identity churn on the parent doesn't
  // re-subscribe the ResizeObserver (which used to fire a synchronous measure
  // on every render and could interact with layout to feed a setState loop —
  // that's the class of bug that bricked class-shape nodes on first drop).
  const cbRef = useRef(onMeasure);
  useLayoutEffect(() => { cbRef.current = onMeasure; });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastW = -1, lastH = -1;
    let rafId = 0;
    const report = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // A hidden element (a project pane that is not the open one sits in a
      // display:none wrapper) measures 0 by 0. That is not a size, and the
      // layout treats a recorded 0 as real: it would draw the node zero wide.
      // Say nothing; the observer reports the true size once it is shown.
      if (w === 0 || h === 0) return;
      // Skip when the box is stable (integer pixel equality). This is a
      // second-line guard on top of the parent's setState guard so a
      // ResizeObserver + layout feedback loop can't run away.
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      cbRef.current(w, h);
    };
    // Defer the initial measure to the next frame so mount-time layout has
    // fully settled before we push a height back into state.
    rafId = requestAnimationFrame(report);
    const ro = new ResizeObserver(() => {
      // Batch to rAF: breaks the sync observer→setState→layout→observer chain.
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(report);
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, []);
  return ref;
}

/** Drags a shape's size. The height is only set by a drag that moved up or
 *  down (`h` is undefined otherwise): widening a shape must not freeze the
 *  height its text gave it as its least. */
function ResizeHandle({ w, h, onResize }: { w: number; h: number; onResize: (w: number, h: number | undefined, done?: boolean) => void }) {
  const worldDrag = useWorldDrag();
  const mayEdit = useContext(EditGuardCtx);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!mayEdit()) return;
    const startW = w, startH = h;
    // A press that never moved is a click, not a resize: nothing to save.
    let last: { w: number; h: number | undefined } | null = null;
    let movedY = false;
    const finish = () => { if (last) onResize(last.w, last.h, true); };
    worldDrag(e, (dx, dy) => {
      if (Math.abs(dy) >= 1) movedY = true;
      last = {
        w: Math.min(MAX_W, Math.max(MIN_W, startW + dx)),
        h: movedY ? Math.min(MAX_H, Math.max(MIN_H, startH + dy)) : undefined,
      };
      onResize(last.w, last.h);
    }, { up: finish, cancel: finish });
  };
  return (
    <div
      onPointerDown={onPointerDown}
      data-no-pan
      data-edit-control
      className="counter-zoom absolute bottom-0 right-0 w-3 h-3 origin-bottom-right rounded-[3px] border border-primary/60 bg-card cursor-nwse-resize opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-opacity z-10 before:absolute before:-inset-1.5 before:content-['']"
      title="Resize"
    />
  );
}

function DragHandle({ handlers }: { handlers: ReturnType<typeof useNodeDrag> }) {
  return (
    <button
      {...handlers}
      data-no-pan
      data-edit-control
      className="cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-foreground shrink-0"
      title="Drag to move"
      // The keyboard moves a shape with the arrows once its text has focus
      // (selection keys), so the grip is a pointer handle only.
      tabIndex={-1}
      aria-hidden
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

/** A node's box in canvas units (where its connectors start). */
function rectOfNode(node: { cx: number; cy: number; w: number; h: number }) {
  return { x: node.cx - node.w / 2, y: node.cy - node.h / 2, w: node.w, h: node.h };
}

// -------- Node outline, from the item's grade --------

/** What a node's outline says. It is read from the same grade as the word on
 *  the node's chip (lib/grade), so the two never disagree: dashed amber is
 *  Unclear, red is Source changed or Sources disagree, teal is something a
 *  person added, refined or edited. Anything else gets the plain outline of
 *  its type. Exceptions are told apart by their "Exception" label, not by an
 *  amber outline, which would read as Unclear. */
type NodeFrame = "plain" | "unclear" | "drift" | "provenance";

function frameOf(item: BaseItem): NodeFrame {
  const g = gradeOf(item);
  if (g.grade === "changed" || g.grade === "disagree") return "drift";
  if (g.provenance) return "provenance";
  return g.grade === "unclear" ? "unclear" : "plain";
}

// -------- Shape frame (SVG background for step variants) --------

function ShapeFrame({
  shape, frame, children, insetClass,
}: {
  shape?: string; frame: NodeFrame;
  children: ReactNode;
  insetClass?: string;
}) {
  const strokeColor = frame === "drift" ? "var(--color-drift)"
    : frame === "provenance" ? "var(--color-verified)"
    : frame === "unclear" ? "var(--color-unresolved)"
    : "var(--color-primary)";
  const strokeOpacity = frame === "plain" ? 0.6 : frame === "unclear" ? 0.9 : 1;
  const strokeDash = frame === "unclear" ? "5 3" : undefined;
  const strokeW = 2;
  const fill = frame === "drift" ? "color-mix(in oklab, var(--color-drift) 6%, var(--color-card))"
    : frame === "unclear" ? "color-mix(in oklab, var(--color-unresolved) 6%, var(--color-card))"
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
  node, step, actors, systems, model, setH, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, onOpenUseCase, z,
}: {
  node: SpineNode; step: Step; model: ProcessModel;
  actors: { id: string; text: string }[]; systems: { id: string; text: string }[];
  /** The height set by hand, if any: the least the shape takes. */
  setH?: number;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Step>) => void;
  onDrag: (d: DragDelta, done?: boolean) => void;
  onResize: (w: number, h: number | undefined, done?: boolean) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (e: React.PointerEvent, from: Point) => void;
  /** A press on the body (with the event) or the grip (without). */
  onSelect: (e?: React.PointerEvent) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onOpenUseCase?: () => void;
  z: number;
}) {
  const drag = useNodeDrag(onDrag, onSelect);
  const ref = useMeasure(onMeasure);

  const shape = step.shape ?? "step";
  const isShaped = shape !== "step";
  const isSectioned = shape === "uml-class" || shape === "uml-interface" || shape === "er-entity";
  const isLifeline = shape === "uml-lifeline";
  const frame = frameOf(step);

  // Sectioned box rendering (class / interface / entity): a bordered card with
  // stacked sections that auto-size to their content.
  if (isSectioned) {
    return (
      <SectionedNode
        node={node}
        step={step}
        model={model}
        setH={setH}
        onMeasure={onMeasure}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onDrag={onDrag}
        onResize={onResize}
        onRefine={onRefine}
        onStartConnect={onStartConnect}
        onSelect={onSelect}
        onBringToFront={onBringToFront}
        onSendToBack={onSendToBack}
        z={z}
        variant={shape}
        refEl={ref}
        dragHandlers={drag}
      />
    );
  }

  // Sequence lifeline — simplified stub: header box + dashed vertical line.
  // Editable label; not fully wired to sequence-diagram messaging semantics.
  if (isLifeline) {
    return (
      <div
        ref={ref}
        data-node
        data-node-id={step.id}
        onPointerDown={(e) => onSelect(e)}
        className="group absolute animate-item-in flex flex-col items-center"
        style={{
          left: node.cx - node.w / 2,
          top: node.cy - node.h / 2,
          width: node.w,
          minHeight: Math.max(200, setH ?? 0),
          zIndex: LAYER.shape + z,
        }}
      >
        <div className={cn(
          "relative rounded-md border-2 bg-card shadow-sm px-3 py-2 w-full flex items-center gap-1",
          frame === "drift" && "border-drift bg-drift/5",
          frame === "unclear" && "border-dashed border-unresolved bg-unresolved/5",
          frame === "provenance" && "!border-verified",
          frame === "plain" && "border-primary/50",
        )}>
          <DragHandle handlers={drag} />
          <IdChip id={step.id} tone="primary" />
          <div className="text-xs font-medium flex-1 text-center break-words">
            <InlineEdit value={step.text} onChange={(v) => onUpdate({ text: v })} activate="double" label="Step" />
          </div>
          <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete step “${step.text}”`}
            className="relative before:absolute before:-inset-1 before:content-[''] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
        <div className="flex-1 w-px border-l-2 border-dashed border-primary/50" style={{ minHeight: 120 }} />
        <div className="text-[9px] font-mono-tight text-muted-foreground pt-1">Lifeline</div>
        {onStartConnect && <ConnectHandles rect={rectOfNode(node)} tone="verified" onStart={onStartConnect} />}
        <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
      </div>
    );
  }

  // Padding tuned per shape so content sits inside the visible outline.
  const padClass =
    shape === "event" ? "px-6 py-6 items-center justify-center text-center"
    : shape === "io" ? "py-2"
    : shape === "offpage" ? "pl-3 py-2"
    : shape === "subroutine" ? "px-6 py-2"
    : shape === "document" ? "px-3 pt-2 pb-4"
    : shape === "swimlane" ? "px-3 pt-8 pb-3"
    : shape === "terminator" ? "px-6 py-2 items-center justify-center text-center"
    : "px-3 py-2";

  // io and offpage need percentage padding (not fixed px) because their
  // slanted edges are a fixed fraction of WIDTH, and width is user-resizable
  // -- a fixed px inset that looked safe at the default size would fall
  // short once the node is widened. io's parallelogram top-left corner (the
  // header row's home) is inset 15% of width; offpage's pentagon point cuts
  // the right side back by the same 15% at top and bottom.
  //
  // That percentage MUST live on the inner (normally-positioned) shape
  // wrapper below, not on the outer node div above -- CSS resolves
  // percentage padding against the containing block, and for an
  // absolutely-positioned element (the outer node div, which has explicit
  // left/top/width in its style) that's the whole canvas content layer, not
  // the node's own width. Putting it there ballooned io/offpage to 3-4x
  // their size (15% of a ~3000px canvas instead of 15% of a 260px node).
  // The inner wrapper is normal-flow, so its containing block is correctly
  // the outer node div's own (explicit) width.
  const innerPadClass =
    shape === "io" ? "px-[15%]"
    : shape === "offpage" ? "pr-[15%]"
    : "";

  // Softer, Miro-style card: a thinner border (color still carries meaning)
  // with a real drop shadow doing the visual-weight work instead. The shadow
  // stays put on hover: a node is content, and nothing on the page lifts.
  // No "relative" here -- the outer node div is already "absolute" (its own
  // valid positioning context for the resize/connect handles below), and
  // Tailwind's stylesheet order happens to let a "relative" utility on the
  // SAME element win over "absolute", silently dropping every plain step
  // back into normal document flow. That's what was stacking steps by
  // cumulative sibling height instead of their computed cy, drifting them
  // into the decision diamonds below.
  const baseClass = isShaped
    ? "bg-transparent"
    : cn(
        "rounded-xl border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)]",
        frame === "drift" && "border-drift bg-drift/5",
        step.drift && "animate-drift",
        frame === "unclear" && "border-dashed border-unresolved bg-unresolved/5",
        frame === "plain" && "border-primary/40",
        frame === "provenance" && "user-added !border-verified",
      );

  const contentInner = (
    <>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <DragHandle handlers={drag} />
          <IdChip id={step.id} tone="primary" />
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={step} compact />
          <RefineControl node={{ id: step.id, kind: "step", text: step.text }} model={model} onApply={onRefine} />
          {onOpenUseCase && (
            <button onClick={onOpenUseCase} data-no-pan title="View use case description" aria-label={`Use case for “${step.text}”`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-primary transition">
              <BookOpen className="size-3" />
            </button>
          )}
          <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete step “${step.text}”`}
            className="relative before:absolute before:-inset-1 before:content-[''] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="text-xs leading-snug font-medium break-words">
        <InlineEdit value={step.text} onChange={(v) => onUpdate({ text: v })} multiline activate="double" label="Step" />
      </div>
      {shape !== "swimlane" && shape !== "event" && (
        <div className="flex flex-wrap gap-1 text-[10px] font-mono-tight text-muted-foreground mt-auto">
          <MetaSelect
            label={`Actor for ${step.id}`}
            value={step.actorId} options={actors} onChange={(v) => onUpdate({ actorId: v })}
          />
          <span>·</span>
          <MetaSelect
            label={`System for ${step.id}`}
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
      onPointerDown={(e) => onSelect(e)}
      className={cn("group absolute animate-item-in flex flex-col gap-1", baseClass, padClass)}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: Math.max(minH, setH ?? 0),
        zIndex: LAYER.shape + z,
      }}
    >
      {isShaped ? (
        <ShapeFrame shape={shape} frame={frame}>
          <div className={cn("relative flex flex-1 flex-col gap-1 w-full min-h-0", innerPadClass)}>{contentInner}</div>
        </ShapeFrame>
      ) : (
        contentInner
      )}
      {onStartConnect && <ConnectHandles rect={rectOfNode(node)} tone="verified" onStart={onStartConnect} />}
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

function SectionedNode({
  node, step, model, setH, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, z, variant, refEl, dragHandlers,
}: {
  node: SpineNode; step: Step; model: ProcessModel;
  /** The height set by hand, if any: the least the shape takes. */
  setH?: number;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Step>) => void;
  onDrag: (d: DragDelta, done?: boolean) => void;
  onResize: (w: number, h: number | undefined, done?: boolean) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (e: React.PointerEvent, from: Point) => void;
  /** A press on the body (with the event) or the grip (without). */
  onSelect: (e?: React.PointerEvent) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  z: number;
  variant: "uml-class" | "uml-interface" | "er-entity";
  refEl: React.RefObject<HTMLDivElement | null>;
  dragHandlers: ReturnType<typeof useNodeDrag>;
}) {
  void onMeasure; // measured via useMeasure hook attached in parent
  const sections = step.sections ?? {};
  const attrs = sections.attributes ?? [];
  const methods = sections.methods ?? [];
  const stereotype = variant === "uml-interface" ? (sections.stereotype ?? "«interface»") : sections.stereotype;

  const updateList = (key: "attributes" | "methods", i: number, v: string) => {
    const list = [...(sections[key] ?? [])];
    list[i] = v;
    onUpdate({ sections: { ...sections, [key]: list } });
  };
  const addRow = (key: "attributes" | "methods") => {
    const list = [...(sections[key] ?? []), key === "attributes" ? "field: type" : "method()"];
    onUpdate({ sections: { ...sections, [key]: list } });
  };
  const removeRow = (key: "attributes" | "methods", i: number) => {
    const list = [...(sections[key] ?? [])];
    list.splice(i, 1);
    onUpdate({ sections: { ...sections, [key]: list } });
  };

  const showMethods = variant !== "er-entity";
  const isEntity = variant === "er-entity";
  const frame = frameOf(step);

  return (
    <div
      ref={refEl}
      data-node
      data-node-id={step.id}
      onPointerDown={(e) => onSelect(e)}
      className={cn(
        "group absolute animate-item-in rounded-lg border-2 bg-card shadow-sm overflow-hidden flex flex-col",
        frame === "drift" && "border-drift",
        frame === "unclear" && "border-dashed border-unresolved",
        frame === "provenance" && "border-verified",
        // An entity's plain outline has always been teal, as a type colour.
        frame === "plain" && (isEntity ? "border-verified/70" : "border-primary/50"),
      )}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: Math.max(120, setH ?? 0),
        zIndex: LAYER.shape + z,
      }}
    >
      {/* header */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/40 border-b">
        <DragHandle handlers={dragHandlers} />
        <IdChip id={step.id} tone="primary" />
        <div className="flex-1 min-w-0 text-center">
          {stereotype && (
            <div className="text-[9px] font-mono-tight text-muted-foreground leading-none">{stereotype}</div>
          )}
          <div className="text-xs font-semibold break-words leading-tight">
            <InlineEdit value={step.text} onChange={(v) => onUpdate({ text: v })} activate="double" label="Step" />
          </div>
        </div>
        <RefineControl node={{ id: step.id, kind: "step", text: step.text }} model={model} onApply={onRefine} />
        <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete step “${step.text}”`}
          className="relative before:absolute before:-inset-1 before:content-[''] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition">
          <X className="size-3" />
        </button>
      </div>
      {/* attributes */}
      <SectionList
        label={isEntity ? "columns" : "attributes"}
        items={attrs}
        onChange={(i, v) => updateList("attributes", i, v)}
        onRemove={(i) => removeRow("attributes", i)}
        onAdd={() => addRow("attributes")}
      />
      {showMethods && (
        <SectionList
          label="methods"
          items={methods}
          onChange={(i, v) => updateList("methods", i, v)}
          onRemove={(i) => removeRow("methods", i)}
          onAdd={() => addRow("methods")}
          topBorder
        />
      )}
      {onStartConnect && <ConnectHandles rect={rectOfNode(node)} tone="verified" onStart={onStartConnect} />}
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

function SectionList({
  label, items, onChange, onRemove, onAdd, topBorder,
}: {
  label: string;
  items: string[];
  onChange: (i: number, v: string) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  topBorder?: boolean;
}) {
  return (
    <div className={cn("px-2 py-1.5 flex flex-col gap-0.5", topBorder && "border-t")}>
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">{label}</span>
        <button
          onClick={onAdd}
          data-no-pan
          data-edit-control
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-foreground transition"
          title={`Add ${label.slice(0, -1)}`}
        >
          <Plus className="size-3" />
        </button>
      </div>
      {items.length === 0 && (
        <div className="text-[10px] italic text-muted-foreground/70">empty</div>
      )}
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-1 group/row">
          <span className="text-[11px] font-mono-tight text-foreground/90 flex-1 break-words min-w-0">
            <InlineEdit value={v} onChange={(next) => onChange(i, next)} activate="double" />
          </span>
          <button
            onClick={() => onRemove(i)}
            data-no-pan
            data-edit-control
            className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition"
            title="Remove"
            aria-label={`Remove ${v}`}
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}


function MetaSelect({
  label, value, options, onChange,
}: {
  /** The select's accessible name; what shows is only the current value. */
  label: string;
  value: string;
  options: { id: string; text: string }[];
  onChange: (v: string) => void;
}) {
  // A value that matches no option (an unowned step, or one whose actor was
  // deleted) needs an option of its own. Without one the browser silently
  // shows the first real option as selected behind the dash, and choosing
  // that first option then fires no change at all.
  const known = options.some((o) => o.id === value);
  const current = known ? options.find((o) => o.id === value)!.text : "Unassigned";
  // Presenting: the name is shown, with nothing to pick it from and no hover
  // that says it can be changed.
  const presenting = !!useArtifactFullscreen()?.presenting;
  if (presenting) return <span>{current}</span>;
  return (
    // The select itself is invisible, so its keyboard focus ring is drawn on
    // this wrapper instead.
    <span className="relative inline-flex items-center rounded px-1 -mx-1 hover:bg-verified/10 hover:ring-1 hover:ring-verified/30 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring transition" data-no-pan>
      <span className="pointer-events-none">{current}</span>
      <select
        data-edit-control
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label={label}
        title={`Change: ${label}`}
      >
        {!known && <option value={value}>Unassigned</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.text}</option>
        ))}
      </select>
    </span>
  );
}

// ---- Decision (diamond / gateway) ----

function DecisionNode({
  node, d, model, setH, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, z,
}: {
  node: SpineNode; d: Decision; model: ProcessModel;
  /** The height set by hand, if any: the least the shape takes. */
  setH?: number;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Decision>) => void;
  onDrag: (delta: DragDelta, done?: boolean) => void;
  onResize: (w: number, h: number | undefined, done?: boolean) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (e: React.PointerEvent, from: Point) => void;
  /** A press on the body (with the event) or the grip (without). */
  onSelect: (e?: React.PointerEvent) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  z: number;
}) {
  const drag = useNodeDrag(onDrag, onSelect);
  const ref = useMeasure(onMeasure);
  const presenting = !!useArtifactFullscreen()?.presenting;
  const shape = d.shape ?? "decision";
  const isGateway = shape !== "decision";
  const gatewayGlyph = shape === "gateway-parallel" ? "+" : "×";
  const branches = decisionBranches(d);
  const updateBranch = (id: string, patch: Partial<DecisionBranch>) =>
    onUpdate({ branches: branches.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const removeBranch = (id: string) =>
    onUpdate({ branches: branches.filter((b) => b.id !== id) });
  const addBranch = () =>
    onUpdate({
      branches: [...branches, {
        id: `${d.id}-b${branches.length}-${Math.random().toString(36).slice(2, 6)}`,
        label: `Option ${branches.length + 1}`,
        targetId: "—",
      }],
    });
  // Same outline rules as a step (see frameOf): an Unclear decision is dashed
  // amber too, so the chip is not the only sign of it.
  const frame = frameOf(d);
  const stroke = frame === "drift" ? "var(--color-drift)"
    : frame === "provenance" ? "var(--color-verified)"
    : frame === "unclear" ? "var(--color-unresolved)"
    : "var(--color-primary)";
  // The gateway's + or × is a character on the diamond's tint: ink, not stroke.
  const glyphFill = frame === "drift" ? "var(--color-drift-ink)"
    : frame === "provenance" ? "var(--color-verified-ink)"
    : frame === "unclear" ? "var(--color-unresolved-ink)"
    : "var(--color-primary)";
  const fill = frame === "drift"
    ? "color-mix(in oklab, var(--color-drift) 6%, var(--color-card))"
    : frame === "unclear"
      ? "color-mix(in oklab, var(--color-unresolved) 6%, var(--color-card))"
      : "var(--color-card)";

  return (
    <div
      ref={ref}
      data-node
      data-node-id={d.id}
      onPointerDown={(e) => onSelect(e)}
      className={cn("group absolute animate-item-in flex flex-col", d.drift && "animate-drift")}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: Math.max(DEC_H, setH ?? 0),
        zIndex: LAYER.shape + z,
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
          strokeOpacity={frame === "plain" ? 0.7 : frame === "unclear" ? 0.9 : 1}
          strokeDasharray={frame === "unclear" ? "5 3" : undefined}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {isGateway && (
          <text x="50" y="58" textAnchor="middle" fontSize="28" fill={glyphFill} fontFamily="var(--font-mono)">
            {gatewayGlyph}
          </text>
        )}
      </svg>
      <div
        className="relative flex flex-1 flex-col items-center justify-center text-center gap-1"
        style={{ padding: "14% 18%" }}
      >
        <div className="flex items-center gap-1 flex-wrap justify-center">
          <DragHandle handlers={drag} />
          <IdChip id={d.id} tone="primary" />
          <ConfidenceBadge item={d} compact />
          <RefineControl node={{ id: d.id, kind: "decision", text: d.text }} model={model} onApply={onRefine} />
          <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete decision “${d.text}”`}
            className="relative before:absolute before:-inset-1 before:content-[''] text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition">
            <X className="size-3" />
          </button>
        </div>

        <div className="text-[11px] font-medium leading-tight break-words w-full">
          <InlineEdit value={d.text} onChange={(v) => onUpdate({ text: v })} multiline activate="double" label="Decision" />
        </div>
        {/* Not there at all while presenting, so a branch editor left open
         *  closes then and comes back closed. */}
        {!isGateway && !presenting && (
          // Branch editing lives in a popover rather than stacked inline rows.
          // A diamond's usable interior shrinks fast away from vertical
          // center, so an arbitrary-length branch list packed in directly
          // spills past the slanted edges once a decision has more than ~2
          // branches -- exactly the case N-way branches introduced. Branch
          // labels still show at a glance on the connector lines themselves
          // (unchanged, see spine/route rendering above); this is only for
          // editing.
          <Popover>
            <PopoverTrigger asChild>
              <button
                data-no-pan
                data-edit-control
                className="text-[9px] font-mono-tight text-muted-foreground hover:text-primary underline decoration-dotted underline-offset-2 transition"
              >
                {branches.length} branch{branches.length === 1 ? "" : "es"} ▾
              </button>
            </PopoverTrigger>
            <PopoverContent
              data-no-pan className="w-64 p-2" align="center"
              // Esc while typing a branch label cancels that edit first
              // (InlineEdit handles it); the next Esc closes the popover.
              onEscapeKeyDown={(e) => { if (isTypingTarget(e.target)) e.preventDefault(); }}
            >
              <div className="flex flex-col gap-1 text-[11px] font-mono-tight">
                {/* Capped + scrollable so a decision with many branches (a real
                    possibility now that branches are N-way) can't push the
                    popover taller than the viewport. */}
                <div className="flex flex-col gap-1 px-2 py-1 max-h-56 overflow-y-auto">
                  {branches.map((b) => (
                    <div key={b.id} className="flex items-center gap-1">
                      <InlineEdit value={b.label} onChange={(v) => updateBranch(b.id, { label: v })} className="text-primary" />
                      <span className="text-muted-foreground">→</span>
                      <InlineEdit value={b.targetId} onChange={(v) => updateBranch(b.id, { targetId: v })} />
                      {branches.length > 2 && (
                        <button onClick={() => removeBranch(b.id)} aria-label={`Remove branch ${b.label}`}
                          className="ml-auto text-muted-foreground hover:text-destructive transition">
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={addBranch} className="flex items-center gap-1 text-muted-foreground hover:text-primary transition self-start mt-1">
                  <Plus className="size-3" /> Add branch
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {onStartConnect && <ConnectHandles rect={rectOfNode(node)} tone="verified" onStart={onStartConnect} />}
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

// ---- Exception ----

function ExceptionNode({
  node, e, model, setH, onMeasure,
  onDelete, onUpdate, onDrag, onResize, onRefine, onStartConnect,
  onSelect, onBringToFront, onSendToBack, z,
}: {
  node: RightNode; e: Exception; model: ProcessModel;
  /** The height set by hand, if any: the least the shape takes. */
  setH?: number;
  onMeasure: (w: number, h: number) => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<Exception>) => void;
  onDrag: (d: DragDelta, done?: boolean) => void;
  onResize: (w: number, h: number | undefined, done?: boolean) => void;
  onRefine: (p: Proposal) => void;
  onStartConnect?: (ev: React.PointerEvent, from: Point) => void;
  /** A press on the body (with the event) or the grip (without). */
  onSelect: (e?: React.PointerEvent) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  z: number;
}) {
  const drag = useNodeDrag(onDrag, onSelect);
  const ref = useMeasure(onMeasure);
  // The card used to be dashed amber whatever its grade, which is exactly
  // what Unclear looks like. Its type now shows in the "Exception" label and
  // a plain grey outline; the outline colour is left to the grade.
  const frame = frameOf(e);
  return (
    <div
      ref={ref}
      data-node
      data-node-id={e.id}
      onPointerDown={(e) => onSelect(e)}
      className={cn(
        "group absolute rounded-xl border bg-card px-2.5 py-2",
        "shadow-[0_1px_3px_rgba(0,0,0,0.08)]",
        "flex flex-col gap-1 animate-item-in",
        frame === "drift" && "border-drift bg-drift/5",
        e.drift && "animate-drift",
        frame === "unclear" && "border-dashed border-unresolved bg-unresolved/5",
        frame === "plain" && "border-muted-foreground/40",
        frame === "provenance" && "user-added !border-verified",
      )}
      style={{
        left: node.cx - node.w / 2,
        top: node.cy - node.h / 2,
        width: node.w,
        minHeight: Math.max(EX_H, setH ?? 0),
        zIndex: LAYER.shape + z,
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <DragHandle handlers={drag} />
          <IdChip id={e.id} />
        </div>
        <div className="flex items-center gap-1">
          <ConfidenceBadge item={e} compact />
          <RefineControl node={{ id: e.id, kind: "exception", text: e.text }} model={model} onApply={onRefine} />
          <button onClick={onDelete} data-no-pan data-edit-control aria-label={`Delete exception “${e.text}”`}
            className="relative before:absolute before:-inset-1 before:content-[''] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 text-muted-foreground hover:text-destructive transition">
            <X className="size-3" />
          </button>
        </div>
      </div>
      {/* On its own line: in the header it ran under the certainty word. */}
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
        <Zap className="size-3" aria-hidden /> Exception
      </span>
      <div className="text-[11px] leading-snug break-words">
        <InlineEdit value={e.text} onChange={(v) => onUpdate({ text: v })} multiline activate="double" label="Exception" />
      </div>
      {onStartConnect && <ConnectHandles rect={rectOfNode(node)} tone="verified" onStart={onStartConnect} />}
      <ResizeHandle w={node.w} h={node.h} onResize={onResize} />
    </div>
  );
}

// Silence unused-import warnings.
export const _pc_unused = { useEffect };

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProcessModel, Step, Decision, Connection, NodeLayout } from "@/data/samples";
import { decisionBranches } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Plus, X, GripVertical, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CanvasShell, useCanvas, CANVAS_TOP_INSET, CANVAS_GLIDE_CLASS, type RevealTarget } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { useRevealNew, FlashRing, FlashOutline } from "./canvas-reveal";
import { SelectionBar, SelectionOutlines, SnapGuides, useShapeSelection } from "./canvas-selection";
import { ConnectHandles, ConnectorEnds, ConnectorPreview, LineBar, useConnectorDrag } from "./canvas-connectors";
import { LineLabel } from "./LineLabel";
import { LAYER } from "./canvas-layers";
import { DeleteX } from "./canvas-controls";
import { useGrownHeights } from "./use-grown-heights";
import { InlineEdit } from "./InlineEdit";
import { roundedPath } from "@/lib/canvas/geometry";
import { connectorRoute, type Point } from "@/lib/canvas/connector";
import { SAVE_LAYOUTS, layoutOf } from "@/lib/canvas/layout";
import { isTypingTarget, useArtifactFullscreen } from "./artifact-fullscreen";
import { IdChip, ConfidenceBadge } from "./atoms";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { gradeOf } from "@/lib/grade";

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

/** A shape where it is drawn. `baseH` is its own height; `h` is taller
 *  when its text needs it. */
interface Placed extends SeqItem { cx: number; cy: number; w: number; h: number; baseH: number; isBar: boolean; }
/** Where shapes were moved to; a step handed to another lane keeps only
 *  its row (cy) and goes where its lane is, so Undo puts it back too. */
type Pos = Record<string, { cx?: number; cy?: number }>;

/** Lane by actor and row by sequence until the person moves a shape; then
 *  where they put it (a drag in progress, else the saved arrangement). */
function layout(model: ProcessModel, overrides: Pos, saved: Record<string, NodeLayout> | undefined, grown: Record<string, number>) {
  const seq = buildSequence(model);
  const lanes = model.actors;
  const laneX = (actorId: string) => {
    const idx = Math.max(0, lanes.findIndex((a) => a.id === actorId));
    return LEFT_PAD + idx * LANE_W;
  };
  const placed: Placed[] = seq.map((it) => {
    const isBar = it.kind === "decision" && (it.ref as Decision).shape === "gateway-parallel";
    const w = it.kind === "decision" ? (isBar ? BAR_W : DEC_W) : NODE_W;
    const baseH = it.kind === "decision" ? (isBar ? BAR_H : DEC_H) : NODE_H;
    const h = isBar ? baseH : Math.max(baseH, grown[it.ref.id] ?? 0);
    const o = overrides[it.ref.id], sv = saved?.[it.ref.id];
    const cx = o?.cx ?? (sv ? sv.x + w / 2 : laneX(it.laneActorId) + LANE_W / 2);
    const cy = o?.cy ?? (sv ? sv.y + h / 2 : TOP_PAD + it.row * ROW_H + ROW_H / 2);
    return { ...it, cx, cy, w, h, baseH, isBar };
  });
  const width = Math.max(900, LEFT_PAD + Math.max(1, lanes.length) * LANE_W + 40, ...placed.map((p) => p.cx + p.w / 2 + 40));
  const height = Math.max(560, TOP_PAD + seq.length * ROW_H + 60, ...placed.map((p) => p.cy + p.h / 2 + 60));
  return { placed, lanes, width, height };
}

const rectOf = (p: Placed) => ({ x: p.cx - p.w / 2, y: p.cy - p.h / 2, w: p.w, h: p.h });
/** The smallest rectangle around all of these. */
function unionOf(rs: { x: number; y: number; w: number; h: number }[]) {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

interface Props {
  model: ProcessModel;
  editing: ArtifactEditing;
}

/** Focus target for "the Add lane button", alongside lane ids. */
const ADD_LANE = "__add_lane__";

/** Lane header that stays in view while the diagram is read downwards.
 *
 *  The lane name is the "who" of every step beneath it. The header used to
 *  carry `sticky top-0`, which does nothing here: the canvas content is a
 *  transformed layer, not a scroll container. That did not show while the
 *  whole diagram was shrunk to fit; opened at a readable size, one scroll
 *  and nobody could tell whose lane was whose. So it follows the camera by
 *  hand, parked just under the canvas's toolbar row.
 *
 *  Marked `data-canvas-pinned` so export (export-pdf.ts) can put it back at
 *  the top of the lane for the picture. */
function LaneHeader({ maxOffset, flash, children }: { maxOffset: number; flash?: boolean; children: ReactNode }) {
  const { zoom, pan, gliding } = useCanvas();
  const offset = Math.min(Math.max(0, maxOffset), Math.max(0, (CANVAS_TOP_INSET - pan.y) / zoom));
  return (
    <div
      data-canvas-pinned
      // While the camera glides, the header counter-moves on the same curve;
      // moved instantly it would jump ahead and wait for the diagram. (Exact
      // because only pan-only moves glide -- see glide() in CanvasShell.)
      className={cn(
        "relative flex items-center justify-between gap-1 border-b bg-muted px-2",
        gliding && CANVAS_GLIDE_CLASS,
      )}
      style={{ height: LANE_HEADER_H, transform: `translateY(${offset}px)`, zIndex: LAYER.pinned }}
    >
      {/* While pinned, the header sits one toolbar-row below the top of the
       *  canvas, and step cards scrolling up behind it used to reappear in
       *  that strip, above their own lane's name. This closes the strip. It
       *  is above y=0 of the diagram, so an export never includes it. */}
      {offset > 0 && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-full bg-background"
          style={{ height: CANVAS_TOP_INSET / zoom + 1 }}
        />
      )}
      {children}
      {flash && <FlashOutline />}
    </div>
  );
}

export function ActivityDiagramView({ model, editing }: Props) {
  // Moved shapes are view state until saving is on (see SAVE_LAYOUTS); kept
  // in the artifact's view store so they survive a tab switch.
  const [overrides, setOverrides] = useCanvasViewState<Pos>("activity:overrides", {});
  const saved = layoutOf(model, "activity")?.nodes;
  // Shapes grow with their text; lines and outlines follow.
  const grown = useGrownHeights();
  const { placed, lanes, width, height } = useMemo(
    () => layout(model, overrides, saved, grown.heights), [model, overrides, saved, grown.heights]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.ref.id, p])), [placed]);
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const presenting = !!useArtifactFullscreen()?.presenting;

  // A step added from a lane header joins the END of the sequence, which is
  // the bottom of the diagram; a new lane lands at the far right. Either can
  // be well out of view, so both are revealed.
  const rectFor = (id: string): RevealTarget | null => {
    const p = byId.get(id);
    if (p) return rectOf(p);
    const lane = lanes.findIndex((a) => a.id === id);
    // A lane's header is pinned to the top of the view wherever the camera
    // is, so showing a new lane only ever means moving sideways. Asking for
    // its (y: 0) rectangle on both axes would drag a reader who is halfway
    // down the diagram back to the top.
    return lane >= 0 ? { x: LEFT_PAD + lane * LANE_W, y: 0, w: LANE_W, h: LANE_HEADER_H, axis: "x" } : null;
  };
  const { apiRef: shellApi, revealNew, flashId } = useRevealNew(rectFor);

  // ---- Moving, selecting, keys, copy and paste (canvas-selection.tsx) ----
  const noteMove = useNoteLayoutMove();
  const rectsById = useMemo(() => new Map(placed.map((p) => [p.ref.id, rectOf(p)])), [placed]);
  const currentPlaces = () => Object.fromEntries(placedRef.current.map((p) => [p.ref.id, { x: p.cx - p.w / 2, y: p.cy - p.h / 2 }]));
  const sizeOf = (id: string) => {
    const p = placedRef.current.find((x) => x.ref.id === id);
    if (p) return { w: p.w, h: p.h };
    return id.startsWith("DC-") ? { w: DEC_W, h: DEC_H } : { w: NODE_W, h: NODE_H };
  };
  /** The lane a point is in (by x), if any. */
  const laneAt = (x: number) => {
    const i = Math.floor((x - LEFT_PAD) / LANE_W);
    return i >= 0 && i < lanes.length ? lanes[i] : undefined;
  };
  // A step let go in another lane is handed over to that lane's actor: in a
  // swimlane diagram, where a step sits says who does it. Only a step moved
  // on its own (moving a whole selection reassigns nobody), and only when
  // it lands in a lane other than the one it is drawn in.
  const handOver = (places: Record<string, { x: number; y: number }>, opts: { quiet?: boolean } = {}) => {
    const handed: { id: string; text: string; lane: { id: string; text: string } }[] = [];
    for (const [id, p] of Object.entries(places)) {
      const step = model.steps.find((s) => s.id === id);
      if (!step) continue;
      const lane = laneAt(p.x + sizeOf(id).w / 2);
      const drawnIn = Math.max(0, lanes.findIndex((a) => a.id === step.actorId));
      if (!lane || lanes.indexOf(lane) === drawnIn) continue;
      handed.push({ id, text: step.text, lane });
    }
    if (handed.length === 0) return;
    // A decision drawn after a handed-over step stays where it is.
    const frozen: Pos = {};
    for (const h of handed) {
      for (const d of model.decisions.filter((x) => x.afterStepId === h.id)) {
        const at = placedRef.current.find((x) => x.ref.id === d.id);
        if (at) frozen[d.id] = { cx: at.cx, cy: at.cy };
      }
    }
    // The step's x follows its lane from now on (and back, on Undo).
    setOverrides((cur) => {
      const next = { ...cur, ...frozen };
      for (const h of handed) if (next[h.id]) next[h.id] = { cy: next[h.id].cy };
      return next;
    });
    for (const h of handed) editing.onUpdateItem(h.id, { actorId: h.lane.id });
    if (!opts.quiet && handed.length === 1) {
      toast(`“${handed[0].text}” is now done by ${handed[0].lane.text}`, { description: "Press Ctrl/⌘ Z to undo." });
    }
  };
  const lines = useMemo(() => model.connections ?? [], [model.connections]);
  const drawnLines = useMemo(() => lines.filter((c) => rectsById.has(c.fromId) && rectsById.has(c.toId)), [lines, rectsById]);
  const drawnLineIds = useMemo(() => new Set(drawnLines.map((c) => c.id)), [drawnLines]);
  // What each shape and line is called: for screen readers, and the lists
  // in the selection bar and the line bar.
  const shapeName = (id: string) => {
    const s = model.steps.find((x) => x.id === id); if (s) return `Step “${s.text}”`;
    const d = model.decisions.find((x) => x.id === id);
    if (d) return d.shape === "gateway-parallel" ? `Fork / join ${d.id}` : `Decision “${d.text}”`;
    return id;
  };
  const lineName = (id: string) => {
    const c = lines.find((x) => x.id === id);
    return c ? `Line from ${shapeName(c.fromId)} to ${shapeName(c.toId)}` : "Line";
  };
  const shapeList = [...rectsById.keys()].map((id) => ({ id, name: shapeName(id) }));
  const sel = useShapeSelection({
    view: "activity", model, rects: rectsById, shellApi, presenting,
    lines: drawnLineIds, onDeleteLine: editing.onDeleteConnection,
    nameOf: shapeName, lineNameOf: lineName,
    canEdit: editing.canEdit,
    preview: (places) => {
      if (!SAVE_LAYOUTS) noteMove(model);
      setOverrides((cur) => {
        const next = { ...cur };
        for (const [id, p] of Object.entries(places)) { const z = sizeOf(id); next[id] = { cx: p.x + z.w / 2, cy: p.y + z.h / 2 }; }
        return next;
      });
    },
    commit: (places, mergeKey) => {
      if (Object.keys(places).length === 1) handOver(places);
      if (!SAVE_LAYOUTS) return;
      editing.onPlaceShapes("activity", places, currentPlaces(), mergeKey);
      setOverrides((cur) => { const next = { ...cur }; for (const id of Object.keys(places)) delete next[id]; return next; });
    },
    onDeleteMany: editing.onDeleteMany,
    onPaste: (clip, dx, dy) => {
      const made = editing.onPasteShapes("activity", clip, dx, dy, currentPlaces());
      if (made && !SAVE_LAYOUTS) {
        setOverrides((cur) => {
          const next = { ...cur };
          for (const id of made.ids) { const p = made.places[id]; if (p) { const z = sizeOf(id); next[id] = { cx: p.x + z.w / 2, cy: p.y + z.h / 2 }; } }
          return next;
        });
      }
      // Copies are done by whoever's lane they land in.
      if (made) handOver(made.places, { quiet: true });
      return made;
    },
  });
  const arranged = !!saved || Object.keys(overrides).length > 0;
  const tidyUp = () => {
    if (saved && !editing.onTidyUp("activity")) return;
    setOverrides({});
  };

  // ---- Lines drawn by hand (canvas-connectors.tsx) ----
  const connect = useConnectorDrag({ shellApi, rects: rectsById, canEdit: editing.canEdit });
  const startConnDrag = (fromId: string, e: React.PointerEvent, from: Point) =>
    connect.start(e, from, { exclude: fromId, done: (toId) => editing.onAddConnection(fromId, toId) });
  const startEndDrag = (c: Connection, end: "from" | "to", e: React.PointerEvent, fixed: Point) =>
    connect.start(e, fixed, {
      exclude: end === "from" ? c.toId : c.fromId,
      done: (id) => {
        if (id === (end === "from" ? c.fromId : c.toId)) return;
        editing.onUpdateConnection(c.id, end === "from" ? { fromId: id } : { toId: id });
      },
    });
  const routeOf = (fromId: string, toId: string) => {
    const a = rectsById.get(fromId), b = rectsById.get(toId);
    return a && b ? connectorRoute(a, b) : null;
  };

  // The selection bar and the line bar sit right after their shape or line
  // in the page, so Tab goes shape, its bar, the next shape.
  const barAfter = (id: string) => presenting || sel.selection.ids[0] !== id ? null : (
    <SelectionBar
      ids={sel.selection.ids} rects={rectsById} actions={sel.actions}
      connect={{
        what: "line", targets: shapeList.filter((t) => t.id !== sel.selection.ids[0]),
        onPick: (to) => editing.onAddConnection(sel.selection.ids[0], to),
      }}
    />
  );
  const lineBarAfter = (c: Connection) => {
    const r = presenting || sel.line !== c.id ? null : routeOf(c.fromId, c.toId);
    return r ? (
      <LineBar
        lineId={c.id} at={r.mid} fromId={c.fromId} toId={c.toId} shapes={shapeList} what="line"
        onChange={(end, id) => editing.onUpdateConnection(c.id, end === "from" ? { fromId: id } : { toId: id })}
        onDelete={() => editing.onDeleteConnection(c.id)}
      />
    ) : null;
  };

  // Closing an add form removes the field that had focus. Hand focus back to
  // the button that opened it, or a keyboard user is dropped at the top of
  // the page after every single step.
  const laneButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const addLaneButton = useRef<HTMLButtonElement | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  useEffect(() => {
    if (!refocus) return;
    const el = refocus === ADD_LANE ? addLaneButton.current : laneButtons.current.get(refocus);
    el?.focus({ preventScroll: true });
    setRefocus(null);
  }, [refocus]);

  const [addingLane, setAddingLane] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const closeAdd = (actorId: string) => { setDraft(""); setAddingLane(null); setRefocus(actorId); };
  const commitAdd = (actorId: string) => {
    const t = draft.trim();
    if (t) revealNew(editing.onAddStep(t, undefined, actorId));
    closeAdd(actorId);
  };

  const [addingActor, setAddingActor] = useState(false);
  const [actorDraft, setActorDraft] = useState("");
  const closeActor = () => { setActorDraft(""); setAddingActor(false); setRefocus(ADD_LANE); };
  const commitActor = () => {
    const t = actorDraft.trim();
    if (t) revealNew(editing.onAddActor(t));
    closeActor();
  };

  // Present mode hides both add forms. One left open would come back when
  // Present mode ends, and its field would grab focus as it mounted again, so
  // it is shut instead. Focus is not handed back: the buttons it would go to
  // are hidden while presenting.
  useEffect(() => {
    if (!presenting) return;
    setDraft(""); setAddingLane(null);
    setActorDraft(""); setAddingActor(false);
  }, [presenting]);

  // Esc anywhere in an add form (its field or its buttons) closes the form,
  // as Cancel does, and is marked handled so it does not also leave full
  // screen. The field closes it itself first; this catches the buttons.
  const escCloses = (close: () => void) => (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };

  const lastRow = placed.length ? Math.max(...placed.map((p) => p.row)) : -1;
  return (
    // The frame the selection keys answer for (canvas-selection.tsx).
    <div ref={(el) => { sel.frameRef.current = el; grown.rootRef.current = el; }} className="h-full w-full">
    <CanvasShell
      contentWidth={width}
      contentHeight={height}
      minimap
      fullscreenLabel="Activity diagram"
      viewId="activity"
      apiRef={shellApi}
      onSelectBox={sel.onSelectBox}
      onBackgroundPress={sel.onBackgroundPress}
      // The lanes and the rows in them, not the padded sheet (min 900x560).
      // Steps are drawn even when there are no actors yet (a from-scratch
      // flow), in the space the first lane would take.
      drawnBounds={lanes.length === 0 && placed.length === 0 ? null : unionOf([
        { x: LEFT_PAD, y: 0, w: Math.max(1, lanes.length) * LANE_W, h: placed.length ? TOP_PAD + (lastRow + 1) * ROW_H : LANE_HEADER_H },
        ...placed.map(rectOf),
      ])}
      shapes={placed.map(rectOf)}
      bottomLeft={
        <span data-edit-control className="hidden @min-[640px]:flex items-center gap-1.5 rounded bg-card/95 backdrop-blur px-2 py-1 border text-2xs font-mono-tight text-muted-foreground">
          One lane per actor · drag a step into another lane to hand it over · double-click to type · drag a side dot to draw a line
        </span>
      }
      bottomRight={
        addingActor ? (
          <div onKeyDown={escCloses(closeActor)} className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm">
            <input autoFocus value={actorDraft} onChange={(e) => setActorDraft(e.target.value)}
              // preventDefault: committing hands focus back to the button that
              // opened this form, and the same keystroke's keypress would land
              // on that button and open the form again.
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitActor(); } if (e.key === "Escape") { e.preventDefault(); closeActor(); } }}
              placeholder="New lane (actor)" aria-label="Name of the new lane's actor"
              className="h-8 w-40 text-sm px-2 rounded border bg-background" />
            <button onClick={commitActor} title="Add lane" aria-label="Add lane" className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><Plus className="size-4" /></button>
            <button onClick={closeActor} title="Cancel" aria-label="Cancel" className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted"><X className="size-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {/* Only once shapes were moved by hand. */}
            {arranged && (
              <button onClick={tidyUp} data-no-pan className="h-8 px-2.5 rounded-md bg-card/95 text-xs flex items-center gap-1.5 hover:bg-muted"
                title="Put every shape back in its lane and row">
                <Wand2 className="size-3.5" /> Tidy up
              </button>
            )}
            <button ref={addLaneButton} onClick={() => setAddingActor(true)} data-no-pan className="h-8 px-2.5 rounded-md border border-separator-strong bg-card text-xs flex items-center gap-1.5 hover:border-primary/60">
              <Plus className="size-3.5 text-primary" /> Add lane
            </button>
          </div>
        )
      }
    >
      {lanes.map((a, i) => (
        <div key={a.id} className="absolute top-0 bottom-0 border-r border-dashed border-border/70" style={{ left: LEFT_PAD + i * LANE_W, width: LANE_W }}>
          <LaneHeader maxOffset={height - LANE_HEADER_H} flash={flashId === a.id}>
            <span className="text-xs font-semibold truncate">{a.text}</span>
            {/* Adding a step is editing: Present mode hides it (data-edit-control),
             *  the lane name stays. */}
            {addingLane === a.id ? (
              <div data-edit-control onKeyDown={escCloses(() => closeAdd(a.id))} className="flex items-center gap-0.5 shrink-0">
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(a.id); } if (e.key === "Escape") { e.preventDefault(); closeAdd(a.id); } }}
                  placeholder="New step" aria-label={`New step for ${a.text}`}
                  className="h-6 w-24 text-[11px] px-1.5 rounded border bg-background" />
                <button onClick={() => commitAdd(a.id)} title="Add step" aria-label={`Add this step for ${a.text}`} className="text-primary"><Plus className="size-3.5" /></button>
              </div>
            ) : (
              <button data-edit-control ref={(el) => { laneButtons.current.set(a.id, el); }} onClick={() => { setDraft(""); setAddingLane(a.id); }} title={`Add a step for ${a.text}`} aria-label={`Add a step for ${a.text}`} className="text-muted-foreground hover:text-primary transition shrink-0"><Plus className="size-3.5" /></button>
            )}
          </LaneHeader>
        </div>
      ))}

      {/* Nodes only: a lane's ring is drawn inside its pinned header. */}
      <FlashRing key={flashId ?? "idle"} rect={flashId && byId.has(flashId) ? rectFor(flashId) : null} />
      {!presenting && <SelectionOutlines ids={sel.selection.ids} rects={rectsById} />}
      {!presenting && <SnapGuides guides={sel.guides} />}

      <svg width={width} height={height} className="absolute inset-0" style={{ pointerEvents: "none", overflow: "visible" }}>
        <defs>
          <marker id="ad-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
          </marker>
        </defs>
        {/* The flow: each step into whatever follows it in sequence (a
         *  decision's branches route on from there). */}
        {placed.map((p, i) => {
          if (p.kind === "decision") return null;
          const next = placed[i + 1];
          if (next && lines.some((c) => c.fromId === p.ref.id && c.toId === next.ref.id)) return null;
          const r = next ? connectorRoute(rectOf(p), rectOf(next)) : null;
          return r ? <path key={`seq-${p.ref.id}`} d={roundedPath(r.points)} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#ad-arrow)" /> : null;
        })}
        {placed.filter((p) => p.kind === "decision").map((p) => {
          const d = p.ref as Decision;
          return decisionBranches(d).map((b) => {
            const target = byId.get(b.targetId);
            if (!target) return null;
            const r = connectorRoute(rectOf(p), rectOf(target));
            return (
              <g key={`${d.id}-${b.id}`}>
                <path d={roundedPath(r.points)} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#ad-arrow)" />
                <text x={r.mid.x + 6} y={r.mid.y - 6} fill="var(--color-foreground)" fontSize="10" fontFamily="var(--font-mono)">{b.label}</text>
              </g>
            );
          });
        })}
        {/* Lines drawn by hand: click to select, double-click to type. */}
        {drawnLines.map((c) => {
          const r = routeOf(c.fromId, c.toId);
          if (!r) return null;
          const path = roundedPath(r.points);
          const selected = sel.line === c.id;
          return (
            <g key={c.id}>
              {!presenting && (
                <path
                  d={path} fill="none" stroke="transparent" strokeWidth={14} pointerEvents="stroke"
                  data-no-pan data-edit-control className="cursor-pointer"
                  onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); sel.selectLine(c.id); }}
                  onDoubleClick={() => sel.editLineLabel(c.id)}
                />
              )}
              {selected && (
                <path
                  d={path} fill="none" stroke="var(--color-primary)" strokeOpacity={0.6} strokeWidth={7}
                  strokeLinecap="round" pointerEvents="none" data-edit-control
                />
              )}
              <path d={path} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.75} strokeLinecap="round" markerEnd="url(#ad-arrow)" />
            </g>
          );
        })}
      </svg>

      {placed.map((p) => {
        const id = p.ref.id;
        const common = {
          node: p,
          onPress: (e: React.PointerEvent) => sel.pressShape(id, e),
          onGrip: (e: React.PointerEvent) => {
            // A grip on one of several selected shapes moves them all; on
            // any other, just that shape. Either way with snap guides.
            const ids = sel.selection.ids;
            sel.dragSelection(e, ids.length > 1 && ids.includes(id) ? ids : [id]);
          },
          onDelete: () => editing.onDeleteAny(id),
          onStartConnect: (e: React.PointerEvent, from: Point) => startConnDrag(id, e, from),
        };
        return (
          <Fragment key={id}>
            {p.kind === "step" ? (
              <ActivityStepNode {...common} step={p.ref as Step} onUpdate={(text) => editing.onUpdateItem(id, { text })} />
            ) : (
              <ActivityDecisionNode {...common} d={p.ref as Decision}
                onUpdate={(text) => editing.onUpdateItem(id, { text })}
                onAddBranch={() => {
                  const branches = decisionBranches(p.ref as Decision);
                  const bid = `${id}-b${branches.length}-${Math.random().toString(36).slice(2, 6)}`;
                  editing.onUpdateItem(id, { branches: [...branches, { id: bid, label: `Option ${branches.length + 1}`, targetId: "—" }] });
                }}
                onUpdateBranch={(bid, patch) => {
                  const branches = decisionBranches(p.ref as Decision);
                  editing.onUpdateItem(id, { branches: branches.map((b) => (b.id === bid ? { ...b, ...patch } : b)) });
                }}
                onRemoveBranch={(bid) => {
                  const branches = decisionBranches(p.ref as Decision);
                  editing.onUpdateItem(id, { branches: branches.filter((b) => b.id !== bid) });
                }} />
            )}
            {barAfter(id)}
          </Fragment>
        );
      })}

      {drawnLines.map((c) => {
        const m = routeOf(c.fromId, c.toId)?.mid;
        if (!m) return null;
        return (
          <Fragment key={`lbl-${c.id}`}>
            <LineLabel
              lineId={c.id} x={m.x} y={m.y} onSelect={() => sel.selectLine(c.id)} name={lineName(c.id)}
              value={c.label ?? ""} placeholder="Add label" quiet
              fieldLabel="Line label"
              onChange={(label) => editing.onUpdateConnection(c.id, { label })}
              onDelete={() => editing.onDeleteConnection(c.id)}
              deleteLabel={`Delete line${c.label ? ` ${c.label}` : ""}`}
            />
            {lineBarAfter(c)}
          </Fragment>
        );
      })}
      {!presenting && <ConnectorPreview live={connect.live} rects={rectsById} color="var(--color-primary)" />}
      {!presenting && (() => {
        const c = drawnLines.find((x) => x.id === sel.line);
        const r = c && routeOf(c.fromId, c.toId);
        if (!c || !r) return null;
        const p0 = r.points[0], p1 = r.points[r.points.length - 1];
        return <ConnectorEnds from={p0} to={p1} onStart={(e, end) => startEndDrag(c, end, e, end === "from" ? p1 : p0)} />;
      })()}
    </CanvasShell>
    {sel.liveRegion}
    {sel.pasteDialog}
    </div>
  );
}

/** What every Activity shape takes from the view: where it is, presses on
 *  its body and grip, delete, and the dots that draw a line. */
interface NodeCommon {
  node: Placed;
  /** A press on the body: select, and drag the selection. */
  onPress: (e: React.PointerEvent) => void;
  /** A press on the grip: drag this shape (or the selection it is in). */
  onGrip: (e: React.PointerEvent) => void;
  onDelete: () => void;
  onStartConnect: (e: React.PointerEvent, from: Point) => void;
}

function Grip({ onGrip }: { onGrip: (e: React.PointerEvent) => void }) {
  return (
    <GripVertical
      data-no-pan data-edit-control aria-hidden
      onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onGrip(e); }}
      className="size-3.5 text-muted-foreground/70 hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
    />
  );
}

function ActivityStepNode({
  node, step, onPress, onGrip, onDelete, onUpdate, onStartConnect,
}: NodeCommon & { step: Step; onUpdate: (t: string) => void }) {
  // The frame says how sure, with the chip's word beside it: red when the
  // source changed or the sources disagree, dashed amber when unclear, teal
  // when a person made or changed it.
  const g = gradeOf(step);
  return (
    <div
      data-node data-shape-id={step.id}
      onPointerDown={onPress}
      className={cn(
        "group absolute rounded-xl border-2 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2",
        g.grade === "changed" || g.grade === "disagree" ? "border-drift"
        : g.grade === "unclear" ? "border-dashed border-unresolved"
        : g.provenance ? "border-verified"
        : "border-primary/60",
      )}
      // Its own height at least, taller when the text needs it.
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, minHeight: node.baseH, zIndex: LAYER.shape }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <Grip onGrip={onGrip} />
          <IdChip id={step.id} tone="primary" />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ConfidenceBadge item={step} compact />
          <DeleteX label={`Delete step “${step.text}”`} onClick={onDelete} />
        </div>
      </div>
      <div className="text-xs font-medium leading-snug break-words">
        <InlineEdit value={step.text} onChange={onUpdate} multiline activate="double" label="Step" />
      </div>
      <ConnectHandles rect={rectOf(node)} onStart={onStartConnect} />
    </div>
  );
}

function ActivityDecisionNode({
  node, d, onPress, onGrip, onDelete, onUpdate, onStartConnect, onAddBranch, onUpdateBranch, onRemoveBranch,
}: NodeCommon & {
  d: Decision;
  onUpdate: (t: string) => void;
  onAddBranch: () => void;
  onUpdateBranch: (branchId: string, patch: { label?: string; targetId?: string }) => void;
  onRemoveBranch: (branchId: string) => void;
}) {
  const branches = decisionBranches(d);
  // The branch editor is editing. Present mode hides its trigger, and one
  // left open when Present mode starts is shut (it would otherwise float,
  // anchored to a hidden button, with its add and remove controls).
  const presenting = !!useArtifactFullscreen()?.presenting;
  const [branchesOpen, setBranchesOpen] = useState(false);
  if (presenting && branchesOpen) setBranchesOpen(false);

  if (node.isBar) {
    return (
      <div
        data-node data-shape-id={d.id}
        onPointerDown={onPress}
        className="group absolute rounded-[3px] bg-foreground shadow-sm flex items-center justify-center cursor-default before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
        style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, height: node.h, zIndex: LAYER.shape }}
        title="Fork / join"
      >
        <div className="absolute -top-5 right-0"><DeleteX label={`Delete fork / join ${d.id}`} onClick={onDelete} /></div>
        <IdChip id={d.id} />
      </div>
    );
  }

  return (
    <div
      data-node data-shape-id={d.id}
      onPointerDown={onPress}
      className="group absolute rounded-xl border-2 border-primary/60 bg-card shadow-sm flex flex-col gap-1 px-2.5 py-2"
      // Its own height at least, taller when the text needs it.
      style={{ left: node.cx - node.w / 2, top: node.cy - node.h / 2, width: node.w, minHeight: node.baseH, zIndex: LAYER.shape }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <Grip onGrip={onGrip} />
          <IdChip id={d.id} />
        </div>
        <DeleteX label={`Delete decision “${d.text}”`} onClick={onDelete} />
      </div>
      <div className="text-[11px] font-medium leading-snug break-words">
        <InlineEdit value={d.text} onChange={onUpdate} multiline activate="double" label="Decision" />
      </div>
      <Popover open={branchesOpen && !presenting} onOpenChange={setBranchesOpen}>
        <PopoverTrigger asChild>
          <button data-no-pan data-edit-control className="text-[9px] font-mono-tight text-muted-foreground hover:text-primary underline decoration-dotted underline-offset-2 transition self-start mt-auto">
            {branches.length} branch{branches.length === 1 ? "" : "es"} ▾
          </button>
        </PopoverTrigger>
        <PopoverContent
          data-no-pan className="w-64 p-2" align="start"
          // Esc while typing a branch label cancels that edit and leaves the
          // editor open; the next Esc closes it.
          onEscapeKeyDown={(e) => { if (isTypingTarget(e.target)) e.preventDefault(); }}
        >
          <div className="flex flex-col gap-1 px-2 py-1 text-[11px] font-mono-tight max-h-56 overflow-y-auto">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center gap-1">
                <InlineEdit value={b.label} onChange={(v) => onUpdateBranch(b.id, { label: v })} className="text-primary" />
                <span className="text-muted-foreground">→</span>
                <InlineEdit value={b.targetId} onChange={(v) => onUpdateBranch(b.id, { targetId: v })} />
                {branches.length > 2 && (
                  <button onClick={() => onRemoveBranch(b.id)} data-edit-control aria-label={`Remove branch ${b.label}`} className="ml-auto text-muted-foreground hover:text-destructive transition">
                    <X className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={onAddBranch} data-edit-control className="mt-1.5 flex items-center gap-1 text-muted-foreground hover:text-primary transition">
            <Plus className="size-3" /> Add branch
          </button>
        </PopoverContent>
      </Popover>
      <ConnectHandles rect={rectOf(node)} onStart={onStartConnect} />
    </div>
  );
}

// What is selected on a diagram, and the keys that act on it (phase 3).
//
// Selection belongs to this viewer only: it is kept in the artifact's view
// store (it survives a tab switch, never the model, so other people never
// see it), one list per diagram.
//
// The keys: Delete or Backspace removes; the arrows nudge (Shift: further);
// Cmd/Ctrl+A selects all; Cmd/Ctrl+C, X, V and D copy, cut, paste and
// duplicate; Enter or F2 types on a single selected shape; Esc lets go. They
// answer only for the diagram on screen (several are mounted at once on the
// project page) and only when nothing else wants them: not while typing, not
// inside a pop-up or dialog. Listened for on the way down (capture), so Esc
// clearing a selection comes before Esc leaving full screen.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowDownToLine, ArrowUpToLine, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { NodeLayout, ProcessModel, ViewId } from "@/data/samples";
import { boxBetween, clipForView, copyShapes, shapeClipboard, shapesInBox, type ShapeClip } from "@/lib/canvas/clipboard";
import type { Rect } from "@/lib/canvas/layout";
import { alignTo, type Guide } from "@/lib/canvas/guides";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCanvasViewState } from "./canvas-view-store";
import { isTypingTarget } from "./artifact-fullscreen";
import { followPointer, useCanvas, type CanvasApi, type CanvasRect } from "./CanvasShell";
import { EDIT_TEXT_EVENT } from "./InlineEdit";

export interface Selection {
  ids: string[];
  has: (id: string) => boolean;
  /** Replace the selection. */
  set: (ids: string[]) => void;
  /** Shift-click: in if out, out if in. */
  toggle: (id: string) => void;
  clear: () => void;
}

export function useCanvasSelection(view: string): Selection {
  const [ids, setIds] = useCanvasViewState<string[]>(`select:${view}`, []);
  return {
    ids,
    has: (id) => ids.includes(id),
    set: (next) => setIds((cur) => (cur.length === next.length && cur.every((x, i) => x === next[i]) ? cur : next)),
    toggle: (id) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
    clear: () => setIds((cur) => (cur.length === 0 ? cur : [])),
  };
}

export interface SelectionKeyHandlers {
  /** How many shapes are selected now. */
  count: number;
  onDelete: () => void;
  onNudge: (dx: number, dy: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  /** Type on the one selected shape. */
  onEdit: () => void;
}

/** Something that keeps its own keys: a pop-up, menu, list or dialog. */
const OVERLAY = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]";
/** One of those open anywhere on the page. */
const OPEN_OVERLAY = "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='menu'], [data-radix-popper-content-wrapper]";

/** A control with keys of its own: Enter, Space, Esc or the arrows belong
 *  to it while it has focus. A shape's own text (data-edit-text) is not
 *  one; a line's label is (Delete there must not delete the selected shapes). */
const CONTROL = "button, a[href], select, summary, [data-line-label], [role='button']:not([data-edit-text]), [role='tab'], [role='checkbox'], [role='switch'], [role='menuitem'], [role='option'], [role='slider']";

/** The diagram the person last pressed in (a mouse or finger down inside
 *  its frame); a press anywhere else lets go of it. Keys pressed with focus
 *  on the page, or on the artifact around the diagram (a press on a shape
 *  leaves focus there, as shapes cannot take it), go to this one only --
 *  never to some other diagram on the page, or one scrolled out of view. */
let lastPressed: HTMLElement | null = null;

/** Whether this diagram should answer the keyboard now: it is on screen,
 *  inside whatever is full screen, and focus is either inside it or around
 *  it after a press in it -- not in a field, a pop-up, or a control that
 *  owns its keys. */
function answers(root: HTMLElement | null, e: KeyboardEvent): boolean {
  if (!root || root.getClientRects().length === 0) return false;
  const fsEl = document.fullscreenElement ?? document.querySelector("[data-canvas-fs]");
  if (fsEl && !fsEl.contains(root)) return false;
  if (e.isComposing || isTypingTarget(e.target)) return false;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest(OVERLAY) || document.querySelector(OPEN_OVERLAY)) return false;
  if (t && t !== document.body && root.contains(t)) return !t.closest(CONTROL);
  // Focus on the page, or on the artifact that holds this diagram.
  const around = !t || t === document.body || (t.contains(root) && !!(t.closest("[data-artifact-root]") ?? t.querySelector("[data-artifact-root]")));
  return around && lastPressed === root;
}

/** Text the person has highlighted on the page outside this diagram: then
 *  Cmd/Ctrl+A and C are the browser's, not the canvas's. */
function pageTextSelected(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  return !root.contains(sel.getRangeAt(0).commonAncestorContainer);
}

/** Installs the selection keys for the diagram whose frame is `rootRef`. */
export function useSelectionKeys(rootRef: React.RefObject<HTMLElement | null>, handlers: SelectionKeyHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) lastPressed = root;
      else if (lastPressed === root) lastPressed = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.defaultPrevented || !answers(root, e)) return;
      const h = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const take = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
      if (mod && !e.altKey) {
        if ((key === "a" || key === "c") && root && pageTextSelected(root)) return;
        if (key === "a" && !e.shiftKey) return take(h.onSelectAll);
        if (key === "v" && !e.shiftKey) return take(h.onPaste);
        if (h.count === 0) return;
        if (key === "c" && !e.shiftKey) return take(h.onCopy);
        if (key === "x" && !e.shiftKey) return take(h.onCut);
        if (key === "d" && !e.shiftKey) return take(h.onDuplicate);
        return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey || h.count === 0) return;
      if (e.key === "Delete" || e.key === "Backspace") return take(h.onDelete);
      if (e.key === "Escape") return take(h.onClear);
      if ((e.key === "Enter" || e.key === "F2") && h.count === 1) return take(h.onEdit);
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") return take(() => h.onNudge(-step, 0));
      if (e.key === "ArrowRight") return take(() => h.onNudge(step, 0));
      if (e.key === "ArrowUp") return take(() => h.onNudge(0, -step));
      if (e.key === "ArrowDown") return take(() => h.onNudge(0, step));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPress, true);
      // Unmounted by now: forget a frame that is no longer on the page.
      if (lastPressed && !lastPressed.isConnected) lastPressed = null;
    };
  }, [rootRef]);
}

/** What a diagram tells the selection engine about itself. */
export interface ShapeSelectionOptions {
  view: ViewId;
  model: ProcessModel;
  /** Every shape the diagram draws, by item id: top-left corner and size. */
  rects: Map<string, Rect>;
  shellApi: RefObject<CanvasApi | null>;
  presenting: boolean;
  /** Whether this tab may edit (says why not when it may not). */
  canEdit: () => boolean;
  /** Draw these shapes at these top-left places while a drag lasts. */
  preview: (places: Record<string, { x: number; y: number }>) => void;
  /** The drag (or a nudge) is over: save these places as one undo step
   *  (repeats with the same `mergeKey` within a second are one step). */
  commit: (places: Record<string, { x: number; y: number }>, mergeKey?: string) => void;
  onDeleteMany: (ids: string[]) => void;
  /** Adds the clip as new items; returns their ids and places, or null. */
  onPaste: (clip: ShapeClip, dx: number, dy: number) => { ids: string[]; places: Record<string, NodeLayout> } | null;
  /** Front/back stacking for the bar (Process map only). */
  onBringToFront?: (id: string) => void;
  onSendToBack?: (id: string) => void;
  /** Rounds a place while dragging (the Process map snaps to its grid),
   *  where no other shape is close enough to line up with. */
  snap?: (v: number) => number;
}

/** Selection on one diagram: click, Shift-click, a box, dragging the
 *  selection, the keys (useSelectionKeys) and copy/paste. Returns the
 *  handlers to wire into the diagram and the pieces to draw. */
export function useShapeSelection(o: ShapeSelectionOptions) {
  const selection = useCanvasSelection(o.view);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef(o);
  latest.current = o;
  const selRef = useRef(selection.ids);
  selRef.current = selection.ids;

  // Shapes that are gone (deleted, undone) leave the selection.
  useEffect(() => {
    const live = selection.ids.filter((id) => o.rects.has(id));
    if (live.length !== selection.ids.length) selection.set(live);
  });
  // Presenting: nothing is selected.
  useEffect(() => { if (o.presenting) selection.clear(); }, [o.presenting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Places already asked for but not drawn yet: two nudges in one frame
  // must add up, not both start from the last drawn place.
  const ahead = useRef<Record<string, { x: number; y: number }>>({});
  useEffect(() => { ahead.current = {}; });
  const placesOf = (ids: string[]) => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const r = latest.current.rects.get(id);
      if (r) out[id] = ahead.current[id] ?? { x: r.x, y: r.y };
    }
    return out;
  };

  /** Moves `ids` with the pointer from a press, once it has moved a few
   *  pixels (less is a click). Saved on release, as one undo step. */
  // Snap guides: what is being moved lines up with the shapes around it
  // when it comes close, and thin lines show what it lined up with.
  const [guides, setGuides] = useState<Guide[]>([]);
  const showGuides = (next: Guide[]) => setGuides((cur) => (
    cur.length === next.length && cur.every((g, i) => g.axis === next[i].axis && g.at === next[i].at && g.from === next[i].from && g.to === next[i].to)
      ? cur : next
  ));
  const endGuides = () => showGuides([]);
  /** Where shapes being moved go: `raw` (top-left corners) lined up with
   *  another shape when one is within a few pixels on screen, and elsewhere
   *  rounded to the grid (Process map). Ctrl/Cmd held (`free`): as dragged. */
  const lineUp = (raw: Record<string, { x: number; y: number }>, free: boolean) => {
    const api = latest.current.shellApi.current;
    const grid = latest.current.snap;
    const rects = latest.current.rects;
    if (free || !api) { endGuides(); return raw; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [id, p] of Object.entries(raw)) {
      const r = rects.get(id);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + (r?.w ?? 0)); y1 = Math.max(y1, p.y + (r?.h ?? 0));
    }
    if (!Number.isFinite(x0)) { endGuides(); return raw; }
    const others = [...rects].filter(([id]) => !(id in raw)).map(([, r]) => r);
    // A few pixels on screen, whatever the zoom.
    const a = api.screenToWorld(0, 0), b = api.screenToWorld(GUIDE_REACH_PX, 0);
    const { dx, dy, guides: lines } = alignTo({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, others, Math.abs(b.x - a.x));
    showGuides(lines);
    return Object.fromEntries(Object.entries(raw).map(([id, p]) => [id, {
      x: dx !== null ? p.x + dx : grid ? grid(p.x) : p.x,
      y: dy !== null ? p.y + dy : grid ? grid(p.y) : p.y,
    }]));
  };

  /** Drags `ids` from a press; false when the canvas isn't ready to. */
  const dragFrom = (e: { pointerId: number; clientX: number; clientY: number }, ids: string[]) => {
    const api = latest.current.shellApi.current;
    if (!api) return false;
    const startAt = api.screenToWorld(e.clientX, e.clientY);
    const start = placesOf(ids);
    let moving = false, allowed = true;
    let last: Record<string, { x: number; y: number }> | null = null;
    const finish = () => { endGuides(); if (last) latest.current.commit(last); };
    followPointer(e, {
      move: (ev) => {
        if (!moving && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        if (!moving) { moving = true; allowed = latest.current.canEdit(); }
        if (!allowed) return;
        const p = api.screenToWorld(ev.clientX, ev.clientY);
        const dx = p.x - startAt.x, dy = p.y - startAt.y;
        const raw = Object.fromEntries(Object.entries(start).map(([id, s0]) => [id, { x: s0.x + dx, y: s0.y + dy }]));
        last = lineUp(raw, ev.metaKey || ev.ctrlKey);
        latest.current.preview(last);
      },
      up: finish,
      cancel: finish,
    });
    return true;
  };

  /** A press on a shape's body: select it (Shift: add or remove it), then
   *  drag the selection if the pointer moves. */
  const pressShape = (id: string, e: React.PointerEvent) => {
    if (e.button !== 0 || latest.current.presenting) return;
    const t = e.target as Element;
    // A press that began on a control in the shape (delete, a toggle, a
    // menu) is that control's; one inside a pop-up the shape opened reaches
    // here through React, not the page, and is the pop-up's.
    if (!(e.currentTarget as Node).contains(t) || t.closest("button, a, select, input, textarea, [data-no-pan]")) return;
    const cur = selRef.current;
    const was = cur.includes(id);
    if (e.shiftKey) {
      selection.toggle(id);
      if (was) return;
      dragFrom(e, [...cur, id]);
      return;
    }
    if (!was) selection.set([id]);
    dragFrom(e, was ? cur : [id]);
  };

  // The selection box: what it touches is selected (with Shift, added to
  // what was selected when it started).
  const boxBase = useRef<string[] | null>(null);
  const onSelectBox = (box: CanvasRect, done: boolean, additive: boolean) => {
    if (boxBase.current === null) boxBase.current = additive ? selRef.current : [];
    const rects = Object.fromEntries(latest.current.rects);
    const hit = shapesInBox(rects, boxBetween({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }));
    selection.set([...new Set([...boxBase.current, ...hit])]);
    if (done) boxBase.current = null;
  };
  const onBackgroundPress = () => selection.clear();

  // Copy and paste ask first before making new items (the owner's rule:
  // pasted shapes become new requirements).
  const [pending, setPending] = useState<{ clip: ShapeClip; dx: number; dy: number; left: number } | null>(null);
  const pasteRepeat = useRef<{ clip: ShapeClip | null; n: number }>({ clip: null, n: 0 });
  const copy = (ids: string[]) => {
    const clip = copyShapes(latest.current.model, latest.current.view, ids, placesOf(ids));
    if (clip) shapeClipboard.set(clip);
    return clip;
  };
  const boundsOf = (places: Record<string, { x: number; y: number }>, clip: ShapeClip) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { item } of clip.items) {
      const p = places[item.id];
      const r = latest.current.rects.get(item.id);
      if (!p) continue;
      const w = r?.w ?? 200, h = r?.h ?? 80;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + w); y1 = Math.max(y1, p.y + h);
    }
    return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };
  const askPaste = (clip: ShapeClip, dx: number, dy: number, left = 0) => {
    if (!latest.current.canEdit()) return;
    setPending({ clip, dx, dy, left });
  };
  const paste = () => {
    const held = shapeClipboard.get();
    if (!held) return;
    // Only what this diagram draws: states pasted on the Process map would
    // be added where no one can see them.
    const clip = clipForView(held, latest.current.view);
    if (!clip) {
      toast("This diagram can’t show those shapes", {
        description: "They were copied from a diagram that draws other kinds of item. Paste them back there.",
      });
      return;
    }
    // Where the person is looking: the copied group centred in view, each
    // repeat a little further along so pastes don't stack exactly.
    const rep = pasteRepeat.current;
    rep.n = rep.clip === held ? rep.n + 1 : 0;
    rep.clip = held;
    const seen = latest.current.shellApi.current?.visibleWorld();
    const b = boundsOf(clip.places, clip);
    const step = 24 * rep.n;
    const dx = seen && b ? seen.x + seen.w / 2 - (b.x + b.w / 2) + step : 40 + step;
    const dy = seen && b ? seen.y + seen.h / 2 - (b.y + b.h / 2) + step : 40 + step;
    askPaste(clip, dx, dy, held.items.length - clip.items.length);
  };
  const duplicate = () => {
    const clip = copy(selRef.current);
    if (clip) askPaste(clip, 40, 40);
  };
  const confirmPaste = () => {
    const p = pending;
    if (!p) return;
    const made = latest.current.onPaste(p.clip, p.dx, p.dy);
    if (made) selection.set(made.ids);
  };

  const remove = (ids: string[]) => {
    if (ids.length === 0 || !latest.current.canEdit()) return;
    latest.current.onDeleteMany(ids);
    selection.clear();
    // One model feeds several diagrams: say so when it is more than one thing.
    if (ids.length > 1) {
      toast(`Deleted ${ids.length} shapes`, {
        description: "They are gone from this artifact's other diagrams too. Undo with Ctrl/\u2318 Z.",
      });
    }
  };

  useSelectionKeys(frameRef, {
    count: o.presenting ? 0 : selection.ids.length,
    onDelete: () => remove(selRef.current),
    onNudge: (dx, dy) => {
      if (!latest.current.canEdit()) return;
      const moved = Object.fromEntries(Object.entries(placesOf(selRef.current)).map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]));
      Object.assign(ahead.current, moved);
      latest.current.preview(moved);
      latest.current.commit(moved, `nudge:${latest.current.view}`);
    },
    onSelectAll: () => { if (!latest.current.presenting) selection.set([...latest.current.rects.keys()]); },
    onClear: () => selection.clear(),
    onCopy: () => { copy(selRef.current); },
    onCut: () => { if (copy(selRef.current)) remove(selRef.current); },
    onPaste: () => { if (!latest.current.presenting) paste(); },
    onDuplicate: duplicate,
    onEdit: () => {
      const id = selRef.current[0];
      const el = frameRef.current?.querySelector(`[data-node-id="${CSS.escape(id)}"] [data-edit-text], [data-shape-id="${CSS.escape(id)}"] [data-edit-text]`);
      el?.dispatchEvent(new Event(EDIT_TEXT_EVENT));
    },
  });

  const n = pending?.clip.items.length ?? 0;
  const left = pending?.left ?? 0;
  // Steps feed the DFD, RACI and Activity too; states only the State diagram.
  const elsewhere = !!pending?.clip.items.some((x) => x.list !== "states");
  const pasteDialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(open) => { if (!open) setPending(null); }}
      tone="default"
      title={n === 1 ? "Paste this shape as a new item?" : `Paste these ${n} shapes as new items?`}
      consequence={<>
        {n === 1
          ? <>It is added to this artifact as a new item marked “Added by you”{elsewhere && ", and shows up in its other diagrams too"}.</>
          : <>They are added to this artifact as new items marked “Added by you”{elsewhere && ", and show up in its other diagrams too"}. Lines between them come along.</>}
        {left > 0 && <> {left === 1 ? "1 copied shape is" : `${left} copied shapes are`} left out: this diagram doesn’t draw {left === 1 ? "it" : "them"}.</>}
      </>}
      confirmLabel={n === 1 ? "Paste as a new item" : "Paste as new items"}
      cancelLabel="Cancel"
      doing="paste the shapes"
      onConfirm={confirmPaste}
    />
  );

  return {
    selection, frameRef, pressShape, onSelectBox, onBackgroundPress, pasteDialog,
    /** For a grip: drag these shapes (with snap guides). */
    dragSelection: dragFrom,
    /** The snap guides to draw (SnapGuides), and for a drag this engine
     *  doesn't run: line its shapes up, then end the guides when it ends. */
    guides, lineUp, endGuides,
    actions: {
      remove: () => remove(selRef.current),
      duplicate,
      bringToFront: o.onBringToFront ? () => selRef.current.forEach((id) => o.onBringToFront!(id)) : undefined,
      sendToBack: o.onSendToBack ? () => selRef.current.forEach((id) => o.onSendToBack!(id)) : undefined,
    },
  };
}

/** Outlines round the selected shapes, drawn in the canvas (inside
 *  CanvasShell). Editing chrome: hidden while presenting and in downloads. */
/** How close, in pixels on screen, a moving edge or middle must come to
 *  another shape's to line up with it. */
const GUIDE_REACH_PX = 6;

/** The snap guides: thin lines across what a moving shape lines up with,
 *  one screen pixel wide whatever the zoom. */
export function SnapGuides({ guides }: { guides: Guide[] }) {
  const { zoom } = useCanvas();
  const t = 1 / zoom, over = 8 / zoom;
  return (
    <>
      {guides.map((g) => (
        <div
          key={`${g.axis}:${g.at}`} data-edit-control aria-hidden
          className="pointer-events-none absolute bg-primary"
          style={g.axis === "x"
            ? { left: g.at - t / 2, top: g.from - over, width: t, height: g.to - g.from + over * 2, zIndex: 960 }
            : { top: g.at - t / 2, left: g.from - over, height: t, width: g.to - g.from + over * 2, zIndex: 960 }}
        />
      ))}
    </>
  );
}

export function SelectionOutlines({ ids, rects }: { ids: string[]; rects: Map<string, Rect> }) {
  return (
    <>
      {ids.map((id) => {
        const r = rects.get(id);
        if (!r) return null;
        return (
          <div
            key={id} data-edit-control aria-hidden
            className="pointer-events-none absolute rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background"
            style={{ left: r.x - 3, top: r.y - 3, width: r.w + 6, height: r.h + 6, zIndex: 900 }}
          />
        );
      })}
    </>
  );
}

/** A small bar above the selection: how many, and what can be done to them.
 *  Drawn in the canvas at a constant size whatever the zoom. */
export function SelectionBar({
  ids, rects, actions,
}: {
  ids: string[];
  rects: Map<string, Rect>;
  actions: { remove: () => void; duplicate: () => void; bringToFront?: () => void; sendToBack?: () => void };
}) {
  const { zoom } = useCanvas();
  const boxes = ids.map((id) => rects.get(id)).filter((r): r is Rect => !!r);
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((r) => r.x)), y0 = Math.min(...boxes.map((r) => r.y));
  const x1 = Math.max(...boxes.map((r) => r.x + r.w));
  const btn = "h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground";
  const bar: ReactNode = (
    <div className="flex items-center gap-0.5 rounded-lg border bg-card px-1 py-0.5 shadow-md">
      {ids.length > 1 && <span className="px-1.5 text-xs text-muted-foreground tabular-nums">{ids.length} selected</span>}
      <button type="button" className={btn} onClick={actions.duplicate} title="Duplicate (Ctrl/⌘ D)" aria-label="Duplicate"><Copy className="size-3.5" /></button>
      {actions.bringToFront && <button type="button" className={btn} onClick={actions.bringToFront} title="Bring to front" aria-label="Bring to front"><ArrowUpToLine className="size-3.5" /></button>}
      {actions.sendToBack && <button type="button" className={btn} onClick={actions.sendToBack} title="Send to back" aria-label="Send to back"><ArrowDownToLine className="size-3.5" /></button>}
      <button type="button" className={btn + " hover:text-destructive"} onClick={actions.remove} title="Delete (Delete key)" aria-label={ids.length > 1 ? `Delete ${ids.length} shapes` : "Delete"}><Trash2 className="size-3.5" /></button>
    </div>
  );
  return (
    <div
      data-edit-control data-no-pan
      className="absolute"
      // Centred above the selection, counter-scaled so it reads the same at any zoom.
      style={{ left: (x0 + x1) / 2, top: y0 - 10, transform: `translate(-50%, -100%) scale(${1 / zoom})`, transformOrigin: "bottom center", zIndex: 950 }}
      onPointerDown={(e) => e.stopPropagation()}
      // Pressing a button here leaves keyboard focus where it was, so the
      // selection keys keep working afterwards.
      onMouseDown={(e) => e.preventDefault()}
    >
      {bar}
    </div>
  );
}

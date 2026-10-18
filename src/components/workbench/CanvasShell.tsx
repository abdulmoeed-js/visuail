import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from "react";
import { Maximize2, ZoomIn, ZoomOut, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCanvasViewStore } from "./canvas-view-store";
import { isTypingTarget, useArtifactFullscreen } from "./artifact-fullscreen";
import { gridSpacing, pinchView, visibleWorld, wheelPixels, worldOf, zoomAbout, type Point } from "@/lib/canvas/camera";

interface CanvasState {
  zoom: number;
  pan: { x: number; y: number };
}
/** What a canvas's children can read. `gliding` is true while the camera is
 *  being animated to a new position; anything that counter-moves against the
 *  camera (a pinned lane header) must animate with the same timing or it
 *  visibly runs ahead of the diagram for the length of the glide. Everything
 *  that reads this re-renders on every frame of a pan or zoom, so only read
 *  it for what is drawn; a drag on a shape uses useWorldDrag instead. */
interface CanvasContext extends CanvasState { gliding: boolean }
const CanvasCtx = createContext<CanvasContext>({ zoom: 1, pan: { x: 0, y: 0 }, gliding: false });
export const useCanvas = () => useContext(CanvasCtx);
/** The world point under a pointer, by the camera as it is at that moment.
 *  Stable, so it can be kept in a drag's closure. */
const ToWorldCtx = createContext<(clientX: number, clientY: number) => Point>((x, y) => ({ x, y }));

/** Fired on the document when two fingers start pinching a canvas: any shape
 *  drag, resize or connection the first finger started stops there. */
export const CANVAS_PINCH_EVENT = "visu:canvas-pinch";

/** Follows the pointer that pressed a shape's handle until it lets go. Only
 *  that pointer counts (a second finger is a pinch, not part of the drag).
 *  It ends with `up` on release, or with `cancel` when the browser cancels
 *  the pointer or a pinch starts -- then nothing is completed: no
 *  connection made, no drop. Returns a function that stops following. */
export function followPointer(
  press: { pointerId: number },
  h: { move: (ev: PointerEvent) => void; up?: (ev: PointerEvent) => void; cancel?: () => void },
): () => void {
  const id = press.pointerId;
  const move = (ev: PointerEvent) => { if (ev.pointerId === id) h.move(ev); };
  const up = (ev: PointerEvent) => { if (ev.pointerId !== id) return; stop(); h.up?.(ev); };
  const cancel = (ev: Event) => {
    if (ev instanceof PointerEvent && ev.pointerId !== id) return;
    stop();
    h.cancel?.();
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    document.removeEventListener(CANVAS_PINCH_EVENT, cancel);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  document.addEventListener(CANVAS_PINCH_EVENT, cancel);
  return stop;
}

/** A drag on a shape's handle, in diagram units: `onMove(dx, dy)` gets the
 *  distance from where the press started, measured in the diagram, so the
 *  shape stays under the pointer even if the view pans or zooms mid-drag. */
export function useWorldDrag() {
  const toWorld = useContext(ToWorldCtx);
  return (
    press: React.PointerEvent,
    onMove: (dx: number, dy: number) => void,
    end?: { up?: (ev: PointerEvent) => void; cancel?: () => void },
  ) => {
    try { (press.currentTarget as HTMLElement).setPointerCapture(press.pointerId); } catch { /* pointer already gone */ }
    const start = toWorld(press.clientX, press.clientY);
    return followPointer(press, {
      move: (ev) => { const p = toWorld(ev.clientX, ev.clientY); onMove(p.x - start.x, p.y - start.y); },
      up: end?.up,
      cancel: end?.cancel,
    });
  };
}
/** The transition the canvas content uses while gliding. */
export const CANVAS_GLIDE_CLASS = "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out";

/** A rectangle in canvas-content coordinates -- the unscaled space nodes are laid out in. */
export interface CanvasRect { x: number; y: number; w: number; h: number }

/** The smallest rectangle containing all of `rects` (which must not be empty). */
export function boundsOf(rects: CanvasRect[]): CanvasRect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** What to bring into view. `axis: "x"` moves the camera sideways only --
 *  for something that spans or is pinned along the other axis, like a lane. */
export type RevealTarget = CanvasRect & { axis?: "x" | "both" };

/** Imperative handle a view can hold to move the camera. */
export interface CanvasApi {
  /** Bring a content rectangle into the visible, unobstructed part of the
   *  canvas by panning; does nothing at all when it is already there (the
   *  camera is not marked as moved). Zooms in as well
   *  only when the canvas is zoomed out too far to read anything at all
   *  (after "Fit" on a big diagram) -- a zoom the person chose that is merely
   *  smaller than the opening zoom is left alone. */
  reveal: (target: RevealTarget) => void;
  fitView: () => void;
  /** The world point under a pointer at (clientX, clientY). */
  screenToWorld: (clientX: number, clientY: number) => Point;
  /** The part of the world the camera shows now (for placing something new
   *  where the person is looking). */
  visibleWorld: () => CanvasRect;
}

interface Props {
  contentWidth: number;
  contentHeight: number;
  children: ReactNode;
  toolbar?: ReactNode;              // extra buttons rendered top-left
  bottomLeft?: ReactNode;           // legend etc.
  bottomRight?: ReactNode;          // e.g. Add step
  overlay?: ReactNode;              // extra absolute-positioned UI inside the shell (above viewport)
  onCanvasDrop?: (canvasX: number, canvasY: number, e: React.DragEvent) => void;
  minimap?: boolean;
  gridClassName?: string;
  minZoom?: number;
  maxZoom?: number;
  fullscreenLabel?: string;
  /** Stable name for this view inside its artifact (e.g. "process", "dfd").
   *  When set and a CanvasViewStoreProvider is above, zoom and pan survive the
   *  view unmounting on a tab switch. */
  viewId?: string;
  /** "readable" (default) never opens below `readableZoom`: a diagram that
   *  fits at that size or larger opens whole, exactly as before; one that does
   *  not opens AT that size on its start, instead of being shrunk to fit.
   *  "fit" always shows everything, however small -- right for an overview
   *  like the project board. */
  initialView?: "readable" | "fit";
  readableZoom?: number;
  /** Where the diagram starts (e.g. the first node). Used to aim the opening
   *  view when the whole diagram does not fit at a readable size. */
  initialFocus?: CanvasRect;
  /** Extra space reserved on the left for an overlay the view draws itself
   *  (an open shape palette), so content is not placed underneath it. */
  leftInset?: number;
  apiRef?: MutableRefObject<CanvasApi | null>;
  /** The rectangle the diagram's shapes actually occupy, when the view knows
   *  it; `null` when nothing is drawn yet. The content size above is a padded
   *  sheet with a minimum size, so "is part of the diagram out of view?"
   *  cannot be judged from it: a blank sheet would count as cut off. Left
   *  out, it is worked out from `shapes`, or else the whole sheet is assumed
   *  to be the diagram. Shapes may lie outside the sheet, left of or above
   *  it too: the canvas has no edges, and fit, the minimap and downloads
   *  cover the sheet and every shape together. */
  drawnBounds?: CanvasRect | null;
  /** Every shape's rectangle, drawn in the minimap. */
  shapes?: CanvasRect[];
}

const EDGE = 16;                 // breathing room between content and the canvas edge
/** Height of the row the zoom toolbar (and any top-left control) occupies.
 *  Content is aimed to start below it; views that pin something to the top of
 *  the visible canvas (activity lane headers) pin it here. */
export const CANVAS_TOP_INSET = 56;
const TOP_BAR = CANVAS_TOP_INSET;
const BAR_GAP = 8;               // space kept clear above the bottom bar
// Below this the minimap costs more than it gives: it takes ~170px of the
// bottom row, which on a narrow canvas pushes the legend and actions onto
// extra rows over the diagram.
const MINIMAP_MIN_WIDTH = 700;
const SETTLE_MS = 1200;          // how long after opening the view may still re-aim as content measures
const GLIDE_MS = 320;
// Below this nothing on a canvas can be read, so a reveal zooms in. Lower than
// the opening floor on purpose: 60-79% is a zoom people pick deliberately.
const ILLEGIBLE_ZOOM = 0.5;
const RESTORE_CHECK_MS = 200;    // let content measure before judging a restored camera

export function CanvasShell({
  contentWidth, contentHeight, children,
  toolbar, bottomLeft, bottomRight, overlay, onCanvasDrop, minimap,
  gridClassName = "bp-grid",
  minZoom = 0.2, maxZoom = 3,
  fullscreenLabel = "Diagram canvas",
  viewId, initialView = "readable", readableZoom = 0.8, initialFocus, leftInset = 0, apiRef, drawnBounds, shapes,
}: Props) {
  // What is drawn, and the world the camera has to cover: the sheet plus any
  // shape outside it (see drawnBounds).
  const drawn: CanvasRect | null = drawnBounds !== undefined ? drawnBounds
    : shapes ? (shapes.length > 0 ? boundsOf(shapes) : null)
    : { x: 0, y: 0, w: contentWidth, h: contentHeight };
  const world = worldOf(contentWidth, contentHeight, drawn);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const slotsRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);

  const store = useCanvasViewStore();
  const storeKey = viewId ? `shell:${viewId}` : null;

  // One state object, not separate zoom/pan: every camera move is a single
  // pure update, which is also what gets parked in the view store.
  const saved = storeKey
    ? (store?.get(storeKey) as (CanvasState & { moved?: boolean; frame?: { w: number; h: number } }) | undefined)
    : undefined;
  const [view, setView] = useState<CanvasState>(() =>
    saved ? { zoom: saved.zoom, pan: saved.pan } : { zoom: 1, pan: { x: 40, y: 40 } });
  const { zoom, pan } = view;
  // Whether the person has taken the camera since it was aimed for them.
  // Parked with the camera, so a trip to another tab does not forget it.
  const [moved, setMoved] = useState<boolean>(() => saved?.moved ?? false);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [gliding, setGliding] = useState(false);
  // Full screen and Present mode belong to the artifact this canvas sits in.
  const afs = useArtifactFullscreen();
  const presenting = !!afs?.presenting;

  // Lifecycle of the opening view. `ready` flips once a real viewport size
  // has been seen; `restored` means the camera came from the store and must
  // not be re-aimed; `touched` means the person (or a reveal) has moved it.
  const lifeRef = useRef<{
    ready: boolean; restored: boolean; touched: boolean; at: number; restoreChecked: boolean;
  } | null>(null);
  if (!lifeRef.current) {
    const has = !!(storeKey && store?.has(storeKey));
    // A camera saved before the person ever moved it was aimed for them, so
    // it may be aimed again for a different frame (full screen on another tab).
    lifeRef.current = { ready: has, restored: has, touched: has && saved?.moved !== false, at: 0, restoreChecked: false };
  }
  const life = lifeRef.current;

  const clampZoom = (z: number) => Math.min(maxZoom, Math.max(minZoom, z));
  /** The person (or a reveal on their behalf) has taken the camera. */
  const touch = () => { life.touched = true; setMoved(true); };

  /** The part of the viewport content may occupy without sitting under the
   *  toolbar row, the bottom bar, or a view-drawn left overlay. */
  const safeArea = (w: number, h: number) => {
    const barH = slotsRef.current?.offsetHeight ?? 0;
    // Honour the view's left overlay only while that still leaves a usable
    // canvas. On a narrow one (an open palette on a phone-width demo) the
    // overlay simply sits over the content; reserving its width would leave a
    // sliver, and "fit" would shrink the whole diagram into it.
    const inset = leftInset > 0 && w - leftInset - 2 * EDGE >= Math.max(320, w * 0.5) ? leftInset : 0;
    const l = EDGE + inset;
    const b = barH > 0 ? 12 + barH + BAR_GAP : EDGE;
    return { l, t: TOP_BAR, w: Math.max(40, w - l - EDGE), h: Math.max(40, h - TOP_BAR - b) };
  };

  const fitAll = (w: number, h: number): CanvasState => {
    const s = safeArea(w, h);
    const z = clampZoom(Math.min(1, s.w / world.w, s.h / world.h));
    return { zoom: z, pan: { x: s.l + Math.max(0, (s.w - world.w * z) / 2) - world.x * z, y: s.t - world.y * z } };
  };

  /** Opening view. If the whole diagram fits at a readable size, show all of
   *  it (unchanged behaviour). Otherwise do NOT shrink it into an illegible
   *  thumbnail: open at the readable floor, aimed at where the diagram
   *  starts. One continuous rule -- zoom is the whole-fit zoom, never below
   *  the floor -- so a diagram one row taller does not open at a visibly
   *  different size. "Fit to view" still shows everything on demand. */
  const openingView = (w: number, h: number): CanvasState => {
    const all = fitAll(w, h);
    if (initialView === "fit" || all.zoom >= readableZoom) return all;
    const s = safeArea(w, h);
    const z = clampZoom(Math.min(1, readableZoom));
    const scaledW = world.w * z;
    // Where the world's left and top edges sit when aligned to the safe area.
    const left = s.l - world.x * z, top = s.t - world.y * z;
    let x = left;
    if (scaledW <= s.w) {
      x = left + (s.w - scaledW) / 2;
    } else if (initialFocus) {
      const centred = s.l + s.w / 2 - (initialFocus.x + initialFocus.w / 2) * z;
      x = Math.min(left, Math.max(left + s.w - scaledW, centred));
    }
    const y = initialFocus ? Math.min(top, s.t + 8 - initialFocus.y * z) : top;
    return { zoom: z, pan: { x, y } };
  };

  // Only moves that keep the zoom are animated. The content layer animates
  // its translate and scale together, and anything pinned against the camera
  // (activity lane headers) counter-moves by an amount that depends on both;
  // under a plain transition it cannot hold still through a zoom change, and
  // swung out of the frame and back. A zoom change jumps, as every camera
  // move did before glides existed.
  const glideTimer = useRef<number | null>(null);
  const glide = () => {
    setGliding(true);
    if (glideTimer.current !== null) window.clearTimeout(glideTimer.current);
    glideTimer.current = window.setTimeout(() => setGliding(false), GLIDE_MS);
  };
  useEffect(() => () => {
    if (glideTimer.current !== null) window.clearTimeout(glideTimer.current);
  }, []);

  // The frame size the camera was last aimed for; parked with the camera so a
  // view restored into a different-sized frame (a tab opened in full screen)
  // is re-aimed or re-centred like any other resize.
  const lastSize = useRef<{ w: number; h: number } | null>(saved?.frame ?? null);
  const measure = () => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // A pane that has just been hidden reports 0x0. Keep the last real size:
    // recording the zero made every RETURN to an already-opened artifact
    // paint one frame with the diagram hidden and the minimap missing.
    if (r.width === 0 || r.height === 0) return;
    setVp((p) => (p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
    // A shell can mount with no size at all -- the first frame of a freshly
    // opened canvas, or a pane that is not the visible one. Aiming the camera
    // from a 0-wide viewport used to produce a negative scale (an upside-down
    // canvas). Wait for a real size instead; the observer below calls back
    // the moment the shell is actually laid out, however long that takes.
    if (r.width < 80 || r.height < 80) return;
    if (!life.ready) {
      life.ready = true;
      life.at = performance.now();
      lastSize.current = { w: r.width, h: r.height };
      setView(openingView(r.width, r.height));
      return;
    }
    // The frame changed size (full screen on or off, a window resize). A
    // camera the person never moved is aimed afresh for the new frame, so
    // entering full screen shows the diagram fitted to it; one they did move
    // keeps the same point in the middle, so nobody loses their place.
    const prev = lastSize.current;
    lastSize.current = { w: r.width, h: r.height };
    if (!prev || (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1)) return;
    if (!life.touched) {
      setView(openingView(r.width, r.height));
    } else {
      const dx = (r.width - prev.w) / 2, dy = (r.height - prev.h) / 2;
      setView((v) => ({ zoom: v.zoom, pan: { x: v.pan.x + dx, y: v.pan.y + dy } }));
    }
  };

  /** A restored camera is trusted, with one check: if it no longer shows any
   *  of the diagram (the content shrank under an undo, the window was resized
   *  while on another tab) it is no use, so start over. Run a moment AFTER
   *  mount, not at it: on the first frame nodes have not reported their real
   *  heights, the diagram looks shorter than it is, and a camera parked near
   *  the bottom of a long flow would be thrown away for no reason. */
  const checkRestoredView = () => {
    if (!life.restored || life.restoreChecked) return;
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return;
    life.restoreChecked = true;
    const s = safeArea(r.width, r.height);
    const seenW = Math.min(pan.x + (world.x + world.w) * zoom, s.l + s.w) - Math.max(pan.x + world.x * zoom, s.l);
    const seenH = Math.min(pan.y + (world.y + world.h) * zoom, s.t + s.h) - Math.max(pan.y + world.y * zoom, s.t);
    if (seenW < 80 || seenH < 80) {
      life.restored = false;
      life.touched = false;
      life.at = performance.now();
      setMoved(false);
      setView(openingView(r.width, r.height));
    }
  };

  const fitView = () => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return;
    const next = fitAll(r.width, r.height);
    touch();
    if (Math.abs(next.zoom - zoom) < 0.001) glide();
    setView(next);
  };

  const reveal = (target: RevealTarget) => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return;
    const s = safeArea(r.width, r.height);
    const M = 12;
    const rect = target;
    const sideways = target.axis === "x";
    // The minimap is not part of the safe area (it is one corner, not a
    // whole edge), so it is checked on its own below.
    const mm = minimapRef.current?.getBoundingClientRect();
    const corner = mm ? { l: mm.left - r.left, t: mm.top - r.top } : null;
    const v = view;
    let next: CanvasState = v;
    if (v.zoom < Math.min(readableZoom, ILLEGIBLE_ZOOM)) {
      // Zoomed out so far that nothing is readable: come in, centred on the
      // target. (Sideways-only: whatever content sits at the top of the safe
      // area stays exactly there.)
      const z = clampZoom(readableZoom);
      next = {
        zoom: z,
        pan: {
          x: s.l + s.w / 2 - (rect.x + rect.w / 2) * z,
          y: sideways
            ? s.t - ((s.t - v.pan.y) / v.zoom) * z
            : s.t + s.h / 2 - (rect.y + rect.h / 2) * z,
        },
      };
    } else {
      const z = v.zoom;
      let { x, y } = v.pan;
      const left = x + rect.x * z, right = left + rect.w * z;
      const top = y + rect.y * z, bottom = top + rect.h * z;
      // Per axis: leave it alone when it is inside the safe area, measured to
      // the bare edges -- content the opening view parked exactly at the top
      // IS in view. Otherwise centre it, or pin its start edge with a small
      // margin when it is larger than the room available.
      if (left < s.l || right > s.l + s.w) {
        x = rect.w * z > s.w - 2 * M ? s.l + M - rect.x * z : s.l + s.w / 2 - (rect.x + rect.w / 2) * z;
      }
      if (!sideways && (top < s.t || bottom > s.t + s.h)) {
        y = rect.h * z > s.h - 2 * M ? s.t + M - rect.y * z : s.t + s.h / 2 - (rect.y + rect.h / 2) * z;
      }
      // In view by the test above, but tucked under the minimap: centre it.
      if (!sideways && corner && x + (rect.x + rect.w) * z > corner.l && y + (rect.y + rect.h) * z > corner.t) {
        x = s.l + s.w / 2 - (rect.x + rect.w / 2) * z;
        y = s.t + s.h / 2 - (rect.y + rect.h / 2) * z;
      }
      if (x !== v.pan.x || y !== v.pan.y) next = { zoom: z, pan: { x, y } };
    }
    // Already where it needs to be: the camera has not been taken from the
    // person, so nothing about it is marked as moved.
    if (next === v) return;
    touch();
    if (next.zoom === v.zoom) glide();
    setView(next);
  };

  /** Keyboard focus landing on something the camera is not showing. The
   *  frame itself must not scroll to it (see the onScroll reset on the root),
   *  so the camera goes instead -- otherwise Tab walks focus onto controls
   *  nobody can see, one of which is a delete button. Keyboard only: moving
   *  the camera under a pointer between press and click would slide the
   *  control out from under it. */
  const followFocus = (target: EventTarget | null) => {
    const content = contentRef.current;
    if (!content || !(target instanceof HTMLElement) || !content.contains(target)) return;
    const enclosing = target.closest<HTMLElement>("[data-node], [data-canvas-pinned]") ?? target;
    const c = content.getBoundingClientRect();
    const frame = viewportRef.current?.getBoundingClientRect();
    const whole = enclosing.getBoundingClientRect();
    // Show the whole node when it fits; when it is bigger than the frame (a
    // tall BMC block, anything zoomed in), showing its top-left corner would
    // leave the focused field itself out of view, so aim at the field.
    // "Fits" by the same measure reveal() uses to decide between centring a
    // rectangle and pinning its top-left corner: the safe area, less a margin.
    const area = frame ? safeArea(frame.width, frame.height) : null;
    const fits = !area || (whole.width <= area.w - 24 && whole.height <= area.h - 24);
    const node = fits ? enclosing : target;
    const n = node.getBoundingClientRect();
    const z = view.zoom || 1;
    reveal({
      x: (n.left - c.left) / z, y: (n.top - c.top) / z, w: n.width / z, h: n.height / z,
      axis: enclosing.hasAttribute("data-canvas-pinned") ? "x" : "both",
    });
  };

  // The observer, the key listener and the imperative handle are registered
  // once but must always run the latest closures (current content size,
  // insets, props). Declared before the effects that call through it.
  // zoomTo is declared further down; the layout effect fills it in before
  // any listener can fire.
  const latest = useRef({
    measure, fitView, reveal, checkRestoredView, touch, followFocus, clampZoom,
    zoomBy: (_d: number) => {}, zoomTo: (_z: number) => {}, fullscreen: false,
  });
  useLayoutEffect(() => {
    latest.current = {
      measure, fitView, reveal, checkRestoredView, touch, followFocus, clampZoom,
      zoomBy: (d: number) => zoomTo((z) => +(z + d).toFixed(2)),
      zoomTo: (z: number) => zoomTo(z),
      fullscreen: !!afs?.active,
    };
  });
  // The camera as of the last render, for listeners that run between renders
  // (gestures, the imperative handle).
  const viewRef = useRef(view);
  viewRef.current = view;
  // Stable: drags keep it in their closures and call it on every move.
  const toWorld = useRef((clientX: number, clientY: number): Point => {
    const r = viewportRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.pan.x) / v.zoom, y: (clientY - (r?.top ?? 0) - v.pan.y) / v.zoom };
  }).current;

  // Was the last thing the person did a Tab press? Tracked on the window:
  // the Tab that brings focus INTO the canvas is pressed outside it.
  const tabbing = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Tab") tabbing.current = true; };
    const onPointer = () => { tabbing.current = false; };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  useEffect(() => {
    if (!life.restored) return;
    const t = window.setTimeout(() => latest.current.checkRestoredView(), RESTORE_CHECK_MS);
    return () => window.clearTimeout(t);
  }, [life]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    latest.current.measure();
    const ro = new ResizeObserver(() => latest.current.measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Content size is rarely final on the first frame: nodes report their real
  // heights a frame later and the BMC measures its grid after mount. Re-aim
  // the opening view while that settles, but never once the person has moved
  // the camera, and never for a restored view.
  useEffect(() => {
    if (!life.ready || life.restored || life.touched) return;
    if (performance.now() - life.at > SETTLE_MS) return;
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return;
    setView(openingView(r.width, r.height));
    // leftInset is here because the person can open or close the shape
    // palette inside the settle window, which changes the room available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.x, world.y, world.w, world.h, leftInset]);

  useEffect(() => {
    if (storeKey && store && life.ready) store.set(storeKey, { ...view, moved, frame: lastSize.current ?? undefined });
  }, [store, storeKey, view, moved, life]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      reveal: (target) => latest.current.reveal(target),
      fitView: () => latest.current.fitView(),
      screenToWorld: (clientX, clientY) => toWorld(clientX, clientY),
      visibleWorld: () => {
        const r = viewportRef.current?.getBoundingClientRect();
        return visibleWorld(viewRef.current, r?.width ?? 0, r?.height ?? 0);
      },
    };
    return () => { apiRef.current = null; };
    // toWorld never changes; listed so the rule can see it.
  }, [apiRef, toWorld]);

  /** Zoom keeping a viewport point fixed -- the centre unless told otherwise,
   *  so the toolbar buttons no longer slide the diagram out from under you. */
  const zoomTo = (next: number | ((z: number) => number), at?: { x: number; y: number }) => {
    const r = viewportRef.current?.getBoundingClientRect();
    const cx = at?.x ?? (r ? r.width / 2 : 0);
    const cy = at?.y ?? (r ? r.height / 2 : 0);
    touch();
    setView((v) => {
      const nz = clampZoom(typeof next === "function" ? next(v.zoom) : next);
      if (nz === v.zoom) return v;
      const k = nz / v.zoom;
      return { zoom: nz, pan: { x: cx - (cx - v.pan.x) * k, y: cy - (cy - v.pan.y) * k } };
    });
  };

  // Keys for the canvas on screen. Several canvases can be mounted at once
  // (the project page keeps every artifact loaded and hides all but one), so
  // a canvas only answers while it is visible, and while full screen only the
  // one inside the full-screen element does. Ctrl/Cmd+0 has always fitted;
  // the plain keys work when the canvas has focus or is full screen, so they
  // never fight the page or a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isLive(rootRef.current)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "0" || e.code === "Digit0")) {
        e.preventDefault(); latest.current.fitView(); return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const root = rootRef.current;
      const engaged = latest.current.fullscreen || (!!root && root.contains(document.activeElement));
      if (!engaged) return;
      // Shift+digit by physical key first: on many European layouts Shift+0
      // types "=", which would otherwise read as zoom in.
      if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); latest.current.fitView(); }
      else if (e.shiftKey && e.code === "Digit0") { e.preventDefault(); latest.current.zoomTo(1); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); latest.current.zoomBy(0.1); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); latest.current.zoomBy(-0.1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One drag that is moving the camera, by the pointer that started it.
  const dragRef = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  // Fingers on the canvas, and the pinch or Safari trackpad gesture under way.
  const gestureRef = useRef<{
    touches: Map<number, Point>;
    pinch: { start: CanvasState; mid: Point; dist: number } | null;
    /** The view the pinch last set: viewRef lags a render behind. */
    last: CanvasState | null;
    safari: { start: CanvasState; at: Point } | null;
  }>({ touches: new Map(), pinch: null, last: null, safari: null });
  // Space held over the canvas: every drag pans, as in other whiteboards.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const hoverRef = useRef(false);

  // Wheel and trackpad. Non-passive, so a zoom can stop the browser zooming
  // the page instead (React's onWheel is passive). Ctrl/Cmd+wheel zooms: that
  // is also what Chrome, Edge and Firefox send for a trackpad pinch. A plain
  // wheel pans, which is how a trackpad's two-finger scroll moves around.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Safari's own pinch is under way (below); don't zoom twice.
      if (gestureRef.current.safari) return;
      latest.current.touch();
      const d = wheelPixels(e, el.clientHeight);
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect();
        const px = e.clientX - box.left, py = e.clientY - box.top;
        const factor = Math.exp(-d.y * 0.0018);
        setView((v) => zoomAbout(v, latest.current.clampZoom(v.zoom * factor), px, py));
      } else {
        setView((v) => ({ zoom: v.zoom, pan: { x: v.pan.x - d.x, y: v.pan.y - d.y } }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Two fingers, the middle button, Space+drag and Safari's trackpad pinch.
  // Listened for on the way DOWN to the shapes (capture), so they win over a
  // shape's own handlers: a second finger, a middle-button press or a press
  // with Space held never starts moving or editing a shape.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const g = gestureRef.current;
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const spread = () => {
      const [a, b] = [...g.touches.values()];
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    };
    const startPan = (e: PointerEvent) => {
      const v = viewRef.current;
      dragRef.current = { id: e.pointerId, x: v.pan.x, y: v.pan.y, startX: e.clientX, startY: e.clientY };
      try { el.setPointerCapture(e.pointerId); } catch { /* already released */ }
    };
    // From where the camera is now and where the fingers are now: whenever a
    // finger joins or leaves, so the view never jumps to a new pair.
    const rebase = () => { g.pinch = { start: g.last ?? viewRef.current, ...spread() }; };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        g.touches.set(e.pointerId, local(e));
        if (g.touches.size < 2) return;
        // A second finger: pinch from here. A one-finger pan stops, and so
        // does anything the first finger started on a shape (a drag, a
        // resize, a connection), which the shapes hear about through this.
        e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch { /* already released */ }
        if (!g.pinch) {
          dragRef.current = null;
          g.last = viewRef.current;
          latest.current.touch();
          document.dispatchEvent(new Event(CANVAS_PINCH_EVENT));
        }
        rebase();
        return;
      }
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault();
        e.stopPropagation();
        startPan(e);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !g.touches.has(e.pointerId)) return;
      g.touches.set(e.pointerId, local(e));
      if (!g.pinch || g.touches.size < 2) return;
      const { mid, dist } = spread();
      const p = g.pinch;
      g.last = pinchView(p.start, p.mid, p.dist, mid, dist, latest.current.clampZoom);
      setView(g.last);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      g.touches.delete(e.pointerId);
      if (!g.pinch) return;
      if (g.touches.size >= 2) { rebase(); return; }
      g.pinch = null;
      g.last = null;
      // One finger still down: carry on panning with it, from where it is.
      const rest = [...g.touches.entries()][0];
      if (rest) {
        const r = el.getBoundingClientRect();
        const v = viewRef.current;
        dragRef.current = { id: rest[0], x: v.pan.x, y: v.pan.y, startX: rest[1].x + r.left, startY: rest[1].y + r.top };
      }
    };
    // The middle button would otherwise start the browser's autoscroll.
    const middle = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    // Safari (Mac trackpad) pinches with its own gesture events, not
    // ctrl+wheel; on an iPhone or iPad they come alongside the two touches
    // handled above, so there they only need stopping from zooming the page.
    type GestureLike = Event & { scale: number; clientX: number; clientY: number };
    const gStart = (ev: Event) => {
      ev.preventDefault();
      if (g.touches.size >= 2) return;
      g.safari = { start: viewRef.current, at: local(ev as GestureLike) };
      latest.current.touch();
    };
    const gChange = (ev: Event) => {
      ev.preventDefault();
      const s = g.safari;
      if (!s || g.touches.size >= 2) return;
      const scale = (ev as GestureLike).scale;
      setView(zoomAbout(s.start, latest.current.clampZoom(s.start.zoom * scale), s.at.x, s.at.y));
    };
    const gEnd = (ev: Event) => { ev.preventDefault(); g.safari = null; };
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("mousedown", middle, true);
    el.addEventListener("gesturestart", gStart);
    el.addEventListener("gesturechange", gChange);
    el.addEventListener("gestureend", gEnd);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("mousedown", middle, true);
      el.removeEventListener("gesturestart", gStart);
      el.removeEventListener("gesturechange", gChange);
      el.removeEventListener("gestureend", gEnd);
    };
  }, []);

  // Space over the canvas turns every drag into a pan until it is let go.
  // Only while the pointer is over this canvas and nobody is typing, so a
  // space in a label, or Space on a button elsewhere, works as always.
  useEffect(() => {
    const release = () => {
      if (!spaceRef.current) return;
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (spaceRef.current) { e.preventDefault(); return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || isTypingTarget(e.target)) return;
      // Space on a focused button, tab, checkbox or menu presses it, as it
      // always has, wherever the mouse happens to rest.
      if (e.target instanceof Element && e.target.closest(SPACE_CONTROLS)) return;
      if (!hoverRef.current || !isLive(rootRef.current)) return;
      e.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!spaceRef.current) return;
      // A Mac sends no key-up for a key let go while Cmd is held: let go of
      // Cmd, and Space counts as let go too, or panning would stick.
      if (e.key === "Meta") { release(); return; }
      if (e.code !== "Space") return;
      e.preventDefault();
      release();
    };
    const onHidden = () => { if (document.hidden) release(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  // A left-button drag on empty canvas pans. (A second finger, the middle
  // button and Space+drag are handled above, before the shapes see them.)
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (
      // While presenting nothing on the canvas is edited, so dragging
      // anywhere, a shape included, moves the view.
      (!presenting && t.closest("[data-node]")) ||
      t.closest("[data-no-pan]") ||
      t.closest("button, input, textarea, select, a, [role='tab']")
    ) return;
    if (e.button !== 0 || gestureRef.current.pinch) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    dragRef.current = { id: e.pointerId, x: pan.x, y: pan.y, startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId || gestureRef.current.pinch) return;
    touch();
    const x = d.x + (e.clientX - d.startX), y = d.y + (e.clientY - d.startY);
    setView((v) => ({ zoom: v.zoom, pan: { x, y } }));
  };
  const stopPan = (e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  };

  const ctx = useMemo<CanvasContext>(() => ({ zoom, pan, gliding }), [zoom, pan, gliding]);
  // Until the shell has a size, the camera is a placeholder. A pane that
  // mounts hidden gets its size from the resize observer, and React applies
  // the opening view one painted frame after the pane appears; drawing the
  // diagram with the placeholder for that frame made it flash at 100% in the
  // corner. One empty frame instead.
  const laidOut = vp.w > 0 && vp.h > 0;
  // The view is showing only part of the diagram and the person has not yet
  // moved the camera: pick out the way to the rest of it. Derived, not
  // stored, so it stays true when the canvas goes fullscreen, the diagram
  // shrinks, or the view comes back from another tab; and judged from what is
  // drawn against the frame, in state only, so opening an add form (a taller
  // bottom bar) or a blank sheet cannot set it off.
  const cutOff = laidOut && !moved && initialView !== "fit" && !!drawn && drawn.w > 0 && drawn.h > 0 && (
    pan.x + drawn.x * zoom < -1 || pan.y + drawn.y * zoom < -1
    || pan.x + (drawn.x + drawn.w) * zoom > vp.w + 1 || pan.y + (drawn.y + drawn.h) * zoom > vp.h + 1
  );
  const showMinimap = !!minimap && vp.w >= MINIMAP_MIN_WIDTH;
  const hasBottomBar = !!bottomLeft || !!bottomRight || showMinimap;
  // The grid belongs to the world: it moves and scales with the camera, with
  // lines every GRID_STEP units (the step shapes snap to), spread out when
  // zoomed far out. The fine grid (board, business model canvas) is half that.
  // The grid is drawn from the camera's pan itself (tiles repeat, so no
  // wrapping is needed), which lets it glide with the diagram on Fit or a
  // reveal; until the first real camera, it is not drawn at all.
  const fine = gridClassName === "bp-grid-fine";
  const gridSize = gridSpacing(zoom, fine ? GRID_STEP / 2 : GRID_STEP, fine ? 7 : 12);
  const gridStyle: React.CSSProperties = laidOut
    ? { backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }
    : { backgroundImage: "none" };

  const shell = (
    <div
      ref={rootRef}
      className={cn(
        "relative isolate h-full w-full overflow-hidden rounded-lg border",
        gridClassName,
        gliding && "motion-safe:transition-[background-position] motion-safe:duration-300 motion-safe:ease-out",
      )}
      style={gridStyle}
      aria-label={fullscreenLabel}
      // overflow-hidden still leaves this a scroll container: focusing a node
      // or field that sits outside the frame makes the browser scroll the
      // frame itself, dragging the toolbar and bottom bar out of place. The
      // camera is the only thing that moves content here.
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop !== 0) el.scrollTop = 0;
        if (el.scrollLeft !== 0) el.scrollLeft = 0;
      }}
    >

      {/* Zoom toolbar */}
      <div className="absolute top-3 right-3 z-30 flex gap-1 rounded-md border bg-card/95 backdrop-blur p-1 shadow-sm" data-no-pan>
        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => zoomTo((z) => +(z - 0.1).toFixed(2))} title="Zoom out" aria-label="Zoom out">
          <ZoomOut className="size-3.5" />
        </Button>
        <button
          onClick={() => zoomTo(1)}
          title="Zoom to 100% (Ctrl/Cmd+0 fits the diagram to the view)"
          aria-label={`Zoom is ${Math.round(zoom * 100)} percent. Set to 100 percent`}
          className="w-12 text-center text-[11px] font-mono-tight text-muted-foreground hover:text-foreground self-center"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => zoomTo((z) => +(z + 0.1).toFixed(2))} title="Zoom in" aria-label="Zoom in">
          <ZoomIn className="size-3.5" />
        </Button>
        {/* While the view shows only part of the diagram, this is the way to
         *  the rest of it, so it is picked out until the person moves the
         *  camera (or an add moves it for them). "Fit to view", not "the
         *  whole diagram": a very tall flow bottoms out at the minimum zoom
         *  and still runs off the frame. */}
        <Button size="icon" variant="ghost"
          className={cn("h-7 w-7", cutOff && "bg-primary/10 text-primary ring-1 ring-primary/50")}
          onClick={fitView}
          title={cutOff ? "Part of the diagram is off-screen. Fit to view (Ctrl/Cmd+0)" : "Fit to view (Ctrl/Cmd+0)"}
          aria-label={cutOff ? "Part of the diagram is off-screen. Fit to view" : "Fit to view"}>
          <LocateFixed className="size-3.5" />
        </Button>
        {/* Full screen is the artifact's (tabs, undo and canvas together). Once
         *  on, its own header holds the one way out, so this button only
         *  ever goes in. */}
        {afs && !afs.active && (
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={afs.toggle}
            title="Full screen (F)" aria-label="Full screen">
            <Maximize2 className="size-3.5" />
          </Button>
        )}
      </div>


      {/* Present mode hides the view's editing tools (the shapes palette,
       *  the add controls); zoom and fit stay. */}
      {toolbar && !presenting && (
        <div className="absolute top-3 left-3 z-30 flex gap-1" data-no-pan>{toolbar}</div>
      )}

      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onPointerEnter={() => { hoverRef.current = true; }}
        onPointerLeave={() => { hoverRef.current = false; }}
        onFocus={(e) => { if (tabbing.current) latest.current.followFocus(e.target); }}
        onDragOver={onCanvasDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } : undefined}
        onDrop={onCanvasDrop ? (e) => {
          e.preventDefault();
          const el = viewportRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          const cx = (e.clientX - r.left - pan.x) / zoom;
          const cy = (e.clientY - r.top - pan.y) / zoom;
          onCanvasDrop(cx, cy, e);
        } : undefined}
      >
        <ToWorldCtx.Provider value={toWorld}>
        <CanvasCtx.Provider value={ctx}>
          <div
            ref={contentRef}
            data-canvas-content
            // Everything drawn, sheet and shapes, for downloads (export-pdf.ts):
            // shapes can sit outside the sheet's box, even at negative positions.
            data-world={`${world.x},${world.y},${world.w},${world.h}`}
            className={cn(
              "absolute origin-top-left",
              gliding && CANVAS_GLIDE_CLASS,
            )}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              width: contentWidth,
              height: contentHeight,
              visibility: laidOut ? undefined : "hidden",
            }}
          >
            {children}
          </div>
        </CanvasCtx.Provider>
        </ToWorldCtx.Provider>
        {/* Space held: a pane over the shapes, so the press reaches the
         *  camera and the cursor says what a drag will do. */}
        {spaceHeld && <div className="absolute inset-0 z-[5] cursor-grab active:cursor-grabbing" aria-hidden />}
      </div>

      {overlay}

      {/* One bottom bar instead of three independently pinned corners. The
       *  legend, the view's actions and the minimap used to be absolutely
       *  positioned against the same edge and simply drew over each other on
       *  a narrow canvas. As flex siblings they cannot overlap: the legend
       *  wraps, actions drop to their own row when there is no room beside
       *  it, and the minimap keeps its corner. The bar itself ignores the
       *  pointer so the gaps between its children still pan the canvas. It is
       *  a container-query container, so a view can drop a wordy hint chip
       *  on a narrow canvas with a plain `hidden @min-[640px]:flex`. */}
      {hasBottomBar && (
        <div className="@container pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-end gap-2">
          <div ref={slotsRef} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            {bottomLeft && (
              <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2" data-no-pan>
                {bottomLeft}
              </div>
            )}
            {bottomRight && !presenting && (
              <div className="pointer-events-auto ml-auto min-w-0 max-w-full" data-no-pan>
                {bottomRight}
              </div>
            )}
          </div>
          {showMinimap && (
            <Minimap boxRef={minimapRef} world={world} shapes={shapes}
              pan={pan} zoom={zoom} vp={vp}
              onJump={(cx, cy) => {
                touch();
                setView((v) => ({ zoom: v.zoom, pan: { x: vp.w / 2 - cx * v.zoom, y: vp.h / 2 - cy * v.zoom } }));
              }}
            />
          )}
        </div>
      )}
    </div>
  );

  return shell;
}

/** What Space presses when it has focus, instead of starting to pan. */
const SPACE_CONTROLS = "button, a[href], summary, [role=button], [role=tab], [role=checkbox], [role=switch], [role=radio], [role=menuitem], [role=option], [role=slider], [role=dialog], [role=alertdialog], [data-radix-popper-content-wrapper]";

/** Lines of the canvas grid are this many world units apart at 100%. Process
 *  map shapes snap to the same step, so they sit on the lines. */
const GRID_STEP = 20;

/** Whether a canvas should answer the keyboard: it is on screen, and when
 *  something is full screen, it is inside it. Several canvases can be mounted
 *  at once (the project page keeps every artifact loaded, hidden). */
function isLive(root: HTMLElement | null): boolean {
  if (!root || root.getClientRects().length === 0) return false;
  const fsEl = document.fullscreenElement ?? document.querySelector("[data-canvas-fs]");
  return !fsEl || fsEl.contains(root);
}

/** The whole world in a small box: every shape, and the part the camera
 *  shows. Press to jump there; drag to move the view around. */
function Minimap({
  boxRef, world, shapes, pan, zoom, vp, onJump,
}: {
  boxRef: MutableRefObject<HTMLDivElement | null>;
  world: CanvasRect;
  shapes?: CanvasRect[];
  pan: { x: number; y: number }; zoom: number;
  vp: { w: number; h: number };
  onJump: (cx: number, cy: number) => void;
}) {
  const MAX = 150;
  const scale = MAX / Math.max(world.w, world.h);
  const mw = world.w * scale, mh = world.h * scale;
  const vw = Math.min(mw, (vp.w / zoom) * scale);
  const vh = Math.min(mh, (vp.h / zoom) * scale);
  const vx = Math.max(0, Math.min(mw - vw, (-pan.x / zoom - world.x) * scale));
  const vy = Math.max(0, Math.min(mh - vh, (-pan.y / zoom - world.y) * scale));
  const jump = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onJump(world.x + (e.clientX - r.left) / scale, world.y + (e.clientY - r.top) / scale);
  };
  return (
    <div ref={boxRef} className="pointer-events-auto shrink-0 rounded-md border bg-card/95 backdrop-blur p-1.5 shadow-sm" data-no-pan>
      <div
        className="relative bg-muted/50 rounded-sm cursor-pointer overflow-hidden touch-none"
        style={{ width: mw, height: mh }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); jump(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) jump(e); }}
      >
        {shapes && shapes.length > 0 && (
          <svg width={mw} height={mh} className="absolute inset-0 pointer-events-none" aria-hidden>
            {shapes.map((s, i) => (
              <rect
                key={i} rx={1}
                x={(s.x - world.x) * scale} y={(s.y - world.y) * scale}
                width={Math.max(1.5, s.w * scale)} height={Math.max(1.5, s.h * scale)}
                fill="var(--color-muted-foreground)" fillOpacity={0.45}
              />
            ))}
          </svg>
        )}
        <div
          className="absolute border-2 border-primary/70 bg-primary/10 rounded-sm pointer-events-none"
          style={{ left: vx, top: vy, width: vw, height: vh }}
        />
      </div>
    </div>
  );
}

import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, ZoomIn, ZoomOut, LocateFixed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCanvasViewStore } from "./canvas-view-store";

interface CanvasState {
  zoom: number;
  pan: { x: number; y: number };
}
/** What a canvas's children can read. `gliding` is true while the camera is
 *  being animated to a new position; anything that counter-moves against the
 *  camera (a pinned lane header) must animate with the same timing or it
 *  visibly runs ahead of the diagram for the length of the glide. */
interface CanvasContext extends CanvasState { gliding: boolean }
const CanvasCtx = createContext<CanvasContext>({ zoom: 1, pan: { x: 0, y: 0 }, gliding: false });
export const useCanvas = () => useContext(CanvasCtx);
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
   *  out, the whole sheet is assumed to be the diagram. */
  drawnBounds?: CanvasRect | null;
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
  fullscreenLabel = "Fullscreen canvas",
  viewId, initialView = "readable", readableZoom = 0.8, initialFocus, leftInset = 0, apiRef, drawnBounds,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const slotsRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);

  const store = useCanvasViewStore();
  const storeKey = viewId ? `shell:${viewId}` : null;

  // One state object, not separate zoom/pan: every camera move is a single
  // pure update, which is also what gets parked in the view store.
  const saved = storeKey ? (store?.get(storeKey) as (CanvasState & { moved?: boolean }) | undefined) : undefined;
  const [view, setView] = useState<CanvasState>(() =>
    saved ? { zoom: saved.zoom, pan: saved.pan } : { zoom: 1, pan: { x: 40, y: 40 } });
  const { zoom, pan } = view;
  // Whether the person has taken the camera since it was aimed for them.
  // Parked with the camera, so a trip to another tab does not forget it.
  const [moved, setMoved] = useState<boolean>(() => saved?.moved ?? false);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [fs, setFs] = useState(false);
  const [cssFs, setCssFs] = useState(false);
  const [gliding, setGliding] = useState(false);

  // Lifecycle of the opening view. `ready` flips once a real viewport size
  // has been seen; `restored` means the camera came from the store and must
  // not be re-aimed; `touched` means the person (or a reveal) has moved it.
  const lifeRef = useRef<{
    ready: boolean; restored: boolean; touched: boolean; at: number; restoreChecked: boolean;
  } | null>(null);
  if (!lifeRef.current) {
    const has = !!(storeKey && store?.has(storeKey));
    lifeRef.current = { ready: has, restored: has, touched: has, at: 0, restoreChecked: false };
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
    const z = clampZoom(Math.min(1, s.w / contentWidth, s.h / contentHeight));
    return { zoom: z, pan: { x: s.l + Math.max(0, (s.w - contentWidth * z) / 2), y: s.t } };
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
    const scaledW = contentWidth * z;
    let x = s.l;
    if (scaledW <= s.w) {
      x = s.l + (s.w - scaledW) / 2;
    } else if (initialFocus) {
      const centred = s.l + s.w / 2 - (initialFocus.x + initialFocus.w / 2) * z;
      x = Math.min(s.l, Math.max(s.l + s.w - scaledW, centred));
    }
    const y = initialFocus ? Math.min(s.t, s.t + 8 - initialFocus.y * z) : s.t;
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
      setView(openingView(r.width, r.height));
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
    const seenW = Math.min(pan.x + contentWidth * zoom, s.l + s.w) - Math.max(pan.x, s.l);
    const seenH = Math.min(pan.y + contentHeight * zoom, s.t + s.h) - Math.max(pan.y, s.t);
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
    const fits = !frame || (whole.width <= frame.width - 2 * EDGE && whole.height <= frame.height - TOP_BAR - 2 * EDGE);
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
  const latest = useRef({ measure, fitView, reveal, checkRestoredView, touch, followFocus });
  useLayoutEffect(() => { latest.current = { measure, fitView, reveal, checkRestoredView, touch, followFocus }; });

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
    // Re-attach when the CSS-fallback fullscreen swaps the shell into a
    // portal: that rebuilds the DOM, and an observer left on the old viewport
    // element would report nothing ever again.
  }, [cssFs]);

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
  }, [contentWidth, contentHeight, leftInset]);

  useEffect(() => {
    if (storeKey && store && life.ready) store.set(storeKey, { ...view, moved });
  }, [store, storeKey, view, moved, life]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      reveal: (target) => latest.current.reveal(target),
      fitView: () => latest.current.fitView(),
    };
    return () => { apiRef.current = null; };
  }, [apiRef]);

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

  // Try native Fullscreen API first; fall back to a CSS-portal fullscreen when
  // the browser rejects it (common inside iframes without allow="fullscreen",
  // like the Lovable preview).
  const toggleFs = async () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      try { await document.exitFullscreen(); } catch { /* noop */ }
      setFs(false);
      return;
    }
    if (cssFs) { setCssFs(false); setFs(false); return; }
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        setFs(true);
        return;
      } catch { /* fall through to CSS fallback */ }
    }
    setCssFs(true);
    setFs(true);
  };

  useEffect(() => {
    const onFsChange = () => {
      const native = document.fullscreenElement === rootRef.current;
      setFs(native || cssFs);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "0" || e.code === "Digit0")) {
        e.preventDefault(); latest.current.fitView();
      }
      if (e.key === "Escape" && fs) {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }
        setCssFs(false);
        setFs(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [fs, cssFs]);

  // Non-passive wheel listener — needed so ctrl/pinch-zoom can call preventDefault
  // (React's synthetic onWheel is passive by default and would let the browser
  // page-zoom instead of zooming our canvas).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      latest.current.touch();
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect();
        const px = e.clientX - box.left, py = e.clientY - box.top;
        const factor = Math.exp(-e.deltaY * 0.0018);
        setView((v) => {
          const nz = Math.min(maxZoom, Math.max(minZoom, v.zoom * factor));
          const k = nz / v.zoom;
          return { zoom: nz, pan: { x: px - (px - v.pan.x) * k, y: py - (py - v.pan.y) * k } };
        });
      } else {
        setView((v) => ({ zoom: v.zoom, pan: { x: v.pan.x - e.deltaX, y: v.pan.y - e.deltaY } }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [minZoom, maxZoom, life, cssFs]);

  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (
      t.closest("[data-node]") ||
      t.closest("[data-no-pan]") ||
      t.closest("button, input, textarea, select, a, [role='tab']")
    ) return;
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: pan.x, y: pan.y, startX: e.clientX, startY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    touch();
    const x = d.x + (e.clientX - d.startX), y = d.y + (e.clientY - d.startY);
    setView((v) => ({ zoom: v.zoom, pan: { x, y } }));
  };
  const stopPan = () => { dragRef.current = null; };

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
  const drawn = drawnBounds === undefined ? { x: 0, y: 0, w: contentWidth, h: contentHeight } : drawnBounds;
  const cutOff = laidOut && !moved && initialView !== "fit" && !!drawn && drawn.w > 0 && drawn.h > 0 && (
    pan.x + drawn.x * zoom < -1 || pan.y + drawn.y * zoom < -1
    || pan.x + (drawn.x + drawn.w) * zoom > vp.w + 1 || pan.y + (drawn.y + drawn.h) * zoom > vp.h + 1
  );
  const showMinimap = !!minimap && vp.w >= MINIMAP_MIN_WIDTH;
  const hasBottomBar = !!bottomLeft || !!bottomRight || showMinimap;

  const shell = (
    <div
      ref={rootRef}
      className={cn(
        "relative isolate overflow-hidden rounded-lg border",
        !fs && "h-full w-full",
        gridClassName,
        fs && "fixed inset-0 z-[9999] rounded-none border-0 bg-background",
      )}
      style={fs ? { width: "100dvw", height: "100dvh" } : undefined}
      role={fs ? "dialog" : undefined}
      aria-label={fs ? fullscreenLabel : undefined}
      // In the CSS-fallback fullscreen this element is portalled to <body>,
      // outside the artifact it belongs to. The marker lets the artifact's
      // keyboard handling still recognise it as its own canvas.
      data-canvas-fs={cssFs ? "" : undefined}
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
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={toggleFs}
          title={fs ? "Exit fullscreen (Esc)" : "Fullscreen"} aria-label={fs ? "Exit fullscreen" : "Fullscreen"}>
          {fs ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      </div>


      {toolbar && (
        <div className="absolute top-3 left-3 z-30 flex gap-1" data-no-pan>{toolbar}</div>
      )}

      {fs && (
        <>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 rounded-full border bg-card/95 backdrop-blur px-3 py-1 text-[11px] font-mono-tight text-muted-foreground" data-no-pan>
            Fullscreen · press <kbd className="px-1 rounded bg-muted mx-0.5">Esc</kbd> to exit
          </div>
          <Button
            size="icon" variant="outline"
            className="absolute top-3 right-[220px] z-30 h-8 w-8 bg-card/95 backdrop-blur"
            onClick={toggleFs}
            title="Close fullscreen" aria-label="Close fullscreen"
            data-no-pan
          >
            <X className="size-4" />
          </Button>
        </>
      )}

      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
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
        <CanvasCtx.Provider value={ctx}>
          <div
            ref={contentRef}
            data-canvas-content
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
            {bottomRight && (
              <div className="pointer-events-auto ml-auto min-w-0 max-w-full" data-no-pan>
                {bottomRight}
              </div>
            )}
          </div>
          {showMinimap && (
            <Minimap boxRef={minimapRef} contentW={contentWidth} contentH={contentHeight}
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

  // When we're in CSS-fallback fullscreen (native rejected, e.g. iframe without
  // allow="fullscreen"), portal into <body> so no ancestor overflow/transform clips us.
  if (cssFs && typeof document !== "undefined") {
    return createPortal(shell, document.body);
  }
  return shell;
}

function Minimap({
  boxRef, contentW, contentH, pan, zoom, vp, onJump,
}: {
  boxRef: MutableRefObject<HTMLDivElement | null>;
  contentW: number; contentH: number;
  pan: { x: number; y: number }; zoom: number;
  vp: { w: number; h: number };
  onJump: (cx: number, cy: number) => void;
}) {
  const MAX = 150;
  const scale = MAX / Math.max(contentW, contentH);
  const mw = contentW * scale, mh = contentH * scale;
  const vw = Math.min(mw, (vp.w / zoom) * scale);
  const vh = Math.min(mh, (vp.h / zoom) * scale);
  const vx = Math.max(0, Math.min(mw - vw, (-pan.x / zoom) * scale));
  const vy = Math.max(0, Math.min(mh - vh, (-pan.y / zoom) * scale));
  return (
    <div ref={boxRef} className="pointer-events-auto shrink-0 rounded-md border bg-card/95 backdrop-blur p-1.5 shadow-sm" data-no-pan>
      <div
        className="relative bg-muted/50 rounded-sm cursor-pointer overflow-hidden"
        style={{ width: mw, height: mh }}
        onPointerDown={(e) => {
          const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          onJump((e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        }}
      >
        <div
          className="absolute border-2 border-primary/70 bg-primary/10 rounded-sm pointer-events-none"
          style={{ left: vx, top: vy, width: vw, height: vh }}
        />
      </div>
    </div>
  );
}

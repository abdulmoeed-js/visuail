// Full screen for a whole artifact: its diagram-type tabs, undo/redo and the
// canvas, so switching Process map <-> DFD never drops you out of it. One
// state per artifact, owned by ArtifactView; every canvas inside asks it.
//
// The browser's real fullscreen is tried first. Where it is refused or never
// answers (iPhone Safari, iframes such as the Lovable preview) the same
// element fills the window instead and is marked `data-canvas-fs`, which the
// notice area and the overlay host listen for.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type RefObject,
} from "react";
import { CANVAS_FULLSCREEN_EVENT } from "@/lib/canvas-events";

export interface ArtifactFullscreen {
  /** Full screen is on (real or the fill-the-window fallback). */
  active: boolean;
  /** The fill-the-window fallback is the one in use. */
  fallback: boolean;
  /** Present mode: editing tools hidden, for showing to others. */
  presenting: boolean;
  /** Laser pointer on (only while presenting). */
  laser: boolean;
  /** The shortcuts card is open. */
  shortcutsOpen: boolean;
  toggle: () => void;
  exit: () => void;
  setPresenting: (on: boolean) => void;
  setLaser: (on: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
}

const Ctx = createContext<ArtifactFullscreen | null>(null);
export const ArtifactFullscreenProvider = Ctx.Provider;
/** The artifact's full-screen state, or null outside an artifact. */
export const useArtifactFullscreen = () => useContext(Ctx);

/** How long to wait for the browser's fullscreen before filling the window
 *  instead: some embedded browsers neither grant nor refuse it. */
const NATIVE_TIMEOUT_MS = 1200;

/** Only one artifact is full screen at a time (the share page shows several). */
let owner: symbol | null = null;

type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
const keyboardApi = (): KeyboardLock | undefined =>
  (typeof navigator !== "undefined" ? (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard : undefined);

/** True when a key press belongs to a text field rather than the canvas. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.closest) return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

const OVERLAY_SELECTOR =
  "[data-radix-popper-content-wrapper], [role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='menu']";

/** True while some pop-up (popover, menu, dialog) is open over the page;
 *  its own keys and Esc come first. */
function overlayOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector(OVERLAY_SELECTOR);
}

/** True when a one-letter shortcut (F, P, L, ?) must be left alone: typing,
 *  a held key, or a key meant for an open menu or dialog. */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing || !e.key) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (isTypingTarget(e.target)) return true;
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]")) return true;
  return overlayOpen();
}

export function useArtifactFullscreenController(ref: RefObject<HTMLElement | null>): ArtifactFullscreen {
  const [native, setNative] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [presenting, setPresentingState] = useState(false);
  const [laser, setLaser] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const active = native || fallback;
  // The latest values for listeners registered once.
  const stateRef = useRef({ active, native, fallback, presenting, laser, shortcutsOpen });
  stateRef.current = { active, native, fallback, presenting, laser, shortcutsOpen };
  const me = useRef(Symbol("artifact"));
  /** Whether the person wants full screen: a late grant after they already
   *  left must not take them back in. */
  const wantRef = useRef(false);
  const enteringRef = useRef(false);
  /** Where keyboard focus was before entering, to put it back afterwards. */
  const returnFocus = useRef<HTMLElement | null>(null);
  // The Esc keyboard lock is one per page; only release it if this artifact
  // took it, or a sibling artifact would cancel the full-screen one's.
  const lockedRef = useRef(false);
  const lockEsc = useCallback(() => {
    lockedRef.current = true;
    keyboardApi()?.lock?.(["Escape"]).catch(() => undefined);
  }, []);
  const unlockEsc = useCallback(() => {
    if (!lockedRef.current) return;
    lockedRef.current = false;
    keyboardApi()?.unlock?.();
  }, []);

  const setPresenting = useCallback((on: boolean) => {
    setPresentingState(on);
    if (!on) setLaser(false);
  }, []);

  const exit = useCallback(() => {
    wantRef.current = false;
    const el = ref.current;
    if (el && document.fullscreenElement === el) {
      unlockEsc();
      document.exitFullscreen().catch(() => undefined);
    }
    setNative(false);
    setFallback(false);
    setPresenting(false);
    setShortcutsOpen(false);
  }, [ref, setPresenting, unlockEsc]);

  const enter = useCallback(async () => {
    const el = ref.current;
    if (!el || enteringRef.current) return;
    if (owner && owner !== me.current) return;
    owner = me.current;
    wantRef.current = true;
    enteringRef.current = true;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (el.requestFullscreen) {
        const granted = await Promise.race([
          el.requestFullscreen().then(() => true, () => false),
          new Promise<boolean>((r) => window.setTimeout(() => r(false), NATIVE_TIMEOUT_MS)),
        ]);
        if (granted) {
          // fullscreenchange sets the state and the keyboard lock.
          setNative(document.fullscreenElement === el);
          return;
        }
      }
      // Refused, or not answered in time: fill the window. If the browser
      // grants it late after all, fullscreenchange switches to the real one.
      if (wantRef.current) setFallback(true);
      else if (owner === me.current) owner = null; // left while waiting
    } finally {
      enteringRef.current = false;
    }
  }, [ref]);

  const toggle = useCallback(() => {
    if (enteringRef.current) return;
    if (stateRef.current.active) exit();
    else void enter();
  }, [enter, exit]);

  // The browser entering or leaving fullscreen (including on its own: Esc,
  // a gesture, a tab switch, or a late grant).
  useEffect(() => {
    const onChange = () => {
      const el = ref.current;
      const isNative = !!el && document.fullscreenElement === el;
      if (isNative) {
        if (!wantRef.current) { document.exitFullscreen().catch(() => undefined); return; }
        // Chromium: keep a single Esc for the page (cancel an edit, close a
        // pop-up) and leave on press-and-hold, which the browser explains.
        // Elsewhere the browser keeps taking the first Esc.
        lockEsc();
        setNative(true);
        setFallback(false);
        return;
      }
      // Another artifact's full screen, not ours: nothing to do.
      if (!stateRef.current.native && !wantRef.current) return;
      unlockEsc();
      setNative(false);
      if (!stateRef.current.fallback) {
        wantRef.current = false;
        setPresenting(false);
        setShortcutsOpen(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref, setPresenting, lockEsc, unlockEsc]);

  // Ownership, focus, and telling the page about the fallback.
  const wasActive = useRef(false);
  useEffect(() => {
    if (active === wasActive.current) return;
    wasActive.current = active;
    const el = ref.current;
    if (active) {
      owner = me.current;
      // Keep the keyboard in the artifact: the button that was pressed has
      // gone (the zoom bar's Full screen button only shows outside it).
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    } else {
      if (owner === me.current) owner = null;
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back && back.isConnected && back.getClientRects().length > 0) back.focus({ preventScroll: true });
    }
  }, [active, ref]);

  const announced = useRef(false);
  useEffect(() => {
    if (fallback === announced.current) return;
    announced.current = fallback;
    document.dispatchEvent(new Event(CANVAS_FULLSCREEN_EVENT));
    // The page behind must not scroll or show a scrollbar.
    document.documentElement.style.overflow = fallback ? "hidden" : "";
  }, [fallback]);
  useEffect(() => () => {
    if (owner === me.current) owner = null;
    unlockEsc();
    if (announced.current) {
      document.documentElement.style.overflow = "";
      document.dispatchEvent(new Event(CANVAS_FULLSCREEN_EVENT));
    }
  }, [unlockEsc]);

  // Keys while full screen. Esc steps back one layer at a time: a pop-up or
  // a field being typed in handles it first (Radix, InlineEdit and the add
  // forms mark the event as handled), then the shortcuts card, then Present
  // mode, then full screen itself.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (e.key === "Escape") {
        if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target) || overlayOpen()) return;
        e.preventDefault();
        if (s.shortcutsOpen) setShortcutsOpen(false);
        else if (s.presenting) setPresenting(false);
        else exit();
        return;
      }
      if (ignoreShortcut(e)) return;
      if (e.code === "KeyP" || e.key.toLowerCase() === "p") { e.preventDefault(); setPresenting(!s.presenting); }
      else if ((e.code === "KeyL" || e.key.toLowerCase() === "l") && s.presenting) { e.preventDefault(); setLaser(!s.laser); }
      else if (e.key === "?") { e.preventDefault(); setShortcutsOpen(!s.shortcutsOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, exit, setPresenting]);

  return {
    active, fallback, presenting: active && presenting, laser: active && presenting && laser,
    shortcutsOpen: active && shortcutsOpen,
    toggle, exit, setPresenting, setLaser, setShortcutsOpen,
  };
}

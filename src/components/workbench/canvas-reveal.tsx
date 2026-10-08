// "Show me the thing I just made." A node added from a toolbar lands wherever
// the layout puts it -- for a process map that is the end of the spine, which
// on any real diagram is off-screen. The person typed a step, pressed Enter,
// and nothing visibly happened. This pairs the canvas shell's reveal() with a
// short highlight so the new node is both brought into view and pointed at.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCanvas, type CanvasApi, type CanvasRect, type RevealTarget } from "./CanvasShell";

const FLASH_MS = 1800;

/**
 * `rectOf(id)` returns the node's rectangle in canvas-content coordinates, or
 * null while the layout has not placed it yet (the model update and the
 * layout that follows land on a later render than the add call).
 */
export function useRevealNew(rectOf: (id: string) => RevealTarget | null) {
  const apiRef = useRef<CanvasApi | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  // `rectOf` is a fresh closure over the caller's layout on every render, so
  // it is read through a ref; what the effect actually waits on is the moment
  // the layout first has a rectangle for the pending node.
  const rectOfRef = useRef(rectOf);
  useLayoutEffect(() => {
    rectOfRef.current = rectOf;
  });
  const pendingRect = pending ? rectOf(pending) : null;
  // A zero-size rectangle is a node that exists but has not been laid out
  // (a hidden pane); panning to it would aim the camera at nothing.
  const placed = !!pendingRect && pendingRect.w > 0 && pendingRect.h > 0;

  useEffect(() => {
    if (!pending || !placed) return;
    const rect = rectOfRef.current(pending);
    if (!rect) return;
    apiRef.current?.reveal(rect);
    setFlashId(pending);
    setPending(null);
  }, [pending, placed]);

  // An id that never shows up (the add was refused, or undone at once) must
  // not sit there waiting to move the camera at some later, unrelated moment.
  useEffect(() => {
    if (!pending || placed) return;
    const t = window.setTimeout(() => setPending(null), 1500);
    return () => window.clearTimeout(t);
  }, [pending, placed]);

  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flashId]);

  return {
    apiRef,
    /** Pan to the node if it is out of view, then highlight it. */
    revealNew: setPending,
    /** Highlight only -- for a node the person placed themselves, e.g. a
     *  palette drop, where moving the camera would fight what they just did. */
    flash: setFlashId,
    flashId,
  };
}

/** Ring drawn around a just-added node. Lives in canvas-content space as a
 *  sibling of the nodes, so no node component has to know about it.
 *  Render it with `key={id}` so a second add restarts the animation instead
 *  of inheriting a half-faded one. */
// Drawn in content space, so it scales with the canvas. Thicken it as the
// canvas zooms out, or a shape dropped at 35% would get a hairline.
const ringShadow = (zoom: number) =>
  `0 0 0 ${Math.max(2, 3 / Math.max(zoom, 0.1))}px var(--color-primary)`;

/** The same ring for something that does not sit still in content space --
 *  a lane header pinned to the top of the view. Rendered INSIDE that element
 *  (which must be positioned), so it goes wherever the element goes. */
export function FlashOutline() {
  const { zoom } = useCanvas();
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-1 rounded-lg animate-node-flash"
      style={{ boxShadow: ringShadow(zoom) }}
    />
  );
}

export function FlashRing({ rect }: { rect: CanvasRect | null }) {
  const { zoom } = useCanvas();
  if (!rect || rect.w <= 0 || rect.h <= 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-2xl animate-node-flash"
      style={{
        left: rect.x - 8,
        top: rect.y - 8,
        width: rect.w + 16,
        height: rect.h + 16,
        zIndex: 100000,
        boxShadow: ringShadow(zoom),
      }}
    />
  );
}

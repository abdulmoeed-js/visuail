import { useLayoutEffect, useRef, useState } from "react";

/**
 * How tall each shape of a canvas is drawn, by its `data-shape-id`. A shape
 * grows with its text (it is drawn with a min-height, not a height), and its
 * lines, its selection outline and the layout need the size it grew to.
 * Attach `rootRef` to an element around the shapes.
 *
 * A hidden canvas (a project pane that is not the open one) measures 0,
 * which is not a size: its shapes keep their base sizes until it is shown,
 * and then measure again.
 */
export function useGrownHeights() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const read = () => {
      // Hidden (display:none): keep the last sizes, so the shapes are where
      // they were when the canvas is shown again, or exported while it is
      // being shown.
      if (root.getClientRects().length === 0) return;
      const next: Record<string, number> = {};
      for (const el of root.querySelectorAll<HTMLElement>("[data-shape-id]")) {
        const h = el.offsetHeight;
        if (h > 0 && el.dataset.shapeId) next[el.dataset.shapeId] = h;
      }
      // Whole pixels only, so sub-pixel jitter can't start a render loop.
      setHeights((cur) => {
        const keys = Object.keys(next);
        const same = keys.length === Object.keys(cur).length
          && keys.every((k) => cur[k] !== undefined && Math.abs(cur[k] - next[k]) < 1);
        return same ? cur : next;
      });
    };
    // Read as soon as the browser has laid the shapes out (the observer
    // reports before the frame is painted), not a frame later: an export
    // takes its picture two frames after showing a canvas.
    const ro = new ResizeObserver(read);
    const watch = () => {
      for (const el of root.querySelectorAll("[data-shape-id]")) ro.observe(el);
    };
    watch();
    read();
    // Shapes come and go (added, pasted, deleted): watch the new ones too
    // (the observer reports each one's size when it starts watching it).
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);
  return { heights, rootRef };
}

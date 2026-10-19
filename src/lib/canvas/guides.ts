// Snap guides (phase 7): while shapes are dragged, an edge or the middle of
// what is moving lines up with an edge or the middle of another shape when
// it comes close, and a thin line shows what it lined up with -- as in Miro
// and Figma. Pure, so it can be checked on its own (guides.test.ts).

import type { Rect } from "./layout";

/** A line to draw: along x = `at` (axis "x", a vertical line) or y = `at`
 *  (axis "y", a horizontal one), from `from` to `to` on the other axis. */
export interface Guide { axis: "x" | "y"; at: number; from: number; to: number }

/** Left, middle, right (or top, middle, bottom). */
const marks = (start: number, size: number) => [start, start + size / 2, start + size];

/** The nearest line-up on one axis: how far to move, and where it lines up. */
function nearest(mine: number[], theirs: number[][], reach: number): { d: number; at: number } | null {
  let best: { d: number; at: number } | null = null;
  for (const t of theirs) {
    for (const b of t) {
      for (const a of mine) {
        const d = b - a;
        if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: b };
      }
    }
  }
  return best;
}

/**
 * How far to move `box` (what is being dragged) so it lines up with one of
 * `others`, on each axis on its own: `dx`/`dy` are null where nothing is
 * within `reach`. `guides` are the lines to draw, each running across the
 * box and every shape it now lines up with there.
 */
export function alignTo(box: Rect, others: Rect[], reach: number): { dx: number | null; dy: number | null; guides: Guide[] } {
  const x = nearest(marks(box.x, box.w), others.map((o) => marks(o.x, o.w)), reach);
  const y = nearest(marks(box.y, box.h), others.map((o) => marks(o.y, o.h)), reach);
  const moved = { ...box, x: box.x + (x?.d ?? 0), y: box.y + (y?.d ?? 0) };
  const on = (vals: number[], at: number) => vals.some((v) => Math.abs(v - at) < 0.5);
  const guides: Guide[] = [];
  if (x) {
    const hit = [moved, ...others.filter((o) => on(marks(o.x, o.w), x.at))];
    guides.push({ axis: "x", at: x.at, from: Math.min(...hit.map((r) => r.y)), to: Math.max(...hit.map((r) => r.y + r.h)) });
  }
  if (y) {
    const hit = [moved, ...others.filter((o) => on(marks(o.y, o.h), y.at))];
    guides.push({ axis: "y", at: y.at, from: Math.min(...hit.map((r) => r.x)), to: Math.max(...hit.map((r) => r.x + r.w)) });
  }
  return { dx: x?.d ?? null, dy: y?.d ?? null, guides };
}

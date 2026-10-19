// Connectors (phase 6): how a line between two shapes is drawn. It leaves
// one shape and enters the other across the gap between them -- through
// their sides when they sit more side by side, through top and bottom when
// one is more above the other -- with one elbow halfway, as Miro's elbowed
// connectors do. The sides are worked out each time, not stored, so moving
// a shape re-routes its lines. Pure, so it can be checked on its own
// (connector.test.ts).

import type { Rect } from "./layout";

export interface Point { x: number; y: number }
export type Side = "top" | "right" | "bottom" | "left";

/** The middle of one side of `r`. */
export function anchor(r: Rect, side: Side): Point {
  switch (side) {
    case "top": return { x: r.x + r.w / 2, y: r.y };
    case "bottom": return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left": return { x: r.x, y: r.y + r.h / 2 };
    case "right": return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

/** Which side the line leaves `a` by and enters `b` by: across the wider
 *  gap between them (sideways on a tie). */
export function sidesBetween(a: Rect, b: Rect): [Side, Side] {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const right = b.x + b.w / 2 >= a.x + a.w / 2;
  const down = b.y + b.h / 2 >= a.y + a.h / 2;
  if (gapX >= gapY) return right ? ["right", "left"] : ["left", "right"];
  return down ? ["bottom", "top"] : ["top", "bottom"];
}

/**
 * The line from `a` to `b`: its corner points (first on `a`, last on `b`),
 * the middle of its middle run (where its label goes), and the sides used.
 * Straight when the two ends already line up.
 */
export function connectorRoute(a: Rect, b: Rect): { points: Point[]; mid: Point; sides: [Side, Side] } {
  const sides = sidesBetween(a, b);
  const p = anchor(a, sides[0]), q = anchor(b, sides[1]);
  if (sides[0] === "left" || sides[0] === "right") {
    const mx = (p.x + q.x) / 2;
    const points = Math.abs(p.y - q.y) < 1 ? [p, q] : [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
    return { points, mid: { x: mx, y: (p.y + q.y) / 2 }, sides };
  }
  const my = (p.y + q.y) / 2;
  const points = Math.abs(p.x - q.x) < 1 ? [p, q] : [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
  return { points, mid: { x: (p.x + q.x) / 2, y: my }, sides };
}

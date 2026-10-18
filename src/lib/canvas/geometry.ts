// Shared drawing maths for the diagram canvases. Pure, so it can be checked
// on its own (geometry.test.ts). Each view used to carry its own copy.

export interface Point { x: number; y: number }
/** A box by its centre and size, the way the views place nodes. */
export interface CentredBox { cx: number; cy: number; w: number; h: number }

/** An SVG path through `points` with each corner rounded. Rounded corners are
 *  the single biggest lever for a connector that reads as designed rather
 *  than generated. The radius is clamped per corner to half the shorter
 *  adjacent segment, so it never overshoots on a tight turn. */
export function roundedPath(points: Point[], radius = 12): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], cur = points[i], next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inRatio = inLen === 0 ? 0 : r / inLen;
    const outRatio = outLen === 0 ? 0 : r / outLen;
    const p1 = { x: cur.x - (cur.x - prev.x) * inRatio, y: cur.y - (cur.y - prev.y) * inRatio };
    const p2 = { x: cur.x + (next.x - cur.x) * outRatio, y: cur.y + (next.y - cur.y) * outRatio };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Where a line from box `a` towards `b` leaves `a`: the middle of the side
 *  facing `b`, chosen by whichever is further, across or down. Boxes with
 *  the same centre (a line from a shape to itself) leave from the top. */
export function edgePoint(a: CentredBox, b: { cx: number; cy: number }): Point {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (dx === 0 && dy === 0) return { x: a.cx, y: a.cy - a.h / 2 };
  if (Math.abs(dx) > Math.abs(dy)) return { x: a.cx + Math.sign(dx) * a.w / 2, y: a.cy };
  return { x: a.cx, y: a.cy + Math.sign(dy) * a.h / 2 };
}

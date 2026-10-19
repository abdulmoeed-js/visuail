// The stacking order inside a diagram's zoomable layer, bottom to top. The
// lines (each canvas's SVG, drawn first and given no z-index) sit under all
// of these. One scale for every canvas, so a shape can never end up over a
// line's label, the selection outline or the handles.

export const LAYER = {
  /** Shapes: this plus the shape's stacking rank (RANK_MIN..RANK_MAX). */
  shape: 100,
  lineLabel: 800,
  outline: 900,
  guide: 910,
  handle: 920,
  preview: 930,
  /** Headers pinned to the view as it scrolls (Activity's lane names). */
  pinned: 940,
  bar: 950,
  /** The ring that points at a shape just added or found. */
  flash: 990,
} as const;

/** Ranks a shape raised or lowered by hand can take: above 0 in front of
 *  the shapes no one has moved, below 0 behind them. */
export const RANK_MAX = 599;
export const RANK_MIN = -50;

/**
 * The ranks after `id` is brought to the front or sent to the back, by
 * shape id. Ranks are recounted (1, 2, 3... in front; -1, -2... behind)
 * every time, so they never grow without bound however often shapes are
 * clicked.
 */
export function restack(ranks: Record<string, number | undefined>, id: string, where: "front" | "back"): Record<string, number> {
  const others = Object.entries(ranks).filter(([k, z]) => k !== id && z !== undefined && z !== 0) as [string, number][];
  const front = others.filter(([, z]) => z > 0).sort((a, b) => a[1] - b[1]).map(([k]) => k);
  const back = others.filter(([, z]) => z < 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  if (where === "front") front.push(id); else back.push(id);
  const out: Record<string, number> = {};
  front.slice(-RANK_MAX).forEach((k, i) => { out[k] = i + 1; });
  // Keep the furthest back (the shape just sent there among them).
  back.slice(RANK_MIN).forEach((k, i) => { out[k] = -(i + 1); });
  return out;
}

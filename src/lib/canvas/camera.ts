// The camera maths for the diagram canvases (CanvasShell). Pure, so it can
// be checked on its own (camera.test.ts).
//
// Screen = world * zoom + pan. "World" is the unscaled space the views lay
// their shapes out in; it has no edges and may run into negative numbers
// once shapes are dragged left of or above where the diagram started.

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface View { zoom: number; pan: Point }

/** Room kept around shapes that lie outside the sheet, like the margin the
 *  sheet itself has: what a view draws just beside a shape (a state's start
 *  dot, a loop, a label) stays in the picture, and Fit leaves a margin. */
export const WORLD_PAD = 60;

/** The world the camera has to cover: the view's sheet, which starts at the
 *  origin, grown to take in every shape actually drawn wherever it is, with
 *  WORLD_PAD of room on each side where a shape goes past the sheet. */
export function worldOf(sheetW: number, sheetH: number, drawn?: Rect | null): Rect {
  if (!drawn || !(drawn.w > 0) || !(drawn.h > 0)) return { x: 0, y: 0, w: sheetW, h: sheetH };
  const x0 = drawn.x < 0 ? drawn.x - WORLD_PAD : 0;
  const y0 = drawn.y < 0 ? drawn.y - WORLD_PAD : 0;
  const x1 = drawn.x + drawn.w > sheetW ? drawn.x + drawn.w + WORLD_PAD : sheetW;
  const y1 = drawn.y + drawn.h > sheetH ? drawn.y + drawn.h + WORLD_PAD : sheetH;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The view zoomed to `zoom` keeping the screen point (px, py) still. */
export function zoomAbout(v: View, zoom: number, px: number, py: number): View {
  if (zoom === v.zoom) return v;
  const k = zoom / v.zoom;
  return { zoom, pan: { x: px - (px - v.pan.x) * k, y: py - (py - v.pan.y) * k } };
}

/** Two fingers: the view at the start of the pinch, where the fingers were
 *  then (midpoint and spread) and where they are now. Zooms by the change in
 *  spread and moves with the midpoint, so the point under the fingers stays
 *  under them -- a pinch and a two-finger pan are the same gesture. */
export function pinchView(
  start: View, startMid: Point, startDist: number, mid: Point, dist: number,
  clamp: (z: number) => number,
): View {
  const zoom = clamp(start.zoom * (startDist > 0 ? dist / startDist : 1));
  const k = zoom / start.zoom;
  return {
    zoom,
    pan: { x: mid.x - (startMid.x - start.pan.x) * k, y: mid.y - (startMid.y - start.pan.y) * k },
  };
}

/** Wheel movement in pixels. Firefox and some mice report lines or pages
 *  (deltaMode 1 and 2); without this a mouse there scrolls a few pixels a
 *  notch while a trackpad elsewhere races. */
export function wheelPixels(e: { deltaX: number; deltaY: number; deltaMode: number }, pageHeight: number): Point {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1;
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

/** On-screen spacing of the grid lines: every `step` world units, doubled
 *  while they would be closer than `minPx` (zoomed far out the grid would be
 *  a grey wash). Every spacing is a multiple of `step`, so shapes snapped to
 *  the step sit on a line. Drawn with its origin at the camera's pan, the
 *  grid then stays fixed to the world. */
export function gridSpacing(zoom: number, step: number, minPx: number): number {
  let size = step * zoom;
  if (!(size > 0)) size = step;
  while (size < minPx) size *= 2;
  return size;
}

/** The world rectangle the camera shows in a frame of `w` by `h` pixels. */
export function visibleWorld(v: View, w: number, h: number): Rect {
  return { x: -v.pan.x / v.zoom, y: -v.pan.y / v.zoom, w: w / v.zoom, h: h / v.zoom };
}

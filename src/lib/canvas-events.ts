// Signals a diagram canvas sends to the rest of the page.

/** Fired on `document` when a canvas enters or leaves its own fill-the-window
 *  fallback for fullscreen. The browser's real fullscreen announces itself
 *  with `fullscreenchange`; the fallback is the canvas's own doing, so nothing
 *  else can know about it unless told. The notice area (AppToaster in
 *  src/routes/__root.tsx) listens for it. While the fallback is on, the canvas
 *  root carries the attribute `data-canvas-fs`. */
export const CANVAS_FULLSCREEN_EVENT = "visu:canvas-fullscreen";

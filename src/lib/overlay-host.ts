// Where pop-ups (popovers, dialogs, menus, tooltips) should be placed.
//
// Radix places every overlay in <body>. During the browser's real fullscreen
// only the fullscreen element is drawn, and the fill-the-window fallback sits
// above the page, so an overlay in <body> opens where nobody can see it. While
// an artifact is full-screen, overlays go inside it instead.

import { useEffect, useState } from "react";
import { CANVAS_FULLSCREEN_EVENT } from "@/lib/canvas-events";

function currentHost(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  const native = document.fullscreenElement;
  if (native instanceof HTMLElement) return native;
  return document.querySelector<HTMLElement>("[data-canvas-fs]") ?? undefined;
}

/** The element overlays should portal into: the full-screen artifact while
 *  one is open, otherwise `undefined` (Radix's default, <body>). */
export function useOverlayHost(): HTMLElement | undefined {
  const [host, setHost] = useState<HTMLElement | undefined>(currentHost);
  useEffect(() => {
    const update = () => setHost(currentHost());
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener(CANVAS_FULLSCREEN_EVENT, update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener(CANVAS_FULLSCREEN_EVENT, update);
    };
  }, []);
  return host;
}

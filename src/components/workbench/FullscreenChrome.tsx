// What an artifact shows only while it is full screen: a slim header (which
// artifact, how sure, Present, shortcuts, one way out), the laser pointer and
// the shortcuts card.

import { useEffect, useRef, type ReactNode } from "react";
import { CircleDot, Keyboard, Minimize2, MonitorPlay, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useArtifactFullscreen } from "./artifact-fullscreen";

export function FullscreenHeader({
  kindLabel, title, summary, viewing, outdated,
}: {
  kindLabel: string;
  title: string;
  /** The certainty bar, already rendered by the caller. */
  summary?: ReactNode;
  /** Someone else is editing: say so here, where it can be seen. */
  viewing?: { editorLabel: string; onTakeOver: () => void };
  /** This page is older than the data and only views until reloaded. */
  outdated?: boolean;
}) {
  const fs = useArtifactFullscreen();
  if (!fs?.active) return null;
  return (
    <div className="relative z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2" data-no-pan>
      {/* On a phone the title takes its own row and the buttons wrap below. */}
      <div className="min-w-0 flex-1 max-sm:basis-full">
        <div className="eyebrow truncate text-muted-foreground">{kindLabel}</div>
        <div className="font-display text-lg leading-tight truncate">{title}</div>
      </div>
      {/* Certainty stays in Present mode: it is what stakeholders validate. */}
      {summary && <div className="hidden md:block min-w-[160px] max-w-[300px]">{summary}</div>}
      {outdated && !fs.presenting && (
        <div className="flex items-center gap-2 rounded-lg bg-unresolved/10 px-2.5 py-1 text-xs">
          <span>Visu was updated</span>
          <Button size="sm" variant="outline" className="h-7 bg-card" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )}
      {viewing && !fs.presenting && (
        <div className="flex items-center gap-2 rounded-lg bg-unresolved/10 px-2.5 py-1 text-xs">
          <span><strong>{viewing.editorLabel}</strong> is editing</span>
          <Button size="sm" variant="outline" className="h-7 bg-card" onClick={viewing.onTakeOver}>Take over editing</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {fs.presenting && (
          <Button
            size="sm" variant="outline" aria-pressed={fs.laser}
            className={cn("h-8", fs.laser && "border-primary bg-primary/10 text-primary")}
            onClick={() => fs.setLaser(!fs.laser)}
            title="Laser pointer (L)"
          >
            <CircleDot className="size-3.5" /> <span className="hidden sm:inline">Laser</span>
          </Button>
        )}
        <Button
          size="sm" variant="outline" aria-pressed={fs.presenting}
          className={cn("h-8", fs.presenting && "border-primary bg-primary/10 text-primary")}
          onClick={() => fs.setPresenting(!fs.presenting)}
          title={fs.presenting ? "Back to editing (P)" : "Present: hide the editing tools (P)"}
          aria-label={fs.presenting ? "Back to editing" : "Present"}
        >
          {fs.presenting
            ? <><Pencil className="size-3.5" /> <span className="hidden sm:inline">Edit</span></>
            : <><MonitorPlay className="size-3.5" /> <span className="hidden sm:inline">Present</span></>}
        </Button>
        <Button
          size="icon" variant="ghost" className="h-8 w-8 [@media(hover:none)]:hidden" aria-pressed={fs.shortcutsOpen}
          onClick={() => fs.setShortcutsOpen(!fs.shortcutsOpen)}
          title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"
        >
          <Keyboard className="size-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={fs.exit} title="Exit full screen (Esc)" aria-label="Exit full screen">
          <Minimize2 className="size-3.5" /> <span className="hidden sm:inline">Exit full screen</span>
        </Button>
      </div>
    </div>
  );
}

/** Shortcuts; `editing` ones are left off the card while presenting. */
const SHORTCUTS: [string, string, "editing"?][] = [
  ["F", "Full screen on or off"],
  ["Esc", "Step back: close, stop presenting, leave full screen"],
  ["P", "Present or edit"],
  ["L", "Laser pointer (while presenting)"],
  ["Space + drag", "Move around (or drag with the middle button, or two fingers)"],
  ["+ / −", "Zoom in / out (or pinch, or Ctrl/⌘ + scroll)"],
  ["Shift 1", "Fit the diagram to the screen"],
  ["Shift 0", "Zoom to 100%"],
  ["Drag on empty space", "Select with a box (Shift adds to the selection)", "editing"],
  ["Shift click", "Add a shape to the selection, or take it out", "editing"],
  ["Double-click / Enter", "Type on a shape, or on a line's label", "editing"],
  ["Delete", "Delete the selection", "editing"],
  ["Arrows", "Nudge the selection (Shift: further)", "editing"],
  ["Ctrl/⌘ A", "Select everything", "editing"],
  ["Ctrl/⌘ D, C, V", "Duplicate, copy, paste (asks first)", "editing"],
  ["Ctrl/⌘ Z", "Undo", "editing"],
  ["Ctrl/⌘ Shift Z", "Redo", "editing"],
  ["?", "Show or hide this card"],
];

/** A small card listing the keys, opened with "?" or the keyboard button. */
export function ShortcutsCard() {
  const fs = useArtifactFullscreen();
  if (!fs?.shortcutsOpen) return null;
  return (
    <div
      className="absolute bottom-16 left-1/2 z-50 max-h-[calc(100%-11rem)] w-[min(420px,calc(100%-2rem))] -translate-x-1/2 overflow-y-auto rounded-xl border bg-card p-4 shadow-lg"
      role="region" aria-label="Keyboard shortcuts" data-no-pan
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Keyboard shortcuts</span>
        <button type="button" className="text-xs text-primary underline underline-offset-4" onClick={() => fs.setShortcutsOpen(false)}>
          Close
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {SHORTCUTS.filter(([, , kind]) => !(fs.presenting && kind === "editing")).map(([k, what]) => (
          <div key={k} className="contents">
            <dt><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono-tight text-xs">{k}</kbd></dt>
            <dd className="text-muted-foreground">{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A red dot with a short fading trail that follows the pointer, for pointing
 *  at a diagram while presenting. Drawn locally: whoever watches your shared
 *  screen sees it. */
export function LaserPointer({ hostRef }: { hostRef: React.RefObject<HTMLElement | null> }) {
  const fs = useArtifactFullscreen();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const on = !!fs?.laser;
  useEffect(() => {
    if (!on) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const trail: { x: number; y: number; t: number }[] = [];
    const TRAIL_MS = 420;
    let raf = 0;
    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      trail.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() });
    };
    const draw = () => {
      const now = performance.now();
      while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        const life = 1 - (now - b.t) / TRAIL_MS;
        ctx.strokeStyle = `rgba(220, 38, 38, ${0.55 * life})`;
        ctx.lineWidth = 6 * life + 1;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const head = trail[trail.length - 1];
      if (head) {
        ctx.fillStyle = "rgba(220, 38, 38, 0.25)";
        ctx.beginPath(); ctx.arc(head.x, head.y, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgb(220, 38, 38)";
        ctx.beginPath(); ctx.arc(head.x, head.y, 5, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    host.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [on, hostRef]);
  if (!on) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[60]" aria-hidden />;
}

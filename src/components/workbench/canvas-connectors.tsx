// Connectors (phase 6), the parts every diagram shares: a dot on each side
// of a shape to draw a line from, the drag that draws a line or moves one
// end of it to another shape (a dashed line follows the pointer and the
// shape it would land on is outlined), and the two end handles of a
// selected line. How a line is routed is in src/lib/canvas/connector.ts;
// selecting a line, and Delete / Esc / Enter on it, in canvas-selection.tsx.

import { useRef, useState, type RefObject } from "react";
import type { Rect } from "@/lib/canvas/layout";
import { anchor, type Point, type Side } from "@/lib/canvas/connector";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { ShapeListPopover } from "./shape-list-popover";
import { followPointer, useCanvas, type CanvasApi } from "./CanvasShell";
import { LAYER } from "./canvas-layers";

/** A line being drawn or re-attached: from a point to the pointer, and the
 *  shape it would land on if let go now. */
export interface LiveConnector { from: Point; to: Point; target: string | null }

/**
 * Drawing a new line from a shape, or moving one end of a line. Letting go
 * on a shape (one of `rects`, other than `exclude` unless `allowSelf`)
 * calls `done` with it; anywhere else does nothing.
 */
export function useConnectorDrag(o: {
  shellApi: RefObject<CanvasApi | null>;
  rects: Map<string, Rect>;
  canEdit: () => boolean;
}) {
  const [live, setLive] = useState<LiveConnector | null>(null);
  /** The shape under the pointer, if it is one a line can land on. */
  const shapeUnder = (ev: { clientX: number; clientY: number }, exclude: string | undefined, allowSelf: boolean) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const host = el?.closest("[data-shape-id], [data-node-id]") as HTMLElement | null;
    const id = host?.dataset.shapeId ?? host?.dataset.nodeId;
    if (!id || !o.rects.has(id)) return null;
    return id === exclude && !allowSelf ? null : id;
  };
  const start = (
    e: React.PointerEvent,
    from: Point,
    opts: { exclude?: string; allowSelf?: boolean; done: (targetId: string) => void },
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const api = o.shellApi.current;
    if (!api || !o.canEdit()) return;
    const allowSelf = !!opts.allowSelf;
    // A click on a dot or an end, without a drag, draws and moves nothing.
    let dragged = false;
    setLive({ from, to: from, target: null });
    followPointer(e, {
      move: (ev) => {
        if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        dragged = true;
        setLive({ from, to: api.screenToWorld(ev.clientX, ev.clientY), target: shapeUnder(ev, opts.exclude, allowSelf) });
      },
      up: (ev) => {
        setLive(null);
        const t = dragged ? shapeUnder(ev, opts.exclude, allowSelf) : null;
        if (t) opts.done(t);
      },
      cancel: () => setLive(null),
    });
  };
  return { live, start };
}

/** The dashed line that follows the pointer, and an outline round the
 *  shape it would land on. Drawn in the canvas, above the shapes. */
export function ConnectorPreview({ live, rects, color }: { live: LiveConnector | null; rects: Map<string, Rect>; color: string }) {
  if (!live) return null;
  const t = live.target ? rects.get(live.target) : null;
  return (
    <>
      {t && (
        <div
          data-edit-control aria-hidden
          className="pointer-events-none absolute rounded-xl"
          style={{
            left: t.x - 3, top: t.y - 3, width: t.w + 6, height: t.h + 6, zIndex: LAYER.preview,
            boxShadow: `0 0 0 2px var(--color-background), 0 0 0 4px ${color}`,
          }}
        />
      )}
      <svg data-edit-control aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ zIndex: LAYER.preview + 1 }}>
        <path
          d={`M ${live.from.x} ${live.from.y} L ${live.to.x} ${live.to.y}`}
          fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeDasharray="4 3" opacity={0.85}
        />
      </svg>
    </>
  );
}

const SIDES: { side: Side; place: string }[] = [
  { side: "top", place: "left-1/2 -top-2 -translate-x-1/2" },
  { side: "right", place: "-right-2 top-1/2 -translate-y-1/2" },
  { side: "bottom", place: "left-1/2 -bottom-2 -translate-x-1/2" },
  { side: "left", place: "-left-2 top-1/2 -translate-y-1/2" },
];

/**
 * A dot in the middle of each side of a shape, shown while the pointer is
 * over the shape: drag one to another shape to draw a line. Goes inside the
 * shape's own element (which must be positioned and have the `group` class).
 * Present mode and exports leave them out (data-edit-control).
 */
export function ConnectHandles({
  rect, onStart, title = "Drag to another shape to connect",
}: {
  /** The shape, in canvas units (where its lines start). */
  rect: Rect;
  onStart: (e: React.PointerEvent, from: Point) => void;
  title?: string;
}) {
  return (
    <>
      {SIDES.map(({ side, place }) => (
        <div
          key={side}
          data-no-pan data-edit-control
          onPointerDown={(e) => onStart(e, anchor(rect, side))}
          title={title}
          className={cn(
            "group/dot absolute z-10 h-3.5 w-3.5 opacity-0 transition cursor-crosshair",
            "group-hover:opacity-100 focus-within:opacity-100 before:absolute before:-inset-2 before:content-['']",
            place,
          )}
        >
          {/* The dot you see keeps its size on screen when zoomed out. */}
          <span className={cn(
            "counter-zoom pointer-events-none absolute inset-0 rounded-full border-2 bg-card shadow-sm transition-colors",
            "border-primary group-hover/dot:bg-primary",
          )} />
        </div>
      ))}
    </>
  );
}

/** The two ends of the selected line: drag one onto another shape to
 *  attach that end there. */
export function ConnectorEnds({
  from, to, onStart,
}: {
  from: Point;
  to: Point;
  onStart: (e: React.PointerEvent, end: "from" | "to") => void;
}) {
  return (
    <>
      {([["from", from], ["to", to]] as const).map(([end, p]) => (
        <div
          key={end}
          data-no-pan data-edit-control
          onPointerDown={(e) => onStart(e, end)}
          title={end === "from" ? "Drag to start this line from another shape" : "Drag to end this line at another shape"}
          className="counter-zoom absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-card shadow-sm cursor-grab before:absolute before:-inset-2 before:content-['']"
          style={{ left: p.x, top: p.y, zIndex: LAYER.handle }}
        />
      ))}
    </>
  );
}

/**
 * Under the selected line: where it starts and ends, each a list to pick
 * another shape from (the keyboard's way to re-attach a line, and a plain
 * statement of what it joins), and Delete. Drawn at a constant size, and
 * placed right after the line's label in the page so Tab reaches it next.
 */
export function LineBar({
  lineId, at, fromId, toId, shapes, allowSelf, what, onChange, onDelete,
}: {
  lineId: string;
  /** Where the line's label sits, in canvas units. */
  at: Point;
  fromId: string;
  toId: string;
  /** Every shape a line can join here, by name. */
  shapes: { id: string; name: string }[];
  /** Whether both ends may be the same shape (a state's loop). */
  allowSelf?: boolean;
  /** "line", "data flow", "transition". */
  what: string;
  onChange: (end: "from" | "to", id: string) => void;
  onDelete?: () => void;
}) {
  const { zoom } = useCanvas();
  const barRef = useRef<HTMLDivElement | null>(null);
  const nameOf = (id: string) => shapes.find((x) => x.id === id)?.name ?? id;
  // Back to the line's label once a list closes, so its keys work on.
  const focusLabel = () => barRef.current?.closest("[data-canvas-content]")
    ?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"] [data-edit-text]`)?.focus({ preventScroll: true });
  const pick = (end: "from" | "to", value: string, other: string) => (
    <ShapeListPopover
      title={end === "from" ? `Start this ${what} at` : `End this ${what} at`}
      items={shapes.filter((x) => allowSelf || x.id !== other || x.id === value)}
      current={value} onPick={(id) => onChange(end, id)} onClosed={focusLabel}
      trigger={
        <button
          type="button"
          aria-label={`${end === "from" ? "Starts at" : "Ends at"} ${nameOf(value)}. Change`}
          className="max-w-[10rem] truncate rounded border bg-background px-1.5 py-0.5 text-left text-xs text-foreground hover:bg-muted"
        >{nameOf(value)}</button>
      }
    />
  );
  return (
    <div
      ref={barRef}
      data-edit-control data-no-pan
      className="absolute"
      style={{ left: at.x, top: at.y + 14, transform: `translate(-50%, 0) scale(${1 / zoom})`, transformOrigin: "top center", zIndex: LAYER.bar }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border bg-card px-2 py-1 text-xs text-muted-foreground shadow-md" role="group" aria-label={`Selected ${what}`}>
        <span>From</span>{pick("from", fromId, toId)}
        <span>to</span>{pick("to", toId, fromId)}
        {onDelete && (
          <button
            type="button" onClick={onDelete} aria-label={`Delete this ${what}`} title={`Delete this ${what} (Delete key)`}
            className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

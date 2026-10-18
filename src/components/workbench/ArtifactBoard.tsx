import { useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoredCanvas, ViewKind } from "@/lib/session";
import { CanvasShell, useWorldDrag } from "@/components/workbench/CanvasShell";
import { ArtifactCounts, NewInstanceButton } from "@/components/workbench/ArtifactSidebar";
import { ALL_VIEW_KINDS, VIEW_KIND_META } from "@/lib/view-kind-meta";

type Frame = { x: number; y: number; w: number; h: number };

const CARD_W = 240;
const CARD_H = 132;
const COLS = 4;
const GAP = 32;

function defaultFrame(index: number): Frame {
  return {
    x: 40 + (index % COLS) * (CARD_W + GAP),
    y: 40 + Math.floor(index / COLS) * (CARD_H + GAP),
    w: CARD_W, h: CARD_H,
  };
}

/** Same cumulative-delta-from-drag-start pattern as ProcessCanvas's node drag --
 *  computing from the last pointermove instead of the drag's start position is
 *  what caused DFDView's node-drag jitter bug earlier this project. */
function useCardDrag(onDrag: (d: { dx: number; dy: number }) => void) {
  const worldDrag = useWorldDrag();
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      worldDrag(e, (dx, dy) => onDrag({ dx, dy }));
    },
  };
}

interface Props {
  canvases: StoredCanvas[];
  onOpen: (id: string) => void;
  onCreate: (viewKind: ViewKind, name: string) => void;
  onFrameChange: (id: string, frame: Frame) => void;
}

export function ArtifactBoard({ canvases, onOpen, onCreate, onFrameChange }: Props) {
  const [overrides, setOverrides] = useState<Record<string, Frame>>({});

  const framed = canvases.map((c, i) => ({
    canvas: c,
    frame: overrides[c.id] ?? c.frame ?? defaultFrame(i),
  }));

  const contentW = Math.max(1200, ...framed.map((f) => f.frame.x + f.frame.w + 200));
  const contentH = Math.max(800, ...framed.map((f) => f.frame.y + f.frame.h + 200));

  return (
    <div className="rounded-xl border bg-card h-[640px] flex flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b p-2.5">
        {ALL_VIEW_KINDS.map((viewKind) => (
          <NewInstanceButton
            key={viewKind} viewKind={viewKind}
            existingCount={canvases.filter((c) => (c.viewKind ?? c.kind) === viewKind).length}
            onCreate={onCreate}
            namesKind
          />
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <CanvasShell
          contentWidth={contentW} contentHeight={contentH} gridClassName="bp-grid-fine" initialView="fit"
          // A card dragged left of or above the others stays in the picture.
          shapes={framed.map(({ frame }) => ({ x: frame.x, y: frame.y, w: frame.w, h: frame.h }))}
        >
          {framed.map(({ canvas, frame }) => (
            <BoardCard
              key={canvas.id} canvas={canvas} frame={frame}
              onOpen={() => onOpen(canvas.id)}
              onDrag={(d) => {
                const next = { ...frame, x: frame.x + d.dx, y: frame.y + d.dy };
                setOverrides((cur) => ({ ...cur, [canvas.id]: next }));
                onFrameChange(canvas.id, next);
              }}
            />
          ))}
        </CanvasShell>
      </div>
    </div>
  );
}

function BoardCard({
  canvas, frame, onOpen, onDrag,
}: {
  canvas: StoredCanvas; frame: Frame; onOpen: () => void; onDrag: (d: { dx: number; dy: number }) => void;
}) {
  const drag = useCardDrag(onDrag);
  const meta = VIEW_KIND_META[canvas.viewKind ?? canvas.kind];
  const Icon = meta.icon;

  return (
    <div
      data-node
      className="absolute rounded-xl border bg-background shadow-sm hover:border-primary/50 transition-colors flex flex-col overflow-hidden animate-item-in"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b bg-muted/40">
        <button {...drag} data-no-pan tabIndex={-1} aria-hidden className="cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-foreground shrink-0">
          <GripVertical className="size-3.5" />
        </button>
        <Icon className="size-3.5 text-muted-foreground shrink-0" />
        <span className="eyebrow text-muted-foreground truncate">
          {meta.label}
        </span>
      </div>
      <button
        onClick={onOpen} data-no-pan
        className={cn("flex-1 flex flex-col justify-between p-2.5 text-left rounded-b-xl hover:bg-muted/30 transition focus-visible:outline-offset-[-2px]")}
      >
        <div className="text-sm font-semibold leading-tight line-clamp-2">{canvas.name}</div>
        <ArtifactCounts model={canvas.model} />
      </button>
    </div>
  );
}

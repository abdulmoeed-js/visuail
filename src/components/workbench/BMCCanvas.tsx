import { useLayoutEffect, useRef, useState } from "react";
import type { BMCModel, BMCBlock, BaseItem } from "@/data/samples";
import { EditableList } from "./EditableList";
import { cn } from "@/lib/utils";
import { AlertTriangle, X } from "lucide-react";
import { CanvasShell, useCanvas } from "./CanvasShell";
import { InlineEdit } from "./InlineEdit";
import { ConfidenceBadge, IdChip } from "./atoms";

interface Props {
  model: BMCModel;
  onAdd: (blockId: BMCBlock["id"], text: string) => void;
  onDelete: (blockId: BMCBlock["id"], itemId: string) => void;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
}

const DEFAULT_W = 1180;
const DEFAULT_H = 720;

export function BMCCanvas({ model, onAdd, onDelete, onUpdate }: Props) {
  // Per-block minimum-height overrides (resize handle drags this). Blocks are
  // free to grow past this to fit their content.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const h = (id: BMCBlock["id"], base: number) => heights[id] ?? base;
  const setH = (id: string, v: number) => setHeights((cur) => ({ ...cur, [id]: v }));

  const by = (id: BMCBlock["id"]) => model.blocks.find((b) => b.id === id)!;

  // Measure the rendered canvas so the CanvasShell viewport (and minimap)
  // grows to accommodate blocks that expanded past their default heights.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const report = () => setDims({
      w: Math.max(DEFAULT_W, el.scrollWidth),
      h: Math.max(DEFAULT_H, el.scrollHeight),
    });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <CanvasShell
      contentWidth={dims.w}
      contentHeight={dims.h}
      fullscreenLabel="Business Model Canvas — fullscreen"
      gridClassName="bp-grid-fine"
    >
      <div
        ref={contentRef}
        className="p-2"
        style={{ width: DEFAULT_W }}
      >
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: "1.15fr 1.15fr 1.5fr 1.15fr 1.15fr",
            gridTemplateRows: "auto auto auto",
            gridAutoRows: "auto",
          }}
        >
          <Block b={by("partnerships")} h={h("partnerships", 460)} setH={(v) => setH("partnerships", v)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} className="row-span-2" />

          <div className="row-span-2 grid grid-rows-2 gap-2">
            <Block b={by("activities")}  h={h("activities", 220)} setH={(v) => setH("activities", v)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
            <Block b={by("resources")}   h={h("resources", 220)}  setH={(v) => setH("resources", v)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
          </div>

          <Block b={by("value")} h={h("value", 460)} setH={(v) => setH("value", v)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} className="row-span-2" emphasis />

          <div className="row-span-2 grid grid-rows-2 gap-2">
            <Block b={by("relationships")} h={h("relationships", 220)} setH={(v) => setH("relationships", v)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
            <Block b={by("channels")}      h={h("channels", 220)}      setH={(v) => setH("channels", v)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
          </div>

          <Block b={by("segments")} h={h("segments", 460)} setH={(v) => setH("segments", v)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} className="row-span-2" />

          <Block b={by("costs")}   h={h("costs", 200)}   setH={(v) => setH("costs", v)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} style={{ gridColumn: "span 2" }} />
          <Block b={by("revenue")} h={h("revenue", 200)} setH={(v) => setH("revenue", v)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} style={{ gridColumn: "span 3" }} />
        </div>
      </div>
    </CanvasShell>
  );
}

function Block({
  b, h, setH, onAdd, onDelete, onUpdate, className, style, emphasis,
}: {
  b: BMCBlock;
  h: number;
  setH: (h: number) => void;
  onAdd: (id: BMCBlock["id"], text: string) => void;
  onDelete: (id: BMCBlock["id"], itemId: string) => void;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  className?: string;
  style?: React.CSSProperties;
  emphasis?: boolean;
}) {
  return (
    <section
      data-node
      className={cn(
        "relative rounded-lg border bg-card p-3 flex flex-col gap-2 group",
        emphasis && "border-primary/50 ring-1 ring-primary/20 bg-gradient-to-b from-primary/5 to-transparent",
        b.blockDrift && "border-drift bg-drift/5 animate-drift",
        className,
      )}
      style={{ ...style, minHeight: h }}
    >
      <header className="flex items-center justify-between border-b border-dashed pb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
            {b.id}
          </span>
          <h3 className={cn("text-sm font-semibold", emphasis && "text-primary")}>{b.title}</h3>
        </div>
        <span className="text-[10px] font-mono-tight text-muted-foreground">{b.items.length}</span>
      </header>

      {b.blockDrift && (
        <div className="flex items-start gap-1.5 rounded border border-drift/60 bg-drift/10 p-1.5 text-[11px] text-drift">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>{b.driftNote}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <EditableList
          items={b.items}
          onAdd={(t) => onAdd(b.id, t)}
          onDelete={(id) => onDelete(b.id, id)}
          onEdit={(id, text) => onUpdate(id, { text })}
          placeholder={`Add to ${b.title.toLowerCase()}…`}
          compact
          showIds={false}
        />
      </div>

      <BlockResizeHandle h={h} setH={setH} />
    </section>
  );
}

function BlockResizeHandle({ h, setH }: { h: number; setH: (h: number) => void }) {
  const { zoom } = useCanvas();
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startY = e.clientY;
    const startH = h;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const nh = Math.max(120, Math.min(700, startH + (ev.clientY - startY) / zoom));
      setH(nh);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={onPointerDown}
      data-no-pan
      title="Resize block height"
      className="absolute bottom-0 left-1/2 -translate-x-1/2 h-2 w-16 rounded-t-md cursor-ns-resize bg-transparent hover:bg-primary/20 transition"
    />
  );
}

// Unused symbols kept exported off (avoid dead-import warnings).
export const _BMC_unused = { X, IdChip, ConfidenceBadge, InlineEdit };

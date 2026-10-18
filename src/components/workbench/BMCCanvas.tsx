import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { BMCModel, BMCBlock, BaseItem } from "@/data/samples";
import { EditableList } from "./EditableList";
import { cn } from "@/lib/utils";
import { AlertTriangle, X } from "lucide-react";
import { CanvasShell, useWorldDrag } from "./CanvasShell";
import { useCanvasViewState, useNoteLayoutMove } from "./canvas-view-store";
import { InlineEdit } from "./InlineEdit";
import { IdChip } from "./atoms";
import { gradeOf } from "@/lib/grade";
import { SAVE_LAYOUTS, layoutOf } from "@/lib/canvas/layout";

interface Props {
  model: BMCModel;
  onAdd: (blockId: BMCBlock["id"], text: string) => void;
  onDelete: (blockId: BMCBlock["id"], itemId: string) => void;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  /** Saves a block's height (see ArtifactEditing). */
  onSetBlockHeight?: (blockId: string, h: number) => boolean;
  /** Whether this tab may edit; says why not when it may not. */
  canEdit?: () => boolean;
}

/** May this tab resize blocks? Asked when a resize starts. */
const alwaysEditable = () => true;
const EditGuardCtx = createContext<() => boolean>(alwaysEditable);

const DEFAULT_W = 1180;
const DEFAULT_H = 720;

export function BMCCanvas({ model, onAdd, onDelete, onUpdate, onSetBlockHeight, canEdit }: Props) {
  // Per-block minimum-height overrides (resize handle drags this). Blocks are
  // free to grow past this to fit their content. A resize in progress is
  // drawn from here; once saved (SAVE_LAYOUTS) the model's height draws it.
  const [heights, setHeights] = useCanvasViewState<Record<string, number>>("bmc:heights", {});
  const saved = layoutOf(model, "bmc")?.blocks;
  const h = (id: BMCBlock["id"], base: number) => heights[id] ?? saved?.[id]?.h ?? base;
  const noteMove = useNoteLayoutMove();
  /** Height props for one block. A resize counts as "a move" for Undo only
   *  when the height really changes -- compared with the height the block has
   *  now, which for one never resized is its default, not "no entry". */
  const size = (id: BMCBlock["id"], base: number) => ({
    h: h(id, base),
    setH: (v: number, done?: boolean) => {
      if (!SAVE_LAYOUTS && h(id, base) !== v) noteMove(model);
      setHeights((cur) => ({ ...cur, [id]: v }));
      if (!done || !SAVE_LAYOUTS || !onSetBlockHeight) return;
      onSetBlockHeight(id, v);
      setHeights((cur) => { const next = { ...cur }; delete next[id]; return next; });
    },
  });

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
    <EditGuardCtx.Provider value={canEdit ?? alwaysEditable}>
    <CanvasShell
      contentWidth={dims.w}
      contentHeight={dims.h}
      fullscreenLabel="Business Model Canvas — fullscreen"
      viewId="bmc"
      // A canvas is read as a whole: nine blocks side by side, and losing a
      // column loses the point. So its floor is lower than a flow diagram's:
      // on a laptop-width canvas it opens whole at around two-thirds size,
      // still readable, rather than at 80% with Customer Segments cut off.
      // Narrower than that it opens cut, and the Fit button is picked out.
      readableZoom={0.6}
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
          <Block b={by("partnerships")} {...size("partnerships", 460)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} className="row-span-2" />

          <div className="row-span-2 grid grid-rows-2 gap-2">
            <Block b={by("activities")}  {...size("activities", 220)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
            <Block b={by("resources")}   {...size("resources", 220)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
          </div>

          <Block b={by("value")} {...size("value", 460)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} className="row-span-2" emphasis />

          <div className="row-span-2 grid grid-rows-2 gap-2">
            <Block b={by("relationships")} {...size("relationships", 220)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
            <Block b={by("channels")}      {...size("channels", 220)}
              onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} />
          </div>

          <Block b={by("segments")} {...size("segments", 460)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} className="row-span-2" />

          <Block b={by("costs")}   {...size("costs", 200)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} style={{ gridColumn: "span 2" }} />
          <Block b={by("revenue")} {...size("revenue", 200)}
            onAdd={onAdd} onDelete={onDelete} onUpdate={onUpdate} style={{ gridColumn: "span 3" }} />
        </div>
      </div>
    </CanvasShell>
    </EditGuardCtx.Provider>
  );
}

function Block({
  b, h, setH, onAdd, onDelete, onUpdate, className, style, emphasis,
}: {
  b: BMCBlock;
  h: number;
  setH: (h: number, done?: boolean) => void;
  onAdd: (id: BMCBlock["id"], text: string) => void;
  onDelete: (id: BMCBlock["id"], itemId: string) => void;
  onUpdate: (id: string, patch: Partial<BaseItem>) => void;
  className?: string;
  style?: React.CSSProperties;
  emphasis?: boolean;
}) {
  // Worked out from the items each time: the stored `blockDrift` flag is not
  // cleared when the changed items are dealt with, so it goes stale.
  const changed = b.items.filter((i) => gradeOf(i).grade === "changed").length;
  return (
    <section
      data-node
      className={cn(
        "relative rounded-lg border bg-card p-3 flex flex-col gap-2 group",
        emphasis && "border-primary/50 ring-1 ring-primary/20 bg-gradient-to-b from-primary/5 to-transparent",
        changed > 0 && "border-drift bg-drift/5 animate-drift",
        className,
      )}
      style={{ ...style, minHeight: h }}
    >
      <header className="flex items-center justify-between border-b border-dashed pb-1.5">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-muted-foreground">
            {b.id}
          </span>
          <h3 className={cn("text-sm font-semibold", emphasis && "text-primary")}>{b.title}</h3>
        </div>
        <span className="text-[10px] font-mono-tight text-muted-foreground">{b.items.length}</span>
      </header>

      {changed > 0 && (
        <div className="flex items-start gap-1.5 rounded border border-drift/60 bg-drift/10 p-1.5 text-[11px] text-drift-ink">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>{changed} {changed === 1 ? "item" : "items"} changed in the source</span>
        </div>
      )}

      <div className="flex-1 min-h-0">
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

function BlockResizeHandle({ h, setH }: { h: number; setH: (h: number, done?: boolean) => void }) {
  const worldDrag = useWorldDrag();
  const mayEdit = useContext(EditGuardCtx);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!mayEdit()) return;
    const startH = h;
    // A press that never moved is a click, not a resize: nothing to save.
    let last: number | null = null;
    const finish = () => { if (last !== null && last !== startH) setH(last, true); };
    worldDrag(e, (_dx, dy) => { last = Math.max(120, Math.min(700, startH + dy)); setH(last); }, { up: finish, cancel: finish });
  };
  return (
    <div
      onPointerDown={onPointerDown}
      data-no-pan
      data-edit-control
      title="Resize block height"
      className="absolute bottom-0 left-1/2 -translate-x-1/2 h-2 w-16 rounded-t-md cursor-ns-resize bg-transparent hover:bg-primary/20 transition"
    />
  );
}

// Unused symbols kept exported off (avoid dead-import warnings).
export const _BMC_unused = { X, IdChip, InlineEdit };

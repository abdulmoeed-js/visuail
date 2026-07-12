import type { BMCModel, BMCBlock } from "@/data/samples";
import { EditableList } from "./EditableList";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface Props {
  model: BMCModel;
  onAdd: (blockId: BMCBlock["id"], text: string) => void;
  onDelete: (blockId: BMCBlock["id"], itemId: string) => void;
}

// Classic Osterwalder 9-block layout using CSS grid.
export function BMCCanvas({ model, onAdd, onDelete }: Props) {
  const by = (id: BMCBlock["id"]) => model.blocks.find((b) => b.id === id)!;

  return (
    <div className="bp-grid-fine rounded-lg border p-3">
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: "1.15fr 1.15fr 1.5fr 1.15fr 1.15fr",
          gridTemplateRows: "minmax(220px, auto) minmax(220px, auto) minmax(160px, auto)",
        }}
      >
        <Block b={by("partnerships")} onAdd={onAdd} onDelete={onDelete} className="row-span-2" />
        <div className="grid grid-rows-2 gap-2">
          <Block b={by("activities")}  onAdd={onAdd} onDelete={onDelete} />
          <Block b={by("resources")}   onAdd={onAdd} onDelete={onDelete} />
        </div>
        <Block b={by("value")} onAdd={onAdd} onDelete={onDelete} className="row-span-2" emphasis />
        <div className="grid grid-rows-2 gap-2">
          <Block b={by("relationships")} onAdd={onAdd} onDelete={onDelete} />
          <Block b={by("channels")}      onAdd={onAdd} onDelete={onDelete} />
        </div>
        <Block b={by("segments")} onAdd={onAdd} onDelete={onDelete} className="row-span-2" />

        {/* Bottom row */}
        <Block b={by("costs")}   onAdd={onAdd} onDelete={onDelete} className="col-span-2 md:col-span-2" style={{ gridColumn: "span 2" }} />
        <Block b={by("revenue")} onAdd={onAdd} onDelete={onDelete} className="col-span-3" style={{ gridColumn: "span 3" }} />
      </div>
    </div>
  );
}

function Block({
  b, onAdd, onDelete, className, style, emphasis,
}: {
  b: BMCBlock;
  onAdd: (id: BMCBlock["id"], text: string) => void;
  onDelete: (id: BMCBlock["id"], itemId: string) => void;
  className?: string;
  style?: React.CSSProperties;
  emphasis?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative rounded-lg border bg-card p-3 flex flex-col gap-2 min-h-[220px]",
        emphasis && "border-primary/50 ring-1 ring-primary/20 bg-gradient-to-b from-primary/5 to-transparent",
        b.blockDrift && "border-drift bg-drift/5 animate-drift",
        className,
      )}
      style={style}
    >
      <header className="flex items-center justify-between border-b border-dashed pb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
            {b.id}
          </span>
          <h3 className={cn("text-sm font-semibold", emphasis && "text-primary")}>{b.title}</h3>
        </div>
        <span className="text-[10px] font-mono-tight text-muted-foreground">
          {b.items.length}
        </span>
      </header>

      {b.blockDrift && (
        <div className="flex items-start gap-1.5 rounded border border-drift/60 bg-drift/10 p-1.5 text-[11px] text-drift">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          <span>{b.driftNote}</span>
        </div>
      )}

      <EditableList
        items={b.items}
        onAdd={(t) => onAdd(b.id, t)}
        onDelete={(id) => onDelete(b.id, id)}
        placeholder={`Add to ${b.title.toLowerCase()}…`}
        compact
        showIds={false}
      />
    </section>
  );
}

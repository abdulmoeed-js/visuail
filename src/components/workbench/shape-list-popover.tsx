// A list of the diagram's shapes to pick one from, with a filter: "Draw a
// line to…" in the selection bar, and where a selected line starts and
// ends. Nothing changes until a shape is picked (a list, not a <select>,
// whose arrow keys would re-attach a line at every press on Windows).

import { useState, type ReactElement } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function ShapeListPopover({
  trigger, title, items, current, onPick, onClosed,
}: {
  /** The button that opens the list. */
  trigger: ReactElement;
  title: string;
  items: { id: string; name: string }[];
  /** The shape picked now, marked in the list. */
  current?: string;
  onPick: (id: string) => void;
  /** Where focus goes once the list closes, instead of back to the trigger
   *  (so the diagram's keys work on straight away). */
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = items.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(""); }}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-64 p-2" align="start"
        // Rendered elsewhere in the page, but React still passes its presses
        // up to the bar that opened it, which holds focus still on press.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => { if (onClosed) { e.preventDefault(); onClosed(); } }}
      >
        <div className="mb-1.5 text-xs font-medium">{title}</div>
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter shapes"
          aria-label="Filter shapes" className="mb-1.5 w-full rounded border bg-background px-2 py-1 text-xs"
        />
        <ul className="max-h-56 overflow-y-auto" aria-label="Shapes">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button" aria-current={t.id === current ? "true" : undefined}
                onClick={() => { setOpen(false); setQ(""); if (t.id !== current) onPick(t.id); }}
                className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted focus-visible:bg-muted aria-[current=true]:font-semibold"
              >{t.name}</button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No shape matches.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

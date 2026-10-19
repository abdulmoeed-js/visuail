// The words on a line -- a data flow's name, a transition's event, a
// connector's label -- typed where they sit, like text on a shape: a
// double-click (or Enter when focused) starts typing, Enter saves, Esc
// cancels, and clearing the words leaves the line unnamed.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useArtifactFullscreen } from "./artifact-fullscreen";
import { InlineEdit } from "./InlineEdit";
import { DeleteX } from "./canvas-controls";
import { LAYER } from "./canvas-layers";
import { focusCameFromTab } from "./canvas-selection";

export function LineLabel({
  x, y, value, placeholder, onChange, onDelete, deleteLabel, fieldLabel, quiet, zIndex = LAYER.lineLabel, children, lineId, onSelect, name,
}: {
  /** What the line joins ("Data flow from … to …"), for screen readers. */
  name?: string;
  /** A click on the words, or focus on them, selects the line (they often
   *  cover a short one; and the keys then act on the line). */
  onSelect?: () => void;
  /** The line's id: Enter on a selected line, or a double-click on it,
   *  types its label (canvas-selection). */
  lineId?: string;
  /** The middle of the line, in canvas units. */
  x: number;
  y: number;
  value: string;
  /** Shown while there are no words yet: "label", "event". */
  placeholder: string;
  /** Without it the words are shown, not edited. */
  onChange?: (v: string) => void;
  /** A small X beside the words deletes the line. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** What the words are, for screen readers ("Data flow label"). */
  fieldLabel: string;
  /** An unnamed line shows its placeholder only on hover or focus (lines
   *  that are usually left unnamed, such as a Process map's connectors). */
  quiet?: boolean;
  zIndex?: number;
  /** More controls for the line, drawn to the right of the words. */
  children?: ReactNode;
}) {
  const presenting = !!useArtifactFullscreen()?.presenting;
  // Neutral, like the line it names: the trust colours mean trust only.
  const chip = "rounded border border-border bg-card px-1.5 py-0.5 text-2xs font-mono-tight whitespace-nowrap text-foreground";
  const at = { left: x, top: y, zIndex };
  // Presenting: the words stay, as plain text; an unnamed line's
  // placeholder is only an invitation to type, so it goes.
  if (presenting || (!onChange && !onDelete && !children)) {
    if (!value) return null;
    return (
      <div className="absolute -translate-x-1/2 -translate-y-1/2" style={at}>
        <span className={cn("block", chip)}>{value}</span>
      </div>
    );
  }
  return (
    <div
      data-no-pan data-line-label data-line-id={lineId}
      className="group/line absolute -translate-x-1/2 -translate-y-1/2" style={at}
      onPointerDown={(e) => { if (e.button !== 0 || !onSelect) return; e.stopPropagation(); onSelect(); }}
      onFocus={() => { if (focusCameFromTab()) onSelect?.(); }}
    >
      {onChange ? (
        <div
          // An unnamed line's placeholder is an editing aid: Present mode and
          // exports leave it out (data-edit-control).
          {...(!value ? { "data-edit-control": "" } : {})}
          className={cn(
            chip,
            !value && (quiet
              ? "opacity-0 group-hover/line:opacity-100 focus-within:opacity-100"
              : "opacity-70 group-hover/line:opacity-100 focus-within:opacity-100"),
          )}
        >
          <InlineEdit
            value={value} onChange={onChange} placeholder={placeholder}
            activate="double" allowEmpty label={name ? `${name}, ${fieldLabel.toLowerCase()}` : fieldLabel}
            className="min-w-[2ch] not-italic"
          />
        </div>
      ) : value ? (
        <span className={cn("block", chip)}>{value}</span>
      ) : (
        // Room for the controls beside an unnamed line that can't be named.
        <span className="block size-1" />
      )}
      {(onDelete || children) && (
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-1 flex items-center gap-1" data-edit-control>
          {onDelete && (
            <DeleteX label={deleteLabel ?? "Delete this line"} onClick={onDelete} floating hoverGroup="group/line" />
          )}
          {children}
        </div>
      )}
    </div>
  );
}

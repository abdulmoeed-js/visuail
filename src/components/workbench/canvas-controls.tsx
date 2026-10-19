// Small controls every diagram draws the same way.

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The small × that deletes a shape (in its header) or a line (beside its
 * label, `floating`, on a card so it shows against the canvas). Shown while
 * the pointer is over its shape or line, or when it has focus; a margin
 * around it takes the click too. An editing aid: Present mode and exports
 * leave it out.
 */
export function DeleteX({ label, onClick, floating, hoverGroup = "group" }: {
  /** What it deletes, said in full: "Delete step “Check stock”". */
  label: string;
  onClick: () => void;
  floating?: boolean;
  /** The Tailwind group whose hover shows it ("group" or "group/line"). */
  hoverGroup?: "group" | "group/line";
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      data-no-pan data-edit-control
      aria-label={label} title={label}
      className={cn(
        "relative shrink-0 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:opacity-100 before:absolute before:-inset-1 before:content-['']",
        hoverGroup === "group" ? "group-hover:opacity-100 focus-within:opacity-100" : "group-hover/line:opacity-100",
        floating && "grid size-4 place-items-center rounded-full border bg-card",
      )}
    >
      <X className={floating ? "size-2.5" : "size-3"} />
    </button>
  );
}

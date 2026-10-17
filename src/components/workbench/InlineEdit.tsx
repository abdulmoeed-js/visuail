import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useArtifactFullscreen } from "./artifact-fullscreen";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
  as?: "block" | "inline";
  /** What this field is, for screen readers (e.g. "Preconditions for TC-1").
   *  Names the edit field, and prefixes the text when not editing. */
  label?: string;
}

/**
 * Click-to-edit text. Enter to save, Escape to cancel.
 * Reachable from the keyboard too: Tab to it, then Enter or Space to edit.
 * Stops propagation so it doesn't trigger canvas pan or node drag.
 */
export function InlineEdit({
  value, onChange, className, multiline, placeholder, as = "inline", label,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const presenting = !!useArtifactFullscreen()?.presenting;
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const displayRef = useRef<HTMLElement | null>(null);
  // Set when editing ends from the keyboard (Enter/Escape), so focus goes
  // back to the text instead of being dropped on the page. A click away
  // ends editing too, and must leave focus wherever the click put it.
  const refocus = useRef(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useLayoutEffect(() => {
    if (editing && ref.current) {
      // The field appears exactly where the text that was clicked sits, so
      // there is nothing to scroll to. Left to the browser, focusing one that
      // pokes out of a canvas frame scrolls the frame and the page.
      ref.current.focus({ preventScroll: true });
      if ("select" in ref.current) (ref.current as HTMLInputElement).select();
    } else if (!editing && refocus.current) {
      refocus.current = false;
      displayRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onChange(v);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (editing && !presenting) {
    const common = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onClick: stop,
      onPointerDown: stop,
      onKeyDown: (e: React.KeyboardEvent) => {
        // Enter commits (Shift+Enter or Ctrl/Meta+Enter inserts a newline in multiline).
        if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); refocus.current = true; commit(); }
        else if (e.key === "Escape") { e.preventDefault(); refocus.current = true; cancel(); }
      },
      "aria-label": label,
      placeholder,
      className: cn(
        "w-full bg-background/90 outline-none ring-2 ring-verified rounded px-1 py-0.5",
        multiline ? "resize-none" : "",
        className,
      ),
    };
    return multiline
      ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={2} {...common} />
      : <input  ref={ref as React.RefObject<HTMLInputElement>}  {...common} />;
  }

  const Tag = as === "block" ? "div" : "span";
  const shown = value || placeholder || "—";
  // Presenting: the text is shown, not edited, so a click on a call never
  // turns a label into a text box.
  // An empty field shows a dash, not its editing prompt: to an audience a
  // prompt such as "Given the current state, when..." reads as content.
  if (presenting) return <Tag className={cn("px-1 -mx-1", !value && "text-muted-foreground", className)}>{value || "—"}</Tag>;
  return (
    <Tag
      ref={(el: HTMLElement | null) => { displayRef.current = el; }}
      role="button"
      tabIndex={0}
      aria-label={label ? `${label}: ${shown}` : undefined}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }
      }}
      onPointerDown={stop}
      className={cn(
        "cursor-text rounded px-1 -mx-1 hover:bg-verified/10 hover:ring-1 hover:ring-verified/30 transition",
        !value && "text-muted-foreground italic",
        className,
      )}
      title="Click to edit"
    >
      {shown}
    </Tag>
  );
}

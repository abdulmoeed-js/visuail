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
  /** "click" (lists, tables, pop-ups): a click starts typing. "double" (text
   *  on a diagram shape): a click belongs to the shape -- it selects it, or
   *  starts moving it -- and a double-click, Enter (when focused) or Enter/F2
   *  on the selected shape starts typing (EDIT_TEXT_EVENT). */
  activate?: "click" | "double";
  /** Clearing the text saves it empty (a line's label), instead of keeping
   *  what was there (an item's name, which can't be blank). */
  allowEmpty?: boolean;
}

/** Sent to a shape's text (marked `data-edit-text`) to start typing on it,
 *  for Enter or F2 on a selected shape. */
export const EDIT_TEXT_EVENT = "visu:edit-text";

/**
 * Text you can edit where it is. Enter to save, Escape to cancel.
 * Reachable from the keyboard too: Tab to it, then Enter or Space to edit.
 * A click starts typing ("click"), or on a diagram shape a double-click does
 * ("double"); see `activate`.
 */
export function InlineEdit({
  value, onChange, className, multiline, placeholder, as = "inline", label, activate = "click", allowEmpty,
}: Props) {
  const onShape = activate === "double";
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
  // Enter or F2 on a selected shape asks its text to start typing.
  useEffect(() => {
    const el = displayRef.current;
    if (!onShape || !el) return;
    const start = () => setEditing(true);
    el.addEventListener(EDIT_TEXT_EVENT, start);
    return () => el.removeEventListener(EDIT_TEXT_EVENT, start);
  });
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

  // A text box grows with what is typed, so long text never hides behind a
  // scroll bar (and the shape around it grows too: see ProcessCanvas).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!editing || !multiline || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing, multiline, draft]);

  const commit = () => {
    const v = draft.trim();
    if ((v || allowEmpty) && v !== value) onChange(v);
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
        "w-full bg-background/90 outline-none ring-2 ring-primary rounded px-1 py-0.5",
        multiline ? "resize-none overflow-hidden block" : "",
        className,
      ),
    };
    return multiline
      ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={1} {...common} />
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
      {...(onShape
        // On a shape a click is the shape's; typing starts on a double-click.
        ? { onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); setEditing(true); }, "data-edit-text": "" }
        : { onClick: (e: React.MouseEvent) => { e.stopPropagation(); setEditing(true); } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }
      }}
      onPointerDown={onShape ? undefined : stop}
      className={cn(
        "rounded px-1 -mx-1 transition",
        onShape ? "cursor-default" : "cursor-text hover:bg-primary/10 hover:ring-1 hover:ring-primary/30",
        !value && "text-muted-foreground italic",
        className,
      )}
      title={onShape ? "Double-click to edit" : "Click to edit"}
    >
      {shown}
    </Tag>
  );
}

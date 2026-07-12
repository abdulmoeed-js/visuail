import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
  as?: "block" | "inline";
}

/**
 * Click-to-edit text. Enter to save, Escape to cancel.
 * Stops propagation so it doesn't trigger canvas pan or node drag.
 */
export function InlineEdit({
  value, onChange, className, multiline, placeholder, as = "inline",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useLayoutEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if ("select" in ref.current) (ref.current as HTMLInputElement).select();
    }
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onChange(v);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (editing) {
    const common = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onClick: stop,
      onPointerDown: stop,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      },
      className: cn(
        "w-full bg-background/90 outline-none ring-2 ring-verified/60 rounded px-1 py-0.5",
        multiline ? "resize-none" : "",
        className,
      ),
    };
    return multiline
      ? <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={2} {...common} />
      : <input  ref={ref as React.RefObject<HTMLInputElement>}  {...common} />;
  }

  const Tag = as === "block" ? "div" : "span";
  return (
    <Tag
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onPointerDown={stop}
      className={cn(
        "cursor-text rounded px-1 -mx-1 hover:bg-verified/10 hover:ring-1 hover:ring-verified/30 transition",
        !value && "text-muted-foreground italic",
        className,
      )}
      title="Click to edit"
    >
      {value || placeholder || "—"}
    </Tag>
  );
}

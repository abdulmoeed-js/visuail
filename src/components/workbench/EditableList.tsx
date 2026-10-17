import { useEffect, useRef, useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";
import { ItemCommentsPopover } from "./ItemCommentsPopover";
import type { BaseItem } from "@/data/samples";
import { gradeOf, quoteMissing, GROUNDING_NOTE } from "@/lib/grade";

/** Older projects recorded a failed quote check only as this note (grade.ts). */

/** A snippet is shown as the source's own words only when the check found it there. */
const quoteFound = (item: BaseItem) =>
  !quoteMissing(item);

/** What the sources disagree about, without the stored prefix (merge.ts) or
 *  the old quote-check note. */
const disagreement = (item: BaseItem) =>
  (item.conflictNote ?? "")
    .replace(GROUNDING_NOTE, "")
    .replace(/^(Conflicting sources|Sources disagree)\s*[—–-]\s*/i, "")
    .trim();

interface Props {
  items: BaseItem[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  onEdit?: (id: string, text: string) => void;
  idPrefix?: string;
  placeholder?: string;
  /** Screen-reader name for the add field; defaults to the placeholder
   *  without its trailing ellipsis. */
  label?: string;
  compact?: boolean;
  showIds?: boolean;
  /** Only set on the real project page -- the marketing demo has no
   *  project/comments backend, so these stay undefined there and no
   *  comment UI renders. */
  projectId?: string;
  commentCounts?: Record<string, number>;
  onCommentCountChange?: (itemId: string, delta: number) => void;
  /** Set when arriving from the dashboard's comments inbox -- scrolls the
   *  matching row into view, briefly highlights it, and opens its thread. */
  focusItemId?: string;
}

export function EditableList({
  items, onAdd, onDelete, onEdit,
  placeholder = "Add item…", label, compact, showIds = true,
  projectId, commentCounts, onCommentCountChange, focusItemId,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focusItemId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusItemId]);

  const submit = () => {
    const t = draft.trim();
    if (t) onAdd(t);
    setDraft("");
    setAdding(false);
  };

  return (
    <ul className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")}>
      {items.map((item) => {
        const g = gradeOf(item);
        const conflictText = g.grade === "disagree" ? disagreement(item) : "";
        // Hand-made items and disagreements carry no quote of their own.
        const quotable = !g.provenance && g.grade !== "disagree" && !!item.snippet;
        const missingQuote = quotable && !quoteFound(item);
        const showQuote = quotable && !missingQuote;
        return (
          <li
            key={item.id}
            ref={item.id === focusItemId ? focusRef : undefined}
            className={cn(
              "group relative flex items-start gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm animate-item-in",
              g.grade === "unclear" && "border-dashed border-unresolved/60 bg-unresolved/5",
              (g.grade === "changed" || g.grade === "disagree") && "border-drift bg-drift/5 animate-drift",
              g.provenance && "user-added",
              item.id === focusItemId && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
          >
            {showIds && <IdChip id={item.id} />}
            <div className="flex-1 leading-snug min-w-0">
              {onEdit ? (
                <InlineEdit value={item.text} onChange={(v) => onEdit(item.id, v)} className="text-foreground" multiline />
              ) : (
                <span className="text-foreground break-words">{item.text}</span>
              )}
              {/* How sure, in a word, on the line under the text, followed by
               *  what the sources disagree about, why the quote is missing, or
               *  the source's own words. Beside the text, the chip squeezed a
               *  narrow canvas block's text down to a word or two. */}
              <div className="mt-1 text-[11px] leading-snug">
                <ConfidenceBadge item={item} />
                {/* The chip already reads its reason to screen readers, so these
                    visible repeats are hidden from them. */}
                {conflictText && <span aria-hidden className="ml-1.5 text-drift-ink break-words">{conflictText}</span>}
                {missingQuote && <span aria-hidden={g.grade === "unclear"} className="ml-1.5 text-muted-foreground">The quote for this item wasn't found in the source.</span>}
                {showQuote && <span className="ml-1.5 italic text-muted-foreground break-words">“{item.snippet}”</span>}
              </div>
            </div>
            {projectId && (
              <ItemCommentsPopover
                projectId={projectId} itemId={item.id}
                count={commentCounts?.[item.id] ?? 0}
                onCountChange={onCommentCountChange ?? (() => {})}
                autoOpen={item.id === focusItemId}
              />
            )}
            <button
              data-edit-control
              onClick={() => onDelete(item.id)}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition text-muted-foreground hover:text-destructive"
              aria-label="Delete item"
            >
              <X className="size-3.5" />
            </button>
          </li>
        );
      })}
      {/* The add row is an editing tool: Present mode hides it (styles.css). */}
      {adding ? (
        <li className="flex items-center gap-1.5" data-edit-control>
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") { setAdding(false); setDraft(""); }
            }}
            placeholder={placeholder}
            aria-label={label ?? placeholder.replace(/…$/, "")}
            className="h-8 text-sm"
          />
          <Button size="icon" variant="ghost" onClick={submit} className="h-8 w-8" aria-label="Add item">
            <Check className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => { setAdding(false); setDraft(""); }} className="h-8 w-8" aria-label="Cancel">
            <X className="size-4" />
          </Button>
        </li>
      ) : (
        <li data-edit-control>
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:border-verified hover:text-verified-ink hover:bg-verified/5 transition"
          >
            <Plus className="size-3.5" />
            Add item
          </button>
        </li>
      )}
    </ul>
  );
}

import { useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, IdChip } from "./atoms";
import type { BaseItem } from "@/data/samples";

interface Props {
  items: BaseItem[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  idPrefix?: string;
  placeholder?: string;
  compact?: boolean;
  showIds?: boolean;
}

export function EditableList({
  items, onAdd, onDelete, placeholder = "Add item…", compact, showIds = true,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const t = draft.trim();
    if (t) onAdd(t);
    setDraft("");
    setAdding(false);
  };

  return (
    <ul className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")}>
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "group relative flex items-start gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm animate-item-in",
            item.confidence < 0.7 && !item.userAdded && "border-dashed border-unresolved/60 bg-unresolved/5",
            item.drift && "border-drift bg-drift/5 animate-drift",
            item.userAdded && "user-added",
          )}
        >
          {showIds && <IdChip id={item.id} />}
          <div className="flex-1 leading-snug">
            <span className="text-foreground">{item.text}</span>
            {item.snippet && (
              <div className="mt-1 flex gap-1.5 text-[11px] italic text-muted-foreground">
                <span className="text-unresolved">“</span>
                <span>{item.snippet}</span>
              </div>
            )}
          </div>
          <ConfidenceBadge item={item} />
          <button
            onClick={() => onDelete(item.id)}
            className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive"
            aria-label="Delete item"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
      {adding ? (
        <li className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") { setAdding(false); setDraft(""); }
            }}
            placeholder={placeholder}
            className="h-8 text-sm"
          />
          <Button size="icon" variant="ghost" onClick={submit} className="h-8 w-8">
            <Check className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => { setAdding(false); setDraft(""); }} className="h-8 w-8">
            <X className="size-4" />
          </Button>
        </li>
      ) : (
        <li>
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:border-verified hover:text-verified hover:bg-verified/5 transition"
          >
            <Plus className="size-3.5" />
            Add item
          </button>
        </li>
      )}
    </ul>
  );
}

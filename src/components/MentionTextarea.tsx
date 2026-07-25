// A Textarea with @mention autocomplete against an org's member list.
// Shared by CommentsDialog (project-wide thread) and ItemCommentsPopover
// (per-item thread) so the typing experience is identical in both places.
// Actual mention *resolution* (turning "@localpart" into a real ping)
// happens server-side in sessionStore.addComment -- this component's job
// is only to make typing one pleasant, not to be the source of truth.

import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { sessionStore, type OrgMember } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  orgId?: string;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function MentionTextarea({ value, onChange, orgId, placeholder, className, onKeyDown }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  // `start` is the index of the "@" itself, so replacement can splice cleanly.
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    sessionStore.listMembers(orgId).then(setMembers).catch(() => setMembers([]));
  }, [orgId]);

  const suggestions = useMemo(() => {
    if (!query || !members || members.length < 2) return [];
    const q = query.text.toLowerCase();
    return members.filter((m) => m.email.split("@")[0].toLowerCase().includes(q)).slice(0, 5);
  }, [query, members]);

  const detectMention = (text: string, cursor: number) => {
    const upToCursor = text.slice(0, cursor);
    const match = /@([\w.+-]*)$/.exec(upToCursor);
    if (match) {
      setQuery({ start: cursor - match[1].length - 1, text: match[1] });
      setHighlighted(0);
    } else {
      setQuery(null);
    }
  };

  const applyMention = (member: OrgMember) => {
    if (!query) return;
    const local = member.email.split("@")[0];
    const before = value.slice(0, query.start);
    const after = value.slice(query.start + 1 + query.text.length);
    const next = `${before}@${local} ${after}`;
    onChange(next);
    setQuery(null);
    const pos = before.length + local.length + 2;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative flex-1">
      {query && suggestions.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-56 rounded-md border bg-popover shadow-md p-1 max-h-40 overflow-y-auto">
          {suggestions.map((m, i) => (
            <button
              key={m.userId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applyMention(m); }}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-sm text-xs truncate transition",
                i === highlighted ? "bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              {m.email}
            </button>
          ))}
        </div>
      )}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); detectMention(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (query && suggestions.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => (h + 1) % suggestions.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyMention(suggestions[highlighted]); return; }
            if (e.key === "Escape") { setQuery(null); return; }
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        className={className}
      />
    </div>
  );
}

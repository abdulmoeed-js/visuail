// Per-item comment thread, anchored via project_comments.item_id. Separate
// component from CommentsDialog (the project-wide thread) rather than one
// component doing double duty -- this one is a lightweight popover meant to
// sit inline next to a list item, not a full dialog.

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { sessionStore, useSession, type ProjectComment } from "@/lib/session";
import { cn } from "@/lib/utils";

function fmtCommentTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

interface Props {
  projectId: string;
  itemId: string;
  count: number;
  /** Called after a post/delete changes the count, so the parent's badge stays in sync without a full refetch. */
  onCountChange: (itemId: string, delta: number) => void;
}

export function ItemCommentsPopover({ projectId, itemId, count, onCountChange }: Props) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = () => {
    setLoading(true);
    sessionStore.listComments(projectId, itemId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  };

  const post = async () => {
    if (!body.trim() || posting || !session.userId) return;
    setPosting(true);
    try {
      await sessionStore.addComment(projectId, session.userId, body, itemId);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "comment_posted", projectId, { itemId });
      setBody("");
      onCountChange(itemId, 1);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't post that comment. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await sessionStore.deleteComment(id);
      onCountChange(itemId, -1);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete this comment.");
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition",
            count > 0 ? "text-primary hover:bg-primary/10" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted",
          )}
          aria-label={`${count} comment${count === 1 ? "" : "s"}`}
        >
          <MessageSquare className="size-3" />
          {count > 0 && count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="max-h-56 overflow-y-auto p-2 space-y-2">
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No comments on this item yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.authorEmail}</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {fmtCommentTime(c.createdAt)}
                    {c.authorId === session.userId && (
                      <button onClick={() => remove(c.id)} className="hover:text-drift" aria-label="Delete comment">
                        <Trash2 className="size-2.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-foreground/90 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-1.5 p-2 border-t">
          <Textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Comment on this item…" className="min-h-[44px] text-xs"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
          />
          <Button size="sm" onClick={post} disabled={posting || !body.trim()} className="self-end shrink-0 h-8 w-8 p-0">
            {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

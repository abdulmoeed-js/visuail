// Per-item comment thread, anchored via project_comments.item_id. Separate
// component from CommentsDialog (the project-wide thread) rather than one
// component doing double duty -- this one is a lightweight popover meant to
// sit inline next to a list item, not a full dialog.

import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MentionTextarea } from "@/components/MentionTextarea";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { InlineError } from "@/components/ui/inline-error";
import { sessionStore, useSession, type ProjectComment } from "@/lib/session";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";
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
  /** Set when arriving here from the dashboard's comments inbox, to land
   *  the user directly in the thread the notification was about rather
   *  than just the item's row. */
  autoOpen?: boolean;
}

export function ItemCommentsPopover({ projectId, itemId, count, onCountChange, autoOpen }: Props) {
  const session = useSession();
  const [open, setOpen] = useState(!!autoOpen);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  // Failures are shown here in the popover, where they happened: a failed
  // load in place of the list, a failed post above the composer, a failed
  // delete under its comment.
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [postError, setPostError] = useState<FriendlyError | null>(null);
  // Deleting is permanent, so the trash icon first asks on the comment's own
  // row (a dialog on top of a popover is awkward).
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; error: FriendlyError } | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    sessionStore.listComments(projectId, itemId)
      .then(setComments)
      .catch((err) => { setComments([]); setLoadError(friendlyError(err, "load the comments")); })
      .finally(() => setLoading(false));
  };

  // The onOpenChange handler below only fires on a user-driven open, so an
  // autoOpen (already open on mount) needs its own load.
  useEffect(() => {
    if (autoOpen) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async () => {
    if (!body.trim() || posting || !session.userId) return;
    setPosting(true);
    setPostError(null);
    try {
      await sessionStore.addComment(projectId, session.userId, body, itemId, session.currentOrgId);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "comment_posted", projectId, { itemId });
      setBody("");
      onCountChange(itemId, 1);
      load();
    } catch (err) {
      setPostError(friendlyError(err, "post your comment"));
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await sessionStore.deleteComment(id);
      setConfirmingId(null);
      onCountChange(itemId, -1);
      load();
    } catch (err) {
      setDeleteError({ id, error: friendlyError(err, "delete this comment") });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setPostError(null); setConfirmingId(null); setDeleteError(null); load(); }
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition",
            count > 0 ? "text-primary hover:bg-primary/10" : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 hover:bg-muted",
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
          ) : loadError ? (
            <InlineError error={loadError} onRetry={load} className="text-xs" />
          ) : comments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No comments on this item yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.authorEmail}</span>
                  <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    {fmtCommentTime(c.createdAt)}
                    {c.authorId === session.userId && confirmingId !== c.id && (
                      <button
                        onClick={() => { setConfirmingId(c.id); setDeleteError(null); }}
                        className="hover:text-drift" aria-label="Delete comment"
                      >
                        <Trash2 className="size-2.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-foreground/90 whitespace-pre-wrap">{c.body}</p>
                {confirmingId === c.id && (
                  <div className="mt-1.5 rounded-md bg-fill-3 px-2 py-1.5">
                    <p className="text-[11px] text-foreground">Delete this comment? This can't be undone.</p>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <Button
                        size="sm" variant="link" className="h-7 px-1 text-xs"
                        disabled={deletingId === c.id}
                        autoFocus
                        onClick={() => { setConfirmingId(null); setDeleteError(null); }}
                      >
                        Keep it
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="h-7 px-2 text-xs border-destructive/40 text-drift-ink hover:border-destructive/60 hover:bg-destructive/5"
                        disabled={deletingId === c.id}
                        onClick={() => remove(c.id)}
                      >
                        {deletingId === c.id
                          ? <><Loader2 className="!size-3 animate-spin" aria-hidden /> Deleting…</>
                          : "Delete comment"}
                      </Button>
                    </div>
                  </div>
                )}
                {deleteError?.id === c.id && <InlineError error={deleteError.error} className="mt-1.5 text-xs" />}
              </div>
            ))
          )}
        </div>
        <div className="p-2 border-t">
          <InlineError error={postError} className="mb-1.5 text-xs" />
          <div className="flex gap-1.5">
            <MentionTextarea
              value={body}
              onChange={(v) => { setBody(v); if (postError) setPostError(null); }}
              orgId={session.currentOrgId}
              placeholder="Comment on this item… (@ to mention)" className="min-h-[44px] text-xs"
              aria-label="Comment on this item"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
            />
            <Button size="sm" onClick={post} disabled={posting || !body.trim()} className="self-end shrink-0 h-8 w-8 p-0" aria-label="Post comment">
              {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

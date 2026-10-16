// Project-level discussion thread. Deliberately not per-item yet -- the
// schema (project_comments.item_id) supports that later, but a single
// project-wide thread is the whole v1 scope here.

import { useId, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { MentionTextarea } from "@/components/MentionTextarea";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { sessionStore, useSession, type ProjectComment } from "@/lib/session";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";

/** The start of a comment, for naming it in the delete confirmation. */
function excerpt(text: string, max = 60) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

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

export function CommentsDialog({ projectId }: { projectId: string }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [postError, setPostError] = useState<FriendlyError | null>(null);
  // Kept apart from `confirmOpen` so the dialog's words stay put while it closes.
  const [toDelete, setToDelete] = useState<ProjectComment | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const postErrorId = useId();

  const load = () => {
    setLoading(true);
    setLoadError(null);
    sessionStore.listComments(projectId)
      .then(setComments)
      .catch((err) => {
        const e = friendlyError(err, "load comments");
        setLoadError(e);
      })
      .finally(() => setLoading(false));
  };

  const post = async () => {
    if (!body.trim() || posting || !session.userId) return;
    setPosting(true);
    setPostError(null);
    try {
      await sessionStore.addComment(projectId, session.userId, body, null, session.currentOrgId);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "comment_posted", projectId);
      setBody("");
      load();
    } catch (err) {
      // The draft stays in the box: it is only cleared on success.
      const e = friendlyError(err, "post your comment");
      const detail =
        e.kind === "offline" ? "You seem to be offline. Your comment is still in the box; post it when you're back online."
        : e.kind === "signed-out" ? "Your sign-in has expired. Copy your comment, then sign in again to post it."
        : e.kind === "unknown" ? "It's still in the box below. Try again in a moment."
        : e.detail;
      setPostError({ ...e, detail });
    } finally {
      setPosting(false);
    }
  };

  const askDelete = (c: ProjectComment) => {
    setToDelete(c);
    setConfirmOpen(true);
  };

  const remove = async () => {
    if (!toDelete) return;
    await sessionStore.deleteComment(toDelete.id);
    load();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquare className="size-3.5" /> Comments{comments.length > 0 ? ` (${comments.length})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Comments</DialogTitle>
          <DialogDescription>Visible to everyone in this workspace.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : loadError ? (
          <InlineError error={loadError} onRetry={load} />
        ) : (
          <div className="max-h-[45vh] overflow-y-auto space-y-3 p-1">
            {comments.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No comments yet.</p>
            )}
            {comments.map((c) => (
              <div key={c.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.authorEmail}</span>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {fmtCommentTime(c.createdAt)}
                    {c.authorId === session.userId && (
                      <button type="button" onClick={() => askDelete(c)} className="hover:text-drift" aria-label="Delete comment">
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 text-foreground/90 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t space-y-2">
          {postError && (
            <div id={postErrorId}>
              <InlineError error={postError} />
            </div>
          )}
          <div className="flex gap-2">
            <MentionTextarea
              value={body}
              onChange={(v) => { setBody(v); if (postError) setPostError(null); }}
              orgId={session.currentOrgId}
              placeholder="Add a comment… (@ to mention)" className="min-h-[60px] text-sm"
              aria-label="Add a comment"
              aria-describedby={postError ? postErrorId : undefined}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
            />
            <Button size="sm" onClick={post} disabled={posting || !body.trim()} className="self-end shrink-0" aria-label="Post comment">
              {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </Button>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete your comment?"
        consequence={toDelete
          ? `“${excerpt(toDelete.body)}” will be removed for everyone in this workspace. This can't be undone.`
          : ""}
        confirmLabel="Delete comment"
        busyLabel="Deleting…"
        doing="delete this comment"
        onConfirm={remove}
      />
    </Dialog>
  );
}

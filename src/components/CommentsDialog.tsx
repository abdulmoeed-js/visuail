// Project-level discussion thread. Deliberately not per-item yet -- the
// schema (project_comments.item_id) supports that later, but a single
// project-wide thread is the whole v1 scope here.

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { sessionStore, useSession, type ProjectComment } from "@/lib/session";

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

  const load = () => {
    setLoading(true);
    sessionStore.listComments(projectId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  };

  const post = async () => {
    if (!body.trim() || posting || !session.userId) return;
    setPosting(true);
    try {
      await sessionStore.addComment(projectId, session.userId, body);
      setBody("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't post that comment. Try again.");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    try { await sessionStore.deleteComment(id); load(); }
    catch (err) { alert(err instanceof Error ? err.message : "Couldn't delete this comment."); }
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
        ) : (
          <div className="max-h-[45vh] overflow-y-auto space-y-3">
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
                      <button onClick={() => remove(c.id)} className="hover:text-drift" aria-label="Delete comment">
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

        <div className="flex gap-2 pt-2 border-t">
          <Textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…" className="min-h-[60px] text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
          />
          <Button size="sm" onClick={post} disabled={posting || !body.trim()} className="self-end shrink-0">
            {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

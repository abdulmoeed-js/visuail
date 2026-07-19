// Real "Share link" -- anyone with the URL can view a read-only copy of the
// project's canvases, no sign-in required. See project_share_links and
// get_shared_project() for the server side; this is just the create/list/
// revoke UI.

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Copy, Check, X, Plus } from "lucide-react";
import { sessionStore, useSession, type ShareLink } from "@/lib/session";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
}

export function ShareLinkDialog({ open, onOpenChange, projectId }: Props) {
  const session = useSession();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [includeSources, setIncludeSources] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    sessionStore.listShareLinks(projectId)
      .then((all) => setLinks(all.filter((l) => !l.revoked)))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  };

  const create = async () => {
    if (!session.userId || creating) return;
    setCreating(true);
    try {
      await sessionStore.createShareLink(projectId, session.userId, includeSources);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "share_link_created", projectId);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't create a share link. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this link? Anyone with it will immediately lose access.")) return;
    try { await sessionStore.revokeShareLink(id); load(); }
    catch (err) { alert(err instanceof Error ? err.message : "Couldn't revoke this link."); }
  };

  const copy = (link: ShareLink) => {
    const url = `${window.location.origin}/share/${link.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 1500);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) load(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share this project</DialogTitle>
          <DialogDescription>
            Anyone with a link below can view a read-only copy of the canvases. No sign-in required.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 text-sm">
                <span className="truncate font-mono-tight text-xs text-muted-foreground">
                  /share/{l.token.slice(0, 10)}…{l.includeSources ? " · includes sources" : ""}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => copy(l)}>
                    {copiedId === l.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => revoke(l.id)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {links.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No active share links yet.</p>
            )}

            <div className="flex items-center gap-2 pt-2 border-t">
              <Checkbox
                id="include-sources" checked={includeSources}
                onCheckedChange={(v) => setIncludeSources(v === true)}
              />
              <label htmlFor="include-sources" className="text-xs text-muted-foreground">
                Also show source transcripts on this link
              </label>
            </div>
            <Button onClick={create} disabled={creating} className="w-full">
              {creating ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4" /> Create new link</>}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Real "Share link" -- anyone with the URL can view a read-only copy of the
// project's canvases, no sign-in required. See project_share_links and
// get_shared_project() for the server side; this is just the create/list/
// revoke UI.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { Loader2, Copy, Check, X, Plus } from "lucide-react";
import { sessionStore, useSession, type ShareLink } from "@/lib/session";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
}

export function ShareLinkDialog({ open, onOpenChange, projectId }: Props) {
  const session = useSession();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  // Creating stays off until the list has loaded, so nobody adds a link
  // while unsure which ones are already live.
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<FriendlyError | null>(null);
  const [includeSources, setIncludeSources] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Kept apart from `confirmOpen` so the dialog's words stay put while it closes.
  const [toRevoke, setToRevoke] = useState<ShareLink | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    sessionStore.listShareLinks(projectId)
      .then((all) => { setLinks(all.filter((l) => !l.revoked)); setLoaded(true); })
      .catch((err) => {
        // An empty list here would read as "nothing is shared" when links
        // may well be live, so say so plainly.
        const e = friendlyError(err, "load your share links");
        setLinks([]);
        setLoaded(false);
        setLoadError({
          ...e,
          title: "Couldn't load your share links, so some may still be active.",
          detail: e.kind === "unknown" ? "" : e.detail,
        });
      })
      .finally(() => setLoading(false));
  };

  const create = async () => {
    if (!session.userId || creating || !loaded) return;
    setCreating(true);
    setCreateError(null);
    try {
      await sessionStore.createShareLink(projectId, session.userId, includeSources);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "share_link_created", projectId);
      load();
    } catch (err) {
      setCreateError(friendlyError(err, "create a link"));
    } finally {
      setCreating(false);
    }
  };

  const askRevoke = (link: ShareLink) => {
    setToRevoke(link);
    setConfirmOpen(true);
  };

  const revoke = async () => {
    if (!toRevoke) return;
    await sessionStore.revokeShareLink(toRevoke.id);
    load();
  };

  const copy = (link: ShareLink) => {
    const url = `${window.location.origin}/share/${link.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 1500);
    });
  };

  // The parent opens this dialog by setting `open`, which Radix doesn't report
  // through onOpenChange, so load whenever it opens.
  useEffect(() => {
    if (!open) return;
    setCreateError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share this project</DialogTitle>
          <DialogDescription>
            Anyone with a link below can view a read-only copy of this project's artifacts. No sign-in needed.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3">
            {loadError ? (
              <InlineError error={loadError} onRetry={load} />
            ) : (
              <>
                {links.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 text-sm">
                    <span className="truncate font-mono-tight text-xs text-muted-foreground">
                      /share/{l.token.slice(0, 10)}…{l.includeSources ? " · includes sources" : ""}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => copy(l)} aria-label={copiedId === l.id ? `Link /share/${l.token.slice(0, 10)} copied` : `Copy link /share/${l.token.slice(0, 10)}`}>
                        {copiedId === l.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => askRevoke(l)} aria-label={`Revoke link /share/${l.token.slice(0, 10)}`}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {links.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">No active share links yet.</p>
                )}
              </>
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
            <InlineError error={createError} />
            <Button onClick={create} disabled={creating || !loaded} className="w-full">
              {creating ? <Loader2 className="size-4 animate-spin" /> : <><Plus className="size-4" /> Create new link</>}
            </Button>
          </div>
        )}
      </DialogContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Revoke this link?"
        consequence={toRevoke ? (
          <>
            Anyone who opens <span className="font-mono-tight">/share/{toRevoke.token.slice(0, 10)}…</span> will
            see that the link is no longer active.
            {toRevoke.includeSources ? " It currently shows source transcripts." : ""} A revoked link can't be
            turned back on, but you can create a new one.
          </>
        ) : ""}
        confirmLabel="Revoke link"
        busyLabel="Revoking…"
        doing="revoke this link"
        onConfirm={revoke}
      />
    </Dialog>
  );
}

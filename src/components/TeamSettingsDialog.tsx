// Member list + invite flow for a Team-tier org. Owner-only actions
// (invite, cancel invite, remove member) are enforced server-side by RLS
// (org_invites_owner_manages, org_members_owner_manages) -- the role check
// here is just to avoid showing controls that would be rejected anyway.

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, X, Crown, Sparkles, BarChart3 } from "lucide-react";
import { sessionStore, useSession, type Org, type OrgMember, type PendingInvite } from "@/lib/session";

const EVENT_LABEL: Record<string, string> = {
  project_created: "Projects created",
  extraction_run: "Extractions run",
  drift_recheck: "Drift re-checks",
  export_used: "Exports",
  comment_posted: "Comments posted",
  share_link_created: "Share links created",
  member_invited: "Members invited",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  org: Org;
  onUpgrade: () => void;
}

export function TeamSettingsDialog({ open, onOpenChange, org, onUpgrade }: Props) {
  const session = useSession();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, number> | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([sessionStore.listMembers(org.id), sessionStore.listPendingInvites(org.id)])
      .then(([m, i]) => { setMembers(m); setInvites(i); })
      .catch(() => { setMembers([]); setInvites([]); })
      .finally(() => setLoading(false));
    sessionStore.getUsageSummary(org.id).then(setUsage).catch(() => setUsage({}));
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || inviting || !session.userId) return;
    setInviting(true);
    setError(null);
    try {
      await sessionStore.inviteMember(org.id, email.trim(), session.userId);
      sessionStore.trackEvent(org.id, session.userId, "member_invited");
      setEmail("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite. Try again.");
    } finally {
      setInviting(false);
    }
  };

  const cancelInvite = async (id: string) => {
    try { await sessionStore.cancelInvite(id); load(); }
    catch (err) { alert(err instanceof Error ? err.message : "Couldn't cancel the invite."); }
  };

  const removeMember = async (userId: string) => {
    if (!confirm("Remove this person from the workspace? They'll lose access to every project here.")) return;
    try { await sessionStore.removeMember(org.id, userId); load(); }
    catch (err) { alert(err instanceof Error ? err.message : "Couldn't remove this member."); }
  };

  const isOwner = org.role === "owner";
  const seatsUsed = members.length;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) load(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{org.name}</DialogTitle>
          <DialogDescription>
            {org.tier === "team"
              ? `${seatsUsed} of 3 bundled seats used.`
              : "Shared workspaces are a Team-tier feature."}
          </DialogDescription>
        </DialogHeader>

        {usage && Object.keys(usage).length > 0 && (
          <div className="rounded-lg border bg-card p-3 mb-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground mb-2">
              <BarChart3 className="size-3" /> Last 30 days
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {Object.entries(usage).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{EVENT_LABEL[type] ?? type}</span>
                  <span className="font-mono-tight font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {org.tier !== "team" ? (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-4">
              Upgrade to Team to invite others into this workspace.
            </p>
            <Button onClick={onUpgrade}><Sparkles className="size-4" /> Upgrade to Team</Button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-sm">
                  <span className="truncate inline-flex items-center gap-1.5">
                    {m.role === "owner" && <Crown className="size-3.5 text-primary shrink-0" />}
                    {m.email}
                  </span>
                  {isOwner && m.role !== "owner" && (
                    <Button size="sm" variant="ghost" onClick={() => removeMember(m.userId)}>
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {invites.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/40 p-2 text-sm text-muted-foreground">
                  <span className="truncate">{i.email} · pending</span>
                  {isOwner && (
                    <Button size="sm" variant="ghost" onClick={() => cancelInvite(i.id)}>
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {isOwner && seatsUsed + invites.length < 3 && (
              <form onSubmit={invite} className="flex gap-2">
                <Input
                  type="email" placeholder="teammate@company.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} className="h-9"
                />
                <Button type="submit" size="sm" disabled={inviting} className="shrink-0">
                  {inviting ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                  Invite
                </Button>
              </form>
            )}
            {error && <p className="text-xs text-drift">{error}</p>}
            {isOwner && seatsUsed + invites.length >= 3 && (
              <p className="text-[11px] text-muted-foreground">
                All 3 bundled seats are in use. Contact us for additional seats.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

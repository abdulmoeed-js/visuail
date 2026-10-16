// Member list + invite flow for a Team-tier org. Owner-only actions
// (invite, cancel invite, remove member) are enforced server-side by RLS
// (org_invites_owner_manages, org_members_owner_manages) -- the role check
// here is just to avoid showing controls that would be rejected anyway.

import { useEffect, useId, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { Loader2, UserPlus, X, Crown, Sparkles, BarChart3, Slack, Mail, Check, CreditCard, AlertTriangle } from "lucide-react";
import {
  sessionStore, useSession, type Org, type OrgMember, type PendingInvite, type SlackIntegration, type Subscription,
} from "@/lib/session";
import { EdgeError } from "@/lib/edge";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EVENT_LABEL: Record<string, string> = {
  project_created: "Projects created",
  extraction_run: "Source reads",
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
  // Seat counts and the invite form wait for a successful load, so a failed
  // one never reads as an empty workspace.
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<FriendlyError | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<{ id: string; error: FriendlyError } | null>(null);
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [slack, setSlack] = useState<SlackIntegration | null>(null);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [slackError, setSlackError] = useState<FriendlyError | null>(null);
  const [notifyEmail, setNotifyEmail] = useState(org.notificationEmail ?? "");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState<{ error: FriendlyError; invalid: boolean } | null>(null);
  // Kept apart from the open flags so each dialog's words stay put while it closes.
  const [toDisconnect, setToDisconnect] = useState<SlackIntegration | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [toRemove, setToRemove] = useState<OrgMember | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const inviteErrorId = useId();
  const emailErrorId = useId();

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([sessionStore.listMembers(org.id), sessionStore.listPendingInvites(org.id)])
      .then(([m, i]) => { setMembers(m); setInvites(i); setMembersLoaded(true); })
      .catch((err) => {
        setMembers([]);
        setInvites([]);
        setMembersLoaded(false);
        const e = friendlyError(err, "load the people in this workspace");
        setLoadError(e.kind === "unknown" ? { ...e, detail: "" } : e);
      })
      .finally(() => setLoading(false));
    sessionStore.getUsageSummary(org.id).then(setUsage).catch(() => setUsage({}));
    sessionStore.getSlackIntegration(org.id).then(setSlack).catch(() => setSlack(null));
    sessionStore.getSubscription(org.id).then(setSubscription).catch(() => setSubscription(null));
  };

  const connectSlack = async () => {
    setConnectingSlack(true);
    setSlackError(null);
    try {
      await sessionStore.connectSlack(org.id); // redirects the page on success
    } catch (err) {
      setConnectingSlack(false);
      const e = friendlyError(err, "open Slack's sign-in page");
      const notSetUp = err instanceof EdgeError && err.status === 500 && /configured/i.test(err.serverMessage);
      const detail =
        notSetUp ? "Slack alerts aren't available right now. Use the email option below instead."
        : e.kind === "not-allowed" ? "Only the workspace owner can connect Slack. Ask them to set it up."
        : e.detail;
      setSlackError({ ...e, detail });
    }
  };

  const disconnectSlack = async () => {
    await sessionStore.disconnectSlack(org.id);
    setSlack(null);
  };

  const saveEmail = async () => {
    const value = notifyEmail.trim();
    if (value && !EMAIL_SHAPE.test(value)) {
      setEmailError({
        invalid: true,
        error: { kind: "invalid-email", title: "Enter a full email address, like alerts@yourcompany.com.", detail: "" },
      });
      return;
    }
    setSavingEmail(true);
    setEmailError(null);
    try {
      await sessionStore.setNotificationEmail(org.id, value || null);
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 1500);
    } catch (err) {
      const e = friendlyError(err, "save this email");
      setEmailError({
        invalid: false,
        error: e.kind === "not-allowed" ? { ...e, detail: "Only the workspace owner can change where alerts go." } : e,
      });
    } finally {
      setSavingEmail(false);
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address || inviting || !session.userId) return;
    setInviting(true);
    setInviteError(null);
    try {
      await sessionStore.inviteMember(org.id, address, session.userId);
      sessionStore.trackEvent(org.id, session.userId, "member_invited");
      setEmail("");
      load();
    } catch (err) {
      const fe = friendlyError(err, `send an invite to ${address}`);
      const detail =
        fe.kind === "not-allowed" ? "Only the workspace owner can invite people."
        : fe.kind === "unknown" ? "Check the address and try again."
        : fe.detail;
      setInviteError({ ...fe, detail });
    } finally {
      setInviting(false);
    }
  };

  const cancelInvite = async (inv: PendingInvite) => {
    if (cancellingId) return;
    setCancellingId(inv.id);
    setCancelError(null);
    try {
      await sessionStore.cancelInvite(inv.id);
      load();
    } catch (err) {
      setCancelError({ id: inv.id, error: friendlyError(err, `cancel the invite to ${inv.email}`) });
    } finally {
      setCancellingId(null);
    }
  };

  const askRemove = (m: OrgMember) => {
    setToRemove(m);
    setRemoveOpen(true);
  };

  const removeMember = async () => {
    if (!toRemove) return;
    await sessionStore.removeMember(org.id, toRemove.userId);
    load();
  };

  const isOwner = org.role === "owner";
  const seatsUsed = members.length;
  const alertsGoTo = [
    slack ? `#${slack.channelName} in ${slack.slackTeamName}` : null,
    org.notificationEmail || null,
  ].filter(Boolean).join(" and ");

  // Opened by the parent setting `open` (Radix doesn't report that through
  // onOpenChange), so load and clear old errors whenever it opens.
  useEffect(() => {
    if (!open) return;
    setSlackError(null);
    setEmailError(null);
    setInviteError(null);
    setCancelError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, org.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{org.name}</DialogTitle>
          <DialogDescription>
            {org.tier !== "team"
              ? "Shared workspaces are a Team-tier feature."
              : membersLoaded
                ? `${seatsUsed} of 3 bundled seats used.`
                : "3 bundled seats."}
          </DialogDescription>
        </DialogHeader>

        {org.tier !== "free" && subscription && (
          <div className="space-y-2 mb-1">
            {subscription.status === "past_due" && (
              <div className="rounded-lg border border-drift/40 bg-drift/10 p-3 flex items-start gap-2 text-sm">
                <AlertTriangle className="size-4 text-drift-ink shrink-0 mt-0.5" />
                <span>
                  Your last payment failed. {org.name} stays on {subscription.tier === "team" ? "Team" : "Pro"} for now,
                  but update your payment method soon to avoid losing access.
                </span>
              </div>
            )}
            {subscription.portalUrl && (
              <a
                href={subscription.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 text-sm hover:border-primary/40 transition"
              >
                <span className="flex items-center gap-1.5">
                  <CreditCard className="size-3.5 text-muted-foreground" /> Manage billing
                </span>
                <span className="text-muted-foreground text-xs">Invoices, card, cancel</span>
              </a>
            )}
          </div>
        )}

        {usage && Object.keys(usage).length > 0 && (
          <div className="rounded-lg border bg-card p-3 mb-1">
            <div className="flex items-center gap-1.5 eyebrow text-muted-foreground mb-2">
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

        {org.tier !== "free" && (
          <div className="rounded-lg border bg-card p-3 mb-1 space-y-3">
            <div className="eyebrow text-muted-foreground">
              Drift alert notifications
            </div>
            {isOwner ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm">
                    <Slack className="size-3.5 text-muted-foreground" />
                    {slack ? `Connected to #${slack.channelName} (${slack.slackTeamName})` : "Not connected"}
                  </span>
                  {slack ? (
                    <Button size="sm" variant="ghost" onClick={() => { setToDisconnect(slack); setDisconnectOpen(true); }}>
                      Disconnect Slack
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={connectingSlack} onClick={connectSlack}>
                      {connectingSlack ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Connecting…</> : "Connect Slack"}
                    </Button>
                  )}
                </div>
                <InlineError error={slackError} />
                <div className="flex items-center gap-2">
                  <Mail className="size-3.5 text-muted-foreground shrink-0" />
                  <Input
                    type="email" placeholder="alerts@yourcompany.com" value={notifyEmail}
                    aria-label="Email for drift alerts"
                    aria-invalid={emailError?.invalid || undefined}
                    aria-describedby={emailError ? emailErrorId : undefined}
                    onChange={(e) => { setNotifyEmail(e.target.value); if (emailError) setEmailError(null); }}
                    className="h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={saveEmail} disabled={savingEmail} className="shrink-0">
                    {savingEmail
                      ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</>
                      : emailSaved ? <><Check className="size-3.5" aria-hidden /> Saved</> : "Save email"}
                  </Button>
                </div>
                {emailError && (
                  <div id={emailErrorId}>
                    <InlineError error={emailError.error} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {alertsGoTo ? `Alerts go to ${alertsGoTo}.` : "Drift alerts aren't set up yet."}{" "}
                Only the workspace owner can change this.
              </p>
            )}
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
        ) : loadError ? (
          <InlineError error={loadError} onRetry={load} />
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
                    <Button size="sm" variant="ghost" onClick={() => askRemove(m)} aria-label={`Remove ${m.email}`}>
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {invites.map((i) => (
                <div key={i.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/40 p-2 text-sm text-muted-foreground">
                    <span className="truncate">{i.email} · pending</span>
                    {isOwner && (
                      <Button
                        size="sm" variant="ghost" onClick={() => cancelInvite(i)}
                        disabled={cancellingId === i.id} aria-label={`Cancel invite to ${i.email}`}
                      >
                        {cancellingId === i.id ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                      </Button>
                    )}
                  </div>
                  {cancelError?.id === i.id && <InlineError error={cancelError.error} />}
                </div>
              ))}
            </div>

            {isOwner && seatsUsed + invites.length < 3 && (
              <form onSubmit={invite} className="flex gap-2">
                <Input
                  type="email" placeholder="teammate@company.com" value={email}
                  aria-label="Teammate's email address"
                  aria-describedby={inviteError ? inviteErrorId : undefined}
                  onChange={(e) => { setEmail(e.target.value); if (inviteError) setInviteError(null); }}
                  className="h-9"
                />
                <Button type="submit" size="sm" disabled={inviting} className="shrink-0">
                  {inviting ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                  {inviting ? "Sending…" : "Send invite"}
                </Button>
              </form>
            )}
            {inviteError && (
              <div id={inviteErrorId}>
                <InlineError error={inviteError} />
              </div>
            )}
            {isOwner && seatsUsed + invites.length >= 3 && (
              <p className="text-[11px] text-muted-foreground">
                All 3 bundled seats are in use. Contact us for additional seats.
              </p>
            )}
          </div>
        )}
      </DialogContent>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={toDisconnect ? `Disconnect Slack from #${toDisconnect.channelName}?` : ""}
        consequence={toDisconnect
          ? `Drift alerts will stop posting to #${toDisconnect.channelName} in ${toDisconnect.slackTeamName}. You can connect it again at any time.`
          : ""}
        confirmLabel="Disconnect Slack"
        busyLabel="Disconnecting…"
        doing="disconnect Slack"
        onConfirm={disconnectSlack}
      />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={toRemove ? `Remove ${toRemove.email} from ${org.name}?` : ""}
        consequence="They lose access to every project in this workspace straight away. This frees one of your 3 seats, and you can invite them again later."
        confirmLabel="Remove from workspace"
        busyLabel="Removing…"
        cancelLabel="Keep them"
        doing={toRemove ? `remove ${toRemove.email}` : "remove this person"}
        onConfirm={removeMember}
      />
    </Dialog>
  );
}

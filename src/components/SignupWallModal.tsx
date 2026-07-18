import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Mail, Sparkles } from "lucide-react";
import { sessionStore } from "@/lib/session";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: string; // e.g. "Push to Confluence"
}

export function SignupWallModal({ open, onOpenChange, action }: Props) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setDone(false); setSending(false); setError(null); setEmail(""); };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { onOpenChange(v); if (!v) setTimeout(reset, 200); }}
    >
      <DialogContent className="sm:max-w-md">
        {!done ? (
          <>
            <DialogHeader>
              <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-mono-tight text-muted-foreground w-fit">
                <Sparkles className="size-3" /> One step to {action.toLowerCase()}
              </div>
              <DialogTitle className="font-display text-2xl leading-tight mt-2">
                You've already done the hard part.
              </DialogTitle>
              <DialogDescription className="text-sm">
                No signup wall before value — that's a rule. Now that you've built a real artifact,
                drop an email to unlock exports, sharing, and the Jira/Confluence round-trip.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!email.trim() || sending) return;
                setSending(true);
                setError(null);
                try {
                  await sessionStore.sendMagicLink(email.trim());
                  setDone(true);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Couldn't send the link. Try again.");
                } finally {
                  setSending(false);
                }
              }}
            >
              <Input
                type="email" required autoFocus placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
              {error && <p className="text-xs text-drift">{error}</p>}
              <Button type="submit" className="w-full h-11" disabled={sending}>
                {sending ? <><Loader2 className="size-4 animate-spin" /> Sending…</> : `Continue → ${action}`}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                No credit card. Cancel anytime. We'll never email you more than once.
              </p>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-confident/15 text-confident">
              <Mail className="size-6" />
            </div>
            <DialogTitle className="font-display text-2xl">Check your email.</DialogTitle>
            <p className="text-sm text-muted-foreground max-w-xs">
              We sent a real sign-in link to <strong>{email}</strong>. Click it to finish signing in —
              you'll land on your dashboard.
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <Check className="size-4" /> Got it
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useId, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { Loader2, LogIn, Mail } from "lucide-react";
import { sessionStore } from "@/lib/session";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: string; // e.g. "Push to Confluence"
}

/** Callers pass routing keys ("Share link", "Export"); say them as actions
 *  after "One step to". Anything else reads with a lower-case first letter:
 *  "Upgrade to Pro" -> "upgrade to Pro". */
const ACTION_PHRASE: Record<string, string> = {
  "Share link": "share a link",
  "Export": "download a PDF",
};
function lowerFirst(s: string) {
  return ACTION_PHRASE[s] ?? s.charAt(0).toLowerCase() + s.slice(1);
}

/** Sign-in failures in words that fit sending a link, not the generic ones. */
function signInError(err: unknown): FriendlyError {
  const e = friendlyError(err, "send the sign-in link");
  switch (e.kind) {
    case "rate-limit":
      return { ...e, detail: "Too many sign-in links were asked for just now. Wait a few minutes, then try again." };
    case "not-allowed":
      return { ...e, detail: "Email sign-in isn't available for this address." };
    default:
      return e;
  }
}

export function SignupWallModal({ open, onOpenChange, action }: Props) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const emailId = useId();
  const errorId = useId();

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
              {action !== "Sign in" && (
                <div className="inline-flex items-center gap-1.5 rounded-md border bg-muted px-2 py-0.5 text-[10px] font-mono-tight text-muted-foreground w-fit">
                  <LogIn className="size-3" aria-hidden /> One step to {lowerFirst(action)}
                </div>
              )}
              <DialogTitle className={action !== "Sign in" ? "font-display text-2xl leading-tight mt-2" : "font-display text-2xl leading-tight"}>
                Sign in with your email.
              </DialogTitle>
              <DialogDescription className="text-sm">
                Enter your work email to get a sign-in link. Signed in, you can save your projects, export them
                and share them.
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
                  setError(signInError(err));
                } finally {
                  setSending(false);
                }
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor={emailId} className="text-sm font-medium">Work email</label>
                <Input
                  id={emailId}
                  type="email" required autoFocus autoComplete="email" placeholder="you@company.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                  aria-invalid={error?.kind === "invalid-email" || undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="h-11"
                />
              </div>
              {error && (
                <div id={errorId}>
                  <InlineError error={error} />
                </div>
              )}
              <Button type="submit" className="w-full h-11" disabled={sending}>
                {sending ? <><Loader2 className="size-4 animate-spin" /> Sending…</> : "Email me a sign-in link"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                No credit card needed.
              </p>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-confident/15 text-confident-ink">
              <Mail className="size-6" />
            </div>
            <DialogTitle className="font-display text-2xl">Check your email.</DialogTitle>
            <p className="text-sm text-muted-foreground max-w-xs">
              A sign-in link is on its way to <strong>{email}</strong>. Open it to finish signing in; you'll land
              on your dashboard.
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

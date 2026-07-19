import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogIn, Loader2, Lock, AlertTriangle } from "lucide-react";
import { sessionStore, useSession } from "@/lib/session";
import { SignupWallModal } from "@/components/SignupWallModal";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tier: "Pro" | "Team" | null;
  price: string;
  unlocks: string[];
}

/** Redirects to a real LemonSqueezy hosted checkout -- no card fields ever
 *  touch Visuail, so there's no form here, just a brief "starting checkout"
 *  state while create-checkout is called and the redirect happens. */
export function CheckoutModal({ open, onOpenChange, tier, price, unlocks }: Props) {
  const session = useSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tier || !session.currentOrgId || err) return;
    sessionStore
      .startCheckout(session.currentOrgId, tier === "Pro" ? "pro" : "team")
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "Couldn't start checkout. Try again.");
      });
    // Success path navigates away via window.location.href, so no cleanup needed.
  }, [open, tier, session.currentOrgId, err]);

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(() => setErr(null), 200);
  };

  if (open && !session.loading && !session.signedIn) {
    return (
      <>
        <Dialog open={open} onOpenChange={close}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl leading-tight">Sign in to upgrade.</DialogTitle>
              <DialogDescription className="text-sm">
                Plans are tied to your account, so we need you signed in before activating {tier ?? "a plan"}.
              </DialogDescription>
            </DialogHeader>
            <Button className="w-full h-11" onClick={() => setSignInOpen(true)}>
              <LogIn className="size-4" /> Sign in
            </Button>
          </DialogContent>
        </Dialog>
        <SignupWallModal
          open={signInOpen}
          onOpenChange={(v) => { setSignInOpen(v); if (!v) close(false); }}
          action={`Upgrade to ${tier ?? "Pro"}`}
        />
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-mono-tight text-muted-foreground w-fit">
            <Lock className="size-3" /> Checkout · {tier}
          </div>
          <DialogTitle className="font-display text-2xl leading-tight mt-2">
            {err ? "Couldn't start checkout" : `Upgrade to ${tier} — ${price}`}
          </DialogTitle>
          {!err && (
            <DialogDescription className="text-sm">
              You'll unlock: {unlocks.join(" · ")}
            </DialogDescription>
          )}
        </DialogHeader>

        {err ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-drift/15 text-drift">
              <AlertTriangle className="size-6" />
            </div>
            <p className="text-sm text-muted-foreground">{err}</p>
            <Button onClick={() => setErr(null)}>Try again</Button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Taking you to secure checkout…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

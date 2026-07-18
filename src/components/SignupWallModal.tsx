import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Sparkles } from "lucide-react";
import { sessionStore } from "@/lib/session";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  action: string; // e.g. "Push to Confluence"
}

export function SignupWallModal({ open, onOpenChange, action }: Props) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { onOpenChange(v); if (!v) setTimeout(() => setDone(false), 200); }}
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
              onSubmit={(e) => { e.preventDefault(); if (email.trim()) setDone(true); }}
            >
              <Input
                type="email" required autoFocus placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
              <Button type="submit" className="w-full h-11">Continue → {action}</Button>
              <p className="text-[11px] text-muted-foreground text-center">
                No credit card. Cancel anytime. We'll never email you more than once.
              </p>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-confident/15 text-confident">
              <Check className="size-6" />
            </div>
            <DialogTitle className="font-display text-2xl">You're in.</DialogTitle>
            <p className="text-sm text-muted-foreground max-w-xs">
              We saved your artifact and sent a magic link to <strong>{email}</strong>.
              (Demo: no email actually sent.)
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Back to workbench</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

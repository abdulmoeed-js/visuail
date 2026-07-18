import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, CreditCard, Loader2, Lock } from "lucide-react";
import { sessionStore } from "@/lib/session";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tier: "Pro" | "Team" | null;
  price: string;
  unlocks: string[];
}

type Phase = "form" | "processing" | "done";

function formatCard(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  if (d.length < 3) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

export function CheckoutModal({ open, onOpenChange, tier, price, unlocks }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const navigate = useNavigate();
  const [card, setCard] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setPhase("form"); setCard(""); setExpiry(""); setCvc(""); setName(""); setZip(""); setErr(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = card.replace(/\s/g, "");
    if (digits.length !== 16) return setErr("Card number must be 16 digits.");
    const m = expiry.match(/^(\d{2})\/(\d{2})$/);
    if (!m) return setErr("Expiry must be MM/YY.");
    const mm = Number(m[1]); const yy = 2000 + Number(m[2]);
    if (mm < 1 || mm > 12) return setErr("Invalid expiry month.");
    const now = new Date();
    const exp = new Date(yy, mm - 1, 1);
    if (exp < new Date(now.getFullYear(), now.getMonth(), 1)) return setErr("Expiry must be in the future.");
    if (cvc.replace(/\D/g, "").length < 3) return setErr("CVC must be 3–4 digits.");
    if (!name.trim()) return setErr("Cardholder name required.");
    if (zip.trim().length < 3) return setErr("Billing ZIP required.");
    setErr(null);
    setPhase("processing");
    setTimeout(() => setPhase("done"), 1400);
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {phase === "form" && tier && (
          <>
            <DialogHeader>
              <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-mono-tight text-muted-foreground w-fit">
                <Lock className="size-3" /> Checkout · {tier}
              </div>
              <DialogTitle className="font-display text-2xl leading-tight mt-2">
                Upgrade to {tier} — {price}
              </DialogTitle>
              <DialogDescription className="text-sm">
                Enter your card details below. Cancel anytime.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">Card number</label>
                <div className="relative">
                  <Input
                    inputMode="numeric" autoComplete="cc-number"
                    placeholder="4242 4242 4242 4242"
                    value={card} onChange={(e) => setCard(formatCard(e.target.value))}
                    className="h-11 pl-9 font-mono-tight"
                  />
                  <CreditCard className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">Expiry</label>
                  <Input
                    inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY"
                    value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                    className="h-11 font-mono-tight"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">CVC</label>
                  <Input
                    inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4}
                    value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className="h-11 font-mono-tight"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">Cardholder name</label>
                <Input
                  autoComplete="cc-name" placeholder="Alex Doe"
                  value={name} onChange={(e) => setName(e.target.value)}
                  className="h-11"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">Billing ZIP / postcode</label>
                <Input
                  autoComplete="postal-code" placeholder="94103"
                  value={zip} onChange={(e) => setZip(e.target.value)}
                  className="h-11 font-mono-tight"
                />
              </div>
              {err && <p className="text-xs text-drift">{err}</p>}
              <Button type="submit" className="w-full h-11">Pay {price} → Activate {tier}</Button>
              <p className="text-[11px] text-muted-foreground text-center">
                This is a demo — no real payment is processed.
              </p>
            </form>
          </>
        )}

        {phase === "processing" && (
          <div className="flex flex-col items-center text-center gap-3 py-10">
            <Loader2 className="size-8 animate-spin text-primary" />
            <DialogTitle className="font-display text-xl">Processing payment…</DialogTitle>
            <p className="text-xs text-muted-foreground">Mocked authorization — no card network contacted.</p>
          </div>
        )}

        {phase === "done" && tier && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-confident/15 text-confident">
              <Check className="size-6" />
            </div>
            <DialogTitle className="font-display text-2xl">You're on {tier}.</DialogTitle>
            <ul className="text-sm text-muted-foreground max-w-xs space-y-1 text-left">
              {unlocks.map((u) => (
                <li key={u} className="flex gap-2"><Check className="size-4 text-confident shrink-0 mt-0.5" />{u}</li>
              ))}
            </ul>
            <Button
              className="mt-2"
              onClick={() => { close(false); setTimeout(() => scrollToId("workbench"), 220); }}
            >
              Continue to workbench
            </Button>
            <p className="text-[10px] font-mono-tight text-muted-foreground">
              Mocked checkout — no real charge occurred.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

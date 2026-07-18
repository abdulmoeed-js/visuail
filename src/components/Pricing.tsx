import { useState } from "react";

import { cn } from "@/lib/utils";
import { SignupWallModal } from "./SignupWallModal";
import { CheckoutModal } from "./CheckoutModal";

type TierKind = "free" | "pro" | "team";

const tiers: Array<{
  kind: TierKind;
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  cta: string;
  highlight: boolean;
  unlocks?: string[];
}> = [
  {
    kind: "free",
    name: "Free",
    price: "$0",
    period: "mo",
    tagline: "Try the workbench on real transcripts. No card required.",
    features: [
      "2 projects, 4 transcripts each",
      "Process map + Business Model Canvas",
      "Generated BRD & summary briefs",
      "Confidence scoring per item",
      "PDF export",
      "No drift detection or traceability",
    ],
    cta: "Start free",
    highlight: false,
  },
  {
    kind: "pro",
    name: "Pro",
    price: "$6",
    period: "mo",
    tagline: "The moat, for a single analyst: drift, traceability, versions.",
    features: [
      "Unlimited projects and transcripts",
      "Everything in Free",
      "Drift detection & reconciliation",
      "Traceability from story → source",
      "Version history per artifact",
      "Single user",
    ],
    cta: "Upgrade to Pro",
    highlight: true,
    unlocks: [
      "Unlimited projects and transcripts",
      "Drift detection & reconciliation",
      "Story → source traceability",
      "Version history per artifact",
    ],
  },
  {
    kind: "team",
    name: "Team",
    price: "$15",
    period: "mo · 3 seats",
    tagline: "Flat rate for a squad. Round-trip to the tools you already use.",
    features: [
      "Everything in Pro",
      "Up to 3 seats bundled (flat rate)",
      "Shared workspaces & commenting",
      "Jira / Confluence round-trip",
      "Additional seats — contact us",
    ],
    cta: "Upgrade to Team",
    highlight: false,
    unlocks: [
      "3 bundled seats on one workspace",
      "Shared workspaces & commenting",
      "Jira / Confluence round-trip",
      "Everything in Pro",
    ],
  },
];

export function Pricing() {
  const [signupOpen, setSignupOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutTier, setCheckoutTier] = useState<{ name: "Pro" | "Team"; price: string; unlocks: string[] } | null>(null);

  const onClick = (t: (typeof tiers)[number]) => {
    if (t.kind === "free") {
      setSignupOpen(true);
      return;
    }
    setCheckoutTier({
      name: t.kind === "pro" ? "Pro" : "Team",
      price: `${t.price}/${t.period.split(" ")[0]}`,
      unlocks: t.unlocks ?? [],
    });
    setCheckoutOpen(true);
  };

  return (
    <section id="pricing" className="border-t">
      <div className="mx-auto max-w-[1200px] px-4 py-24 md:py-32">
        <div className="max-w-2xl mb-16">
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">Pricing</div>
          <h2 className="font-display text-4xl md:text-5xl mt-2 leading-[1.05]">Priced for people who bill by the hour.</h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Traceability and drift detection live in Pro and up — never in a free plan. That's what you're actually paying for.
          </p>
        </div>
        <div className="grid gap-px bg-border md:grid-cols-3 border rounded-lg overflow-hidden">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={cn(
                "relative bg-card p-8 flex flex-col",
                t.highlight && "bg-card ring-1 ring-inset ring-primary/40",
              )}
            >
              {t.highlight && (
                <span className="text-[10px] font-mono-tight uppercase tracking-widest text-primary mb-3">
                  Recommended
                </span>
              )}
              <div>
                <h3 className="font-display text-2xl">{t.name}</h3>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-display text-5xl tracking-tight text-primary">{t.price}</span>
                  <span className="text-sm text-muted-foreground">/ {t.period}</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t.tagline}</p>
              </div>
              <ul className="mt-8 space-y-2.5 flex-1 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="text-foreground/80 leading-relaxed">
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => onClick(t)}
                className={cn(
                  "mt-8 h-11 rounded-md font-medium text-sm transition",
                  t.highlight
                    ? "text-primary-foreground shadow-[0_8px_24px_-8px_color-mix(in_oklab,var(--primary)_60%,transparent)] hover:shadow-[0_12px_32px_-8px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:-translate-y-px"
                    : "border bg-transparent hover:bg-muted hover:border-primary/40",
                )}
                style={t.highlight ? {
                  background:
                    "linear-gradient(135deg, var(--primary), color-mix(in oklab, var(--primary) 70%, var(--verified)))",
                } : undefined}
              >
                {t.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
      <SignupWallModal open={signupOpen} onOpenChange={setSignupOpen} action="Start free" />
      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        tier={checkoutTier?.name ?? null}
        price={checkoutTier?.price ?? ""}
        unlocks={checkoutTier?.unlocks ?? []}
      />
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-[1400px] px-4 py-8 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-mono-tight">
          <span className="h-1.5 w-1.5 rounded-full bg-confident" />
          Visuail · diagrams that know when they're stale
        </div>
        <div className="flex items-center gap-4">
          <a className="hover:text-foreground" href="#workbench">Workbench</a>
          <a className="hover:text-foreground" href="#why-not-miro">The maintenance problem</a>
          <a className="hover:text-foreground" href="#pricing">Pricing</a>

          <span>© 2026</span>
        </div>
      </div>
    </footer>
  );
}

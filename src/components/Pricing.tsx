import { useState } from "react";

import { cn } from "@/lib/utils";
import { SignupWallModal } from "./SignupWallModal";
import { CheckoutModal } from "./CheckoutModal";
import { HELP_URL, SUPPORT_EMAIL } from "@/lib/links";

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
      "2 projects, up to 4 transcripts each",
      "All 7 diagram types: process map, Business Model Canvas, DFD, RACI, decision tree, state diagram, activity",
      "BA toolkit: use cases, business case, requirements plan, stakeholder analysis, risk log, test cases, change requests, comms plan",
      "Generated BRD, traced backlog and one-page brief",
      "A confidence score and verbatim source quote on every item",
      "PDF export",
      "Drift detection and version history are Pro and up",
    ],
    cta: "Start free",
    highlight: false,
  },
  {
    kind: "pro",
    name: "Pro",
    price: "$9",
    period: "mo",
    tagline: "Everything in Free, plus the part nobody else does: knowing when your diagrams drift.",
    features: [
      "Unlimited projects and transcripts",
      "Everything in Free",
      "Drift detection: re-check any project against its sources and reconcile what changed",
      "Drift alerts by email or Slack when a source changes",
      "Traceability from every backlog story back to the source line",
      "Version history per artifact",
      "1 seat",
    ],
    cta: "Upgrade to Pro",
    highlight: true,
    unlocks: [
      "Unlimited projects and transcripts",
      "Drift detection & alerts",
      "Story → source traceability",
      "Version history per artifact",
    ],
  },
  {
    kind: "team",
    name: "Team",
    price: "$18",
    period: "mo · 3 seats",
    tagline: "Flat rate for a squad, all seeing the same workspace.",
    features: [
      "Everything in Pro",
      "3 seats bundled, one flat rate",
      "Shared workspace with comments and @mentions",
      "One drift inbox for the whole team",
      "Additional seats — contact us",
    ],
    cta: "Upgrade to Team",
    highlight: false,
    unlocks: [
      "3 bundled seats on one workspace",
      "Shared workspace, comments & @mentions",
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
          <h2 className="font-display text-4xl md:text-5xl mt-2 leading-[1.05]">Straightforward pricing for real BA work.</h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Every diagram type is free. Knowing when they drift — and tracing every story back to its source — is what you pay for.
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
          visu · your AI Business Analyst
        </div>
        <div className="flex items-center gap-4">
          <a className="hover:text-foreground" href="#workbench">Workbench</a>
          <a className="hover:text-foreground" href="#why-not-miro">What you get</a>
          <a className="hover:text-foreground" href="#pricing">Pricing</a>
          <a
            className="hover:text-foreground"
            href={HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Help
          </a>
          <a className="hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          <span>© 2026</span>
        </div>
      </div>
    </footer>
  );
}

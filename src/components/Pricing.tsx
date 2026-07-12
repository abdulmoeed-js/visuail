import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SignupWallModal } from "./SignupWallModal";

const tiers = [
  {
    name: "Analyst",
    price: "$29",
    period: "seat/mo",
    tagline: "For solo BAs and PMs shipping their first artifacts.",
    features: [
      "Unlimited transcripts",
      "Process maps + Business Model Canvas",
      "Generated BRD & summary briefs",
      "Confidence scoring per item",
      "PDF / Markdown export",
    ],
    cta: "Start free trial",
    highlight: false,
  },
  {
    name: "Team",
    price: "$45",
    period: "seat/mo",
    tagline: "The moat — traceability, drift detection, and Jira/Confluence round-trip.",
    features: [
      "Everything in Analyst",
      "Traceability from story → source",
      "Drift detection & reconciliation",
      "Jira / Confluence round-trip",
      "Shared workspaces & commenting",
      "Version history per artifact",
    ],
    cta: "Start 14-day team trial",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "$350",
    period: "seat/yr",
    tagline: "For regulated firms and larger consultancies.",
    features: [
      "Everything in Team",
      "SSO / SCIM",
      "Audit logs",
      "Private deployment (VPC or on-prem)",
      "Dedicated success manager",
      "Custom IR extensions",
    ],
    cta: "Talk to sales",
    highlight: false,
  },
];

export function Pricing() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("Sign up");
  return (
    <section id="pricing" className="border-t">
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:py-24">
        <div className="max-w-2xl mb-10">
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">Pricing</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Priced for people who bill by the hour.</h2>
          <p className="text-muted-foreground mt-2">
            Traceability and drift detection are Team-tier and up — never in a free plan. That's the moat, and we don't give it away.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={cn(
                "relative rounded-2xl border bg-card p-6 flex flex-col",
                t.highlight && "border-primary ring-2 ring-primary/20 shadow-lg md:-translate-y-2",
              )}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-6 rounded-full bg-primary text-primary-foreground text-[10px] font-mono-tight uppercase tracking-widest px-2.5 py-1">
                  Recommended · moat features live here
                </span>
              )}
              <div>
                <h3 className="font-display text-xl">{t.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-4xl">{t.price}</span>
                  <span className="text-sm text-muted-foreground">/ {t.period}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{t.tagline}</p>
              </div>
              <ul className="mt-5 space-y-2 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className={cn(
                      "mt-0.5 flex h-4 w-4 items-center justify-center rounded-full",
                      t.highlight ? "bg-primary text-primary-foreground" : "bg-confident/15 text-confident",
                    )}>
                      <Check className="size-3" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => { setAction(t.cta); setOpen(true); }}
                className={cn(
                  "mt-6 h-11 rounded-md font-medium transition",
                  t.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border bg-card hover:bg-muted",
                )}
              >
                {t.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
      <SignupWallModal open={open} onOpenChange={setOpen} action={action} />
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto max-w-[1400px] px-4 py-8 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-mono-tight">
          <span className="h-1.5 w-1.5 rounded-full bg-confident" />
          Visuail · a semantic artifact engine for discovery-driven work
        </div>
        <div className="flex items-center gap-4">
          <a className="hover:text-foreground" href="#product">Product</a>
          <a className="hover:text-foreground" href="#why-not-miro">Why not Miro</a>
          <a className="hover:text-foreground" href="#pricing">Pricing</a>
          <span>© 2026</span>
        </div>
      </div>
    </footer>
  );
}

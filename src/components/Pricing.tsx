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
      <div className="mx-auto max-w-[1200px] px-4 py-24 md:py-32">
        <div className="max-w-2xl mb-16">
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">Pricing</div>
          <h2 className="font-display text-4xl md:text-5xl mt-2 leading-[1.05]">Priced for people who bill by the hour.</h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Traceability and drift detection live in Team and up — never in a free plan. That's the moat.
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
                  <span className="font-display text-5xl tracking-tight">{t.price}</span>
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
                onClick={() => { setAction(t.cta); setOpen(true); }}
                className={cn(
                  "mt-8 h-11 rounded-md font-medium text-sm transition",
                  t.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border bg-transparent hover:bg-muted",
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
          <a className="hover:text-foreground" href="#workbench">Workbench</a>
          <a className="hover:text-foreground" href="#why-not-miro">Why not Miro</a>
          <a className="hover:text-foreground" href="#pricing">Pricing</a>

          <span>© 2026</span>
        </div>
      </div>
    </footer>
  );
}

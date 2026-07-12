import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LibraryBig, Workflow, LayoutGrid, ArrowRight } from "lucide-react";
import { SAMPLES, type Sample } from "@/data/samples";
import { cn } from "@/lib/utils";

type Kind = "process" | "bmc";

interface Template {
  id: string;
  job: string;
  desc: string;
  kind: Kind;
  sampleId: string;
  category: string;
  accent?: "drift";
}

const TEMPLATES: Template[] = [
  {
    id: "onboarding",
    job: "Document a client onboarding process",
    desc: "Turn an ops walkthrough into a typed process map with actors, systems, and exceptions.",
    kind: "process",
    sampleId: "banking",
    category: "Operations",
  },
  {
    id: "discovery-bmc",
    job: "Capture a discovery call as a business model",
    desc: "Extract a full BMC from a founder interview — segments, value, channels, costs.",
    kind: "bmc",
    sampleId: "haulpilot",
    category: "Strategy",
  },
  {
    id: "brd",
    job: "Turn a requirements call into a BRD",
    desc: "Extract steps and decisions, then generate a traceable business requirements doc.",
    kind: "process",
    sampleId: "banking",
    category: "Product",
  },
  {
    id: "compliance",
    job: "Map a compliance / approval workflow",
    desc: "Surface decision branches, exceptions, and hand-offs across teams and systems.",
    kind: "process",
    sampleId: "banking",
    category: "Risk & Compliance",
  },
  {
    id: "validate-idea",
    job: "Validate a new business idea from a pitch",
    desc: "Pressure-test a pitch against the 9 BMC blocks with confidence per assumption.",
    kind: "bmc",
    sampleId: "haulpilot",
    category: "Strategy",
  },
  {
    id: "scope-creep",
    job: "Track scope creep across stakeholder calls",
    desc: "Diff a follow-up against the original — see exactly which steps drifted.",
    kind: "process",
    sampleId: "banking",
    category: "Delivery",
    accent: "drift",
  },
];

export function TemplateGallery({ onPick }: { onPick: (sample: Sample) => void }) {
  const [open, setOpen] = useState(false);

  const handlePick = (t: Template) => {
    const s = SAMPLES.find((x) => x.id === t.sampleId);
    if (!s) return;
    onPick(s);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="rounded-full border border-dashed border-primary/40 bg-primary/5 text-primary px-3 py-1.5 text-xs transition hover:bg-primary/10 inline-flex items-center gap-1.5"
          title="Browse templates by job-to-be-done"
        >
          <LibraryBig className="size-3.5" />
          Browse templates
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">
            Template gallery
          </div>
          <DialogTitle className="font-display text-2xl">Start from a job, not a shape.</DialogTitle>
          <DialogDescription>
            Pick the outcome you want. Visuail loads a matching transcript — hit Extract to see the typed artifact.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto p-5 grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => handlePick(t)}
              className={cn(
                "group text-left rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:shadow-sm flex flex-col gap-2",
                t.accent === "drift" && "border-drift/30 bg-drift/[0.03]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <ThumbIcon kind={t.kind} accent={t.accent} />
                <span className="text-[10px] font-mono-tight uppercase tracking-wider text-muted-foreground">
                  {t.category}
                </span>
              </div>
              <div className="mt-1 font-display text-base leading-snug">{t.job}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{t.desc}</div>
              <div className="mt-auto pt-2 flex items-center justify-between text-[11px]">
                <span className="font-mono-tight text-muted-foreground">
                  {t.kind === "process" ? "Process map" : "Business Model Canvas"}
                </span>
                <span className="inline-flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition">
                  Use template <ArrowRight className="size-3" />
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="border-t px-6 py-3 flex items-center justify-between text-[11px] text-muted-foreground bg-muted/30">
          <span>Templates load a matching sample transcript — you can edit it before extracting.</span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThumbIcon({ kind, accent }: { kind: Kind; accent?: "drift" }) {
  const isProcess = kind === "process";
  return (
    <div
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md border bp-grid-fine",
        accent === "drift"
          ? "border-drift/40 text-drift"
          : isProcess
          ? "border-primary/30 text-primary"
          : "border-verified/40 text-verified"
      )}
    >
      {isProcess ? <Workflow className="size-4" /> : <LayoutGrid className="size-4" />}
    </div>
  );
}

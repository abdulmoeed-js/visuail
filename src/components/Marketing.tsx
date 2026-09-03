import { FileText, GitBranch, Grid3x3, ShieldAlert, Users, Briefcase, ClipboardList, MessageSquare, ListChecks } from "lucide-react";

const TONES = {
  confident: {
    dot: "bg-confident",
    accent: "text-confident",
    label: "typed",
  },
  unresolved: {
    dot: "bg-unresolved",
    accent: "text-unresolved",
    label: "traced",
  },
  drift: {
    dot: "bg-drift",
    accent: "text-drift",
    label: "drift-aware",
  },
} as const;

const TONE_CYCLE: Array<keyof typeof TONES> = ["confident", "unresolved", "drift"];

export function WhyNotMiro() {
  const artifacts: Array<{ icon: typeof FileText; title: string; blurb: string }> = [
    { icon: Grid3x3, title: "Process Map & BMC", blurb: "Typed extraction from a transcript or upload, not a blank canvas." },
    { icon: GitBranch, title: "Use Case Diagrams", blurb: "Derived automatically from the actors and steps already on the canvas." },
    { icon: Users, title: "RACI", blurb: "Actors x steps, editable inline — no separate spreadsheet to keep in sync." },
    { icon: ShieldAlert, title: "Risk Log", blurb: "Probability x impact scoring, response strategy, status — per project." },
    { icon: Users, title: "Stakeholder Analysis", blurb: "The classic influence/interest grid, built from your actual actors." },
    { icon: Briefcase, title: "Business Case", blurb: "Problem, options considered, recommendation — one place, not a doc that drifts from the model." },
    { icon: ClipboardList, title: "Requirements Mgmt Plan", blurb: "Purpose, scope, elicitation approach, change control — written down once." },
    { icon: MessageSquare, title: "Communication Plan", blurb: "Who needs to hear what, how, and how often." },
    { icon: ListChecks, title: "BRD & Backlog", blurb: "Fall out of the same source as everything else — never a second copy to maintain." },
  ];
  return (
    <section id="why-not-miro" className="border-t">
      <div className="mx-auto max-w-[1100px] px-4 py-24 md:py-36">
        <h2 className="font-display text-4xl md:text-5xl max-w-3xl leading-[1.05]">
          Everything a BA is expected to ship.{" "}
          <span className="italic text-primary">From one traced source.</span>
        </h2>
        <p className="text-muted-foreground mt-5 max-w-2xl text-lg">
          A first draft is easy. Staying right after the tenth stakeholder change is the job — that's where visu earns its keep.
        </p>
        <div className="mt-16 grid gap-6 sm:grid-cols-2 md:grid-cols-3">
          {artifacts.map((a, i) => {
            const t = TONES[TONE_CYCLE[i % TONE_CYCLE.length]];
            const Icon = a.icon;
            return (
              <div key={a.title} className="rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <div className="inline-flex items-center gap-1.5 font-mono-tight text-[10px] uppercase tracking-widest">
                    <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                    <span className={t.accent}>{t.label}</span>
                  </div>
                </div>
                <h3 className="font-display text-lg mt-3">{a.title}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{a.blurb}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

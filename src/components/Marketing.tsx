import { Check, X, Sparkles, GitBranch, ShieldAlert, Route } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductStrip() {
  const items = [
    { icon: Route,       h: "Typed IR, not shapes",       t: "Every artifact is a typed model. Actors, steps, decisions, and systems are first-class — not free-floating boxes on a canvas." },
    { icon: Sparkles,    h: "Generated downstream docs",  t: "One transcript produces a process map, a BRD, and a traced backlog. Or a BMC, a summary brief, and an open-questions list." },
    { icon: ShieldAlert, h: "Confidence, not guesses",    t: "Every extracted item carries a confidence score and, when low, the exact source quote. Nothing pretends to be certain." },
    { icon: GitBranch,   h: "Flags itself when stale",    t: "When the source of truth changes, Visuail marks the affected steps, requirements, and stories — not the whole document." },
  ];
  return (
    <section id="product" className="mx-auto max-w-[1400px] px-4 py-16 md:py-24 border-t">
      <div className="max-w-2xl mb-10">
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">The product</div>
        <h2 className="font-display text-3xl md:text-4xl mt-1">A semantic artifact engine, not a whiteboard.</h2>
        <p className="text-muted-foreground mt-2">
          The canvas <em>renders</em> the model — it is not the model. That's why edits round-trip
          to your BRD, your backlog, and your Jira project without falling out of sync.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, h, t }) => (
          <div key={h} className="rounded-xl border bg-card p-5 hover:border-primary/40 transition group">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition">
              <Icon className="size-4.5" />
            </div>
            <h3 className="mt-4 font-semibold text-base">{h}</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{t}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WhyNotMiro() {
  const rows = [
    { feat: "First-draft diagram from a transcript",   miro: true,  vis: true },
    { feat: "5,000 templates",                          miro: true,  vis: false },
    { feat: "Typed intermediate representation",       miro: false, vis: true },
    { feat: "Confidence scored per item",              miro: false, vis: true },
    { feat: "Generates BRD + backlog from same model", miro: false, vis: true },
    { feat: "Traceability from story back to source",  miro: false, vis: true },
    { feat: "Flags itself when source drifts",         miro: false, vis: true },
    { feat: "Refuses to draw when input is too thin",  miro: false, vis: true },
  ];
  return (
    <section id="why-not-miro" className="border-t bg-muted/30">
      <div className="mx-auto max-w-[1200px] px-4 py-16 md:py-24">
        <div className="max-w-2xl mb-10">
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">Why not Miro</div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">The category is oversaturated. The maintenance problem isn't.</h2>
          <p className="text-muted-foreground mt-2">
            Every competitor generates a decent first draft, then abandons it. Diagrams go stale, tickets drift, BRDs rot. Visuail's wedge is what happens on day 30, not day 0.
          </p>
        </div>
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-[11px] font-mono-tight uppercase tracking-widest text-muted-foreground">
                <th className="text-left px-4 py-3 w-1/2">Capability</th>
                <th className="text-center px-4 py-3">Miro (with AI)</th>
                <th className="text-center px-4 py-3 text-primary">Visuail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.feat} className={cn("border-t", i % 2 && "bg-muted/20")}>
                  <td className="px-4 py-3">{r.feat}</td>
                  <td className="px-4 py-3 text-center">
                    {r.miro
                      ? <Check className="size-4 text-confident inline" />
                      : <X className="size-4 text-muted-foreground/60 inline" />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.vis
                      ? <Check className="size-4 text-primary inline" />
                      : <X className="size-4 text-muted-foreground/60 inline" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

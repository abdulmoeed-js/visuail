import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, GradeBar } from "@/components/workbench/atoms";
import type { BaseItem } from "@/data/samples";
import { summarizeItems } from "@/lib/grade";
import { scrollToId } from "@/lib/scroll";

/** The hero card's illustrative items, graded by the product's own rules:
 *  confirmed by two calls, stated clearly, stated loosely, changed since. */
const HERO_ITEMS: { item: BaseItem; tone: "ok" | "warn" | "drift" }[] = [
  { item: { id: "ST1", text: "Receive application", confidence: 0.92, confirmedBySources: ["Call 1", "Call 2"] }, tone: "ok" },
  { item: { id: "ST2", text: "Verify completeness in CRM", confidence: 0.92 }, tone: "ok" },
  { item: { id: "ST3", text: "Run KYC checks", confidence: 0.92 }, tone: "ok" },
  { item: { id: "ST6", text: "Send welcome pack", confidence: 0.52 }, tone: "warn" },
  { item: { id: "ST7", text: "Notify customer", confidence: 0.9, drift: true }, tone: "drift" },
];
const HERO_SUMMARY = summarizeItems(HERO_ITEMS.map((h) => h.item));

export function Hero() {
  const scroll = () => scrollToId("workbench");
  return (
    <section className="relative overflow-hidden">
      {/* subtle blueprint grid backdrop */}
      <div className="absolute inset-0 bp-grid opacity-40 pointer-events-none [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      {/* signature blueprint glow */}
      <div
        aria-hidden
        className="absolute -top-32 left-1/2 -translate-x-1/2 h-[720px] w-[1100px] rounded-full pointer-events-none opacity-70"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 35%, transparent), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-40 right-[-10%] h-[420px] w-[420px] rounded-full pointer-events-none opacity-40"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--verified) 45%, transparent), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative mx-auto max-w-[1400px] px-4 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_460px] items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-md border bg-card/70 backdrop-blur px-2.5 py-1 text-[11px] font-mono-tight text-muted-foreground mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-confident animate-pulse" />
              For business analysts &amp; PMs
            </div>
            <h1 className="font-display text-[44px] leading-[1.02] md:text-[72px] md:leading-[0.98] tracking-[-0.012em] text-balance">
              Diagrams that know <span className="italic text-primary">when they drift.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
              Turns a discovery call into a full BA workstream — diagrams, RACI, risk log, business case —{" "}
              <span className="text-foreground font-medium">
                traced to source and flagged the moment the source changes.
              </span>
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button size="lg" onClick={scroll} className="h-11 px-5">
                See it on a sample call <ArrowRight className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground font-mono-tight">
                No signup. No wall before value.
              </span>
            </div>

          </div>

          <HeroCard />
        </div>
      </div>
    </section>
  );
}

function HeroCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-3xl bg-primary/5 blur-2xl pointer-events-none" />
      <div className="relative rounded-2xl border bg-card shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-drift/70" />
            <span className="h-2 w-2 rounded-full bg-unresolved/70" />
            <span className="h-2 w-2 rounded-full bg-confident/70" />
          </div>
          <span className="text-[10px] font-mono-tight text-muted-foreground">artifact.process.v1</span>
        </div>
        <div className="p-4 bp-grid-fine">
          {/* mini flow: the same grade chips and bar as the real artifact
              header and canvas nodes, worked out from these items */}
          <div className="mx-auto max-w-[300px] space-y-2.5">
            {HERO_ITEMS.map(({ item, tone }) => (
              <div key={item.id} className={cn(
                "flex items-center justify-between gap-2 rounded-md border-2 bg-card px-2.5 py-1.5 text-xs",
                tone === "ok" && "border-primary/40",
                tone === "warn" && "border-dashed border-unresolved bg-unresolved/5",
                tone === "drift" && "border-drift bg-drift/5",
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono-tight text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded">{item.id}</span>
                  <span className="truncate">{item.text}</span>
                </div>
                <ConfidenceBadge item={item} compact />
              </div>
            ))}
          </div>
        </div>
        <div className="border-t bg-muted/40 px-3 py-2">
          <GradeBar summary={HERO_SUMMARY} />
        </div>
      </div>
    </div>
  );
}

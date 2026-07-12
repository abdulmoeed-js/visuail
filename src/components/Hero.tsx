import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { scrollToId } from "@/lib/scroll";

export function Hero() {
  const scroll = () => scrollToId("workbench");
  return (
    <section className="relative overflow-hidden">
      {/* subtle blueprint grid backdrop */}
      <div className="absolute inset-0 bp-grid opacity-40 pointer-events-none [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      {/* signature blueprint glow */}
      <div
        aria-hidden
        className="absolute -top-32 left-1/2 -translate-x-1/2 h-[720px] w-[1100px] rounded-full pointer-events-none opacity-70 dark:opacity-90"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 35%, transparent), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-40 right-[-10%] h-[420px] w-[420px] rounded-full pointer-events-none opacity-40 dark:opacity-60"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--verified) 45%, transparent), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative mx-auto max-w-[1400px] px-4 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_460px] items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 backdrop-blur px-2.5 py-1 text-[11px] font-mono-tight text-muted-foreground mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-confident animate-pulse" />
              For business analysts &amp; PMs at services firms
            </div>
            <h1 className="font-display text-[44px] leading-[1.02] md:text-[72px] md:leading-[0.98] tracking-tight text-balance">
              Diagrams that <span className="italic text-primary">know when they're stale.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
              Miro is where you think.{" "}
              <span className="text-foreground font-medium">
                Visuail is what survives contact with delivery.
              </span>
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={scroll}
                className="group relative inline-flex h-11 items-center gap-2 rounded-md px-5 text-primary-foreground font-medium transition shadow-[0_8px_24px_-8px_color-mix(in_oklab,var(--primary)_60%,transparent)] hover:shadow-[0_12px_32px_-8px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:-translate-y-px"
                style={{
                  background:
                    "linear-gradient(135deg, var(--primary), color-mix(in oklab, var(--primary) 70%, var(--verified)))",
                }}
              >
                Try it on a real transcript <ArrowRight className="size-4 group-hover:translate-x-0.5 transition" />
              </button>
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
          {/* mini flow */}
          <div className="mx-auto max-w-[300px] space-y-2.5">
            {[
              { id: "ST1", t: "Receive application", tone: "ok" },
              { id: "ST2", t: "Verify completeness in CRM", tone: "ok" },
              { id: "ST3", t: "Run KYC checks", tone: "ok" },
              { id: "ST6", t: "Send welcome pack", tone: "warn" },
              { id: "ST7", t: "Notify customer", tone: "drift" },
            ].map((n) => (
              <div key={n.id} className={cn(
                "flex items-center justify-between rounded-md border-2 bg-card px-2.5 py-1.5 text-xs",
                n.tone === "ok" && "border-primary/40",
                n.tone === "warn" && "border-dashed border-unresolved bg-unresolved/5",
                n.tone === "drift" && "border-drift bg-drift/5",
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono-tight text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded">{n.id}</span>
                  <span className="truncate">{n.t}</span>
                </div>
                <span className={cn(
                  "font-mono-tight text-[9px] px-1.5 rounded",
                  n.tone === "ok" && "bg-confident/10 text-confident",
                  n.tone === "warn" && "bg-unresolved/20 text-[color:var(--unresolved-foreground)]",
                  n.tone === "drift" && "bg-drift/15 text-drift",
                )}>
                  {n.tone === "ok" ? "92%" : n.tone === "warn" ? "52%" : "drifted"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t bg-muted/40 px-3 py-2 flex items-center justify-between text-[11px] font-mono-tight">
          <span className="text-muted-foreground">avg confidence <span className="text-confident">86%</span></span>
          <span className="flex items-center gap-1 text-drift"><Check className="size-3" /> 1 drifted · <X className="size-3" /> 1 unresolved</span>
        </div>
      </div>
    </div>
  );
}

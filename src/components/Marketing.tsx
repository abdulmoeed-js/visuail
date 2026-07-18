const TONES = {
  confident: {
    dot: "bg-confident",
    accent: "text-confident",
    label: "typed",
  },
  unresolved: {
    dot: "bg-unresolved",
    accent: "text-unresolved dark:brightness-125",
    label: "traced",
  },
  drift: {
    dot: "bg-drift",
    accent: "text-drift",
    label: "drift-aware",
  },
} as const;

export function WhyNotMiro() {
  const contrasts: Array<{ k: string; v: string; tone: keyof typeof TONES }> = [
    {
      k: "A first draft, then you're on your own.",
      v: "One source, every downstream doc — BRD and backlog fall out of the same typed extraction.",
      tone: "confident",
    },
    {
      k: "Diagrams forget where a shape came from.",
      v: "Every item remembers where it came from — a confidence score and the source quote, on every item.",
      tone: "unresolved",
    },
    {
      k: "Stale diagrams stay silent.",
      v: "A source change flags exactly which steps, requirements, and stories it invalidated.",
      tone: "drift",
    },
  ];
  return (
    <section id="why-not-miro" className="border-t">
      <div className="mx-auto max-w-[1100px] px-4 py-24 md:py-36">
        <h2 className="font-display text-4xl md:text-5xl max-w-3xl leading-[1.05]">
          The category is oversaturated.{" "}
          <span className="italic text-primary">The maintenance problem isn't.</span>
        </h2>
        <p className="text-muted-foreground mt-5 max-w-2xl text-lg">
          Every competitor ships a decent first draft, then abandons it. Visuail's wedge is day 30, not day 0.
        </p>
        <div className="mt-16 space-y-12 md:space-y-16">
          {contrasts.map((c) => {
            const t = TONES[c.tone];
            return (
              <div key={c.k} className="grid gap-3 md:grid-cols-[1fr_1.2fr] md:gap-16 items-baseline">
                <div>
                  <div className="mb-3 inline-flex items-center gap-1.5 font-mono-tight text-[10px] uppercase tracking-widest">
                    <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                    <span className={t.accent}>{t.label}</span>
                  </div>
                  <p className="font-display text-2xl md:text-3xl text-muted-foreground/70 leading-tight">
                    {c.k}
                  </p>
                </div>
                <p className="font-display text-2xl md:text-3xl text-foreground leading-tight">
                  {c.v.split(/(confidence score|typed extraction|flags exactly)/).map((frag, i) =>
                    /confidence score|typed extraction|flags exactly/.test(frag) ? (
                      <span key={i} className={t.accent}>{frag}</span>
                    ) : (
                      <span key={i}>{frag}</span>
                    ),
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

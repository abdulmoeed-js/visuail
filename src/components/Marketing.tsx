const TONES = {
  confident: {
    dot: "bg-confident",
    accent: "text-confident",
    label: "typed",
  },
  unresolved: {
    dot: "bg-unresolved",
    accent: "text-[color:var(--unresolved-foreground)]",
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
      k: "Miro gives you a first draft.",
      v: "Visuail gives you a typed model — one source, BRD and backlog fall out of it.",
      tone: "confident",
    },
    {
      k: "Miro forgets where a shape came from.",
      v: "Every Visuail item carries a confidence score and the quote it was pulled from.",
      tone: "unresolved",
    },
    {
      k: "Miro diagrams go stale in silence.",
      v: "Visuail flags the exact steps, requirements, and stories the source just invalidated.",
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
                  {c.v.split(/(confidence score|typed model|flags the exact)/).map((frag, i) =>
                    /confidence score|typed model|flags the exact/.test(frag) ? (
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

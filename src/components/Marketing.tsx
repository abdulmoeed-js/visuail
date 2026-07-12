export function WhyNotMiro() {
  const contrasts = [
    {
      k: "Miro gives you a first draft.",
      v: "Visuail gives you a typed model — one that generates the BRD and the backlog from the same source.",
    },
    {
      k: "Miro forgets where a shape came from.",
      v: "Every item in Visuail carries a confidence score and the exact quote it was extracted from.",
    },
    {
      k: "Miro diagrams go stale in silence.",
      v: "Visuail flags the specific steps, requirements, and stories affected when the source of truth changes.",
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
          Every competitor generates a decent first draft, then abandons it. Visuail's wedge is what happens on day 30, not day 0.
        </p>
        <div className="mt-16 space-y-12 md:space-y-16">
          {contrasts.map((c) => (
            <div key={c.k} className="grid gap-3 md:grid-cols-[1fr_1.2fr] md:gap-16 items-baseline">
              <p className="font-display text-2xl md:text-3xl text-muted-foreground/70 leading-tight">
                {c.k}
              </p>
              <p className="font-display text-2xl md:text-3xl text-foreground leading-tight">
                {c.v}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

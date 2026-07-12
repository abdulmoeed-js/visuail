import type { ProcessModel, BMCModel } from "@/data/samples";
import { IdChip } from "./atoms";
import { cn } from "@/lib/utils";

export function BRDTab({ m }: { m: ProcessModel }) {
  const actorTxt = (id: string) => m.actors.find((a) => a.id === id)?.text ?? "";
  return (
    <article className="prose-none space-y-5 text-sm leading-relaxed max-w-3xl">
      <header>
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          BRD-001 · Generated · Draft
        </div>
        <h2 className="font-display text-2xl mt-1">{m.title} — Business Requirements Document</h2>
      </header>

      <section>
        <h3 className="font-semibold text-foreground">Overview</h3>
        <p className="text-muted-foreground">
          This document specifies the requirements for the <em>{m.title.toLowerCase()}</em> workflow,
          derived directly from stakeholder discovery. Each requirement traces to its source step
          in the process model.
        </p>
      </section>

      <section>
        <h3 className="font-semibold text-foreground">Actors</h3>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {m.actors.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1">
              <IdChip id={a.id} /> <span>{a.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold text-foreground">Functional requirements</h3>
        <ol className="mt-1.5 space-y-2">
          {m.steps.map((s, i) => (
            <li
              key={s.id}
              className={cn(
                "rounded-md border bg-card p-3",
                s.drift && "border-drift bg-drift/5",
                s.userAdded && "user-added",
              )}
            >
              <div className="flex items-center gap-2 text-[11px] font-mono-tight text-muted-foreground">
                <span className="text-foreground">REQ-{String(i + 1).padStart(3, "0")}</span>
                <span>→</span>
                <IdChip id={s.id} tone="primary" />
                {s.drift && <span className="text-drift">· source drifted</span>}
              </div>
              <div className="mt-1 text-sm">
                The system SHALL allow <strong>{actorTxt(s.actorId)}</strong> to {s.text.toLowerCase()}.
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="font-semibold text-foreground">Business rules</h3>
        <ul className="mt-1.5 space-y-1.5">
          {m.decisions.map((d) => (
            <li key={d.id} className="rounded-md border bg-card p-2.5 text-sm">
              <IdChip id={d.id} tone="primary" /> <strong>{d.text}</strong>
              <span className="text-muted-foreground"> — if yes → {d.yes}, if no → {d.no}</span>
            </li>
          ))}
        </ul>
      </section>

      {m.steps.some((s) => s.confidence < 0.7) && (
        <section className="rounded-md border border-unresolved bg-unresolved/10 p-3">
          <h4 className="text-sm font-semibold text-[color:var(--unresolved-foreground)]">
            Needs confirmation
          </h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-[color:var(--unresolved-foreground)]/90">
            {m.steps.filter((s) => s.confidence < 0.7).map((s) => (
              <li key={s.id}>{s.text} — <em>{s.snippet}</em></li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export function BacklogTab({ m }: { m: ProcessModel }) {
  const byActor = m.actors.map((a) => ({
    actor: a,
    stories: m.steps.filter((s) => s.actorId === a.id),
  })).filter((g) => g.stories.length);

  return (
    <div className="space-y-4">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
        EPIC-BOARD · Generated · Traced to source steps
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {byActor.map(({ actor, stories }, i) => (
          <section key={actor.id} className="rounded-lg border bg-card p-3">
            <header className="flex items-center justify-between border-b border-dashed pb-2 mb-2">
              <div className="flex items-center gap-2">
                <IdChip id={`EPIC-${String(i + 1).padStart(2, "0")}`} tone="primary" />
                <h4 className="font-semibold text-sm">{actor.text}</h4>
              </div>
              <span className="text-[11px] font-mono-tight text-muted-foreground">{stories.length} stories</span>
            </header>
            <ul className="space-y-1.5">
              {stories.map((s, j) => (
                <li key={s.id}
                  className={cn(
                    "rounded-md border p-2 text-sm",
                    s.drift && "border-drift bg-drift/5",
                    s.userAdded && "user-added",
                    !s.drift && !s.userAdded && s.confidence < 0.7 && "border-dashed border-unresolved bg-unresolved/5",
                  )}
                >
                  <div className="flex items-center gap-2 text-[10px] font-mono-tight text-muted-foreground">
                    <span className="text-foreground">US-{i + 1}.{j + 1}</span>
                    <span>→</span>
                    <IdChip id={s.id} tone="primary" />
                  </div>
                  <div className="mt-0.5 leading-snug">
                    <span className="text-muted-foreground">As a</span> <strong>{actor.text}</strong>,
                    <span className="text-muted-foreground"> I want to</span> {s.text.toLowerCase()},
                    <span className="text-muted-foreground"> so that</span> the onboarding workflow can proceed.
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export function BriefTab({ m }: { m: BMCModel }) {
  const by = (id: string) => m.blocks.find((b) => b.id === id)!;
  const seg = by("segments"), vp = by("value"), ch = by("channels"),
        rev = by("revenue"), cost = by("costs"), part = by("partnerships");
  const lows = m.blocks.flatMap((b) =>
    b.items.filter((i) => i.confidence < 0.7).map((i) => ({ ...i, block: b.title })),
  );

  return (
    <article className="max-w-3xl space-y-5 text-sm leading-relaxed">
      <header>
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          BRIEF-001 · One-page synthesis · Generated
        </div>
        <h2 className="font-display text-2xl mt-1">{m.title.split("—")[0]?.trim()} — one-page brief</h2>
      </header>

      <p>
        <strong>{m.title.split("—")[0]?.trim()}</strong> serves{" "}
        {seg.items.map((s) => s.text).join("; ").toLowerCase()}. The lead value proposition is{" "}
        <em>{vp.items[0]?.text.toLowerCase()}</em>, supported by{" "}
        {vp.items.slice(1).map((v) => v.text.toLowerCase()).join(" and ")}.
      </p>

      <p>
        Customers are acquired through {ch.items.map((c) => c.text.toLowerCase()).join(", ")}.
        Revenue is generated via {rev.items.map((r) => r.text.toLowerCase()).join(", ")}.
        Key partnerships include {part.items.map((p) => p.text).join(", ")}.
      </p>

      <p>
        The dominant cost drivers are {cost.items.map((c) => c.text.toLowerCase()).join(", ")}.
      </p>

      {lows.length > 0 && (
        <section className="rounded-md border border-unresolved bg-unresolved/10 p-3">
          <h4 className="text-sm font-semibold text-[color:var(--unresolved-foreground)]">
            Needs confirmation ({lows.length})
          </h4>
          <ul className="mt-1.5 list-disc pl-5 text-sm text-[color:var(--unresolved-foreground)]/90">
            {lows.map((l) => (
              <li key={l.id}><strong>{l.block}:</strong> {l.text}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export function QuestionsTab({ m }: { m: BMCModel }) {
  const lows = m.blocks.flatMap((b) =>
    b.items.filter((i) => i.confidence < 0.7).map((i) => ({ ...i, block: b })),
  );

  // hand-tailored questions per known low-confidence id
  const templates: Record<string, string> = {
    CS2: "Last-mile delivery inbound: do you want to actively pursue this segment, or would you rather qualify it out on first call? What win/loss data do we have from last-mile deals in the last 12 months?",
    VP1: "The 12–15% fuel savings claim is client-reported. Can we set up an audited case study with one of your top 3 fleets to convert this into a defensible number?",
    CH4: "Content marketing is listed but unproven. Are you willing to run a 90-day content pilot with a defined budget and success metric, or should we drop it from the channel mix?",
    CR3: "The Slack community's activity is unknown. Should we run an audit of monthly active members before deciding whether to invest, sunset, or replace it?",
    RV3: "Is the fuel-card upsell still on the roadmap? If yes, what's the decision criterion and by when? If no, what alternative expansion motion replaces it?",
    KP3: "The Canadian reseller relationship is informal. Is the lead flow worth formalising with a written agreement, or is the current handshake sufficient?",
    CO2: "AWS costs are outpacing revenue with no diagnosed cause. Can we get a FinOps review scheduled and identify the top 3 cost drivers before the next board meeting?",
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
        Q-BOARD · Generated from unresolved items
      </div>
      <p className="text-sm text-muted-foreground">
        Bring these to the next call. Each is tied to a specific low-confidence item in the canvas.
      </p>
      <ol className="space-y-2">
        {lows.map((l, i) => (
          <li key={l.id} className="rounded-md border bg-card p-3">
            <div className="flex items-center gap-2 text-[10px] font-mono-tight text-muted-foreground">
              <span className="text-foreground">Q-{String(i + 1).padStart(2, "0")}</span>
              <span>→</span>
              <IdChip id={l.id} />
              <span className="text-muted-foreground">· {l.block.title}</span>
            </div>
            <div className="mt-1 text-sm">
              {templates[l.id] ?? `Can you clarify: ${l.text}? The source quote was: "${l.snippet}".`}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

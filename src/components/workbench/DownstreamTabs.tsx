import { decisionBranches, type BaseItem, type ProcessModel, type BMCModel } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { ConfidenceBadge, IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";
import { cn } from "@/lib/utils";
import { analyzeRequirementText, needsQualityFlag } from "@/lib/requirements-quality";
import { NFR_CATEGORIES } from "@/data/samples";
import { gradeOf, quoteMissing, type GradeInfo } from "@/lib/grade";
import { EditableList } from "./EditableList";

/** Older projects recorded a failed quote check only as this note (grade.ts). */

/** The source's own words, or "" when there is no quote or the check didn't
 *  find it in the source: an unverified snippet is never shown as a quote. */
const verifiedQuote = (item: BaseItem) =>
  item.snippet && !quoteMissing(item)
    ? item.snippet
    : "";

// Needs confirming: unclear, changed in the source, or disputed. A loosely
// stated item that has since changed is the one that most needs asking about.
const needsLook = (item: BaseItem) => ["unclear", "changed", "disagree"].includes(gradeOf(item).grade);

/** Frame for a requirement or story, from its grade: red when the source changed or
 *  the sources disagree, dashed amber when unclear, teal when a person made
 *  or changed it. */
const gradeFrame = (g: GradeInfo) =>
  g.grade === "changed" || g.grade === "disagree" ? "border-drift bg-drift/5"
  : g.grade === "unclear" ? "border-dashed border-unresolved bg-unresolved/5"
  : g.provenance ? "user-added"
  : undefined;

/** Plain "Stated clearly" is the usual case, so only the others get a chip. */
const worthAChip = (g: GradeInfo) => g.grade !== "clear" || !!g.provenance;

export function BRDTab({
  m, onAddNFR, onDeleteAny, onUpdateItem,
}: {
  m: ProcessModel;
  onAddNFR: ArtifactEditing["onAddNFR"];
  onDeleteAny: ArtifactEditing["onDeleteAny"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
}) {
  const actorTxt = (id: string) => m.actors.find((a) => a.id === id)?.text ?? "";
  const nfrs = m.nonFunctionalRequirements ?? [];
  const unclearSteps = m.steps.filter(needsLook);
  return (
    <article className="prose-none space-y-5 text-sm leading-relaxed max-w-3xl">
      <header>
        <div className="eyebrow text-muted-foreground">
          BRD-001 · Draft
        </div>
        <h2 className="font-display text-2xl mt-1">{m.title} — Business Requirements Document</h2>
      </header>

      <section>
        <h3 className="font-semibold text-foreground">Overview</h3>
        <p className="text-muted-foreground">
          This document specifies the requirements for the <em>{m.title.toLowerCase()}</em> workflow.
          Each requirement traces to its source step in the process model.
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
          {m.steps.map((s, i) => {
            const quality = analyzeRequirementText(s.text);
            const flagged = needsQualityFlag(quality);
            const g = gradeOf(s);
            return (
              <li
                key={s.id}
                className={cn("rounded-md border bg-card p-3", gradeFrame(g))}
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tight text-muted-foreground">
                  <span className="text-foreground">REQ-{String(i + 1).padStart(3, "0")}</span>
                  <span>→</span>
                  <IdChip id={s.id} tone="primary" />
                  {worthAChip(g) && <span className="font-sans"><ConfidenceBadge item={s} /></span>}
                </div>
                <div className="mt-1 text-sm">
                  The system SHALL allow <strong>{actorTxt(s.actorId)}</strong> to {s.text.toLowerCase()}.
                </div>
                {flagged && (
                  <div
                    className="mt-1.5 inline-flex items-center gap-1 rounded border border-unresolved/50 bg-unresolved/10 px-1.5 py-0.5 text-[10px] font-mono-tight text-unresolved-ink"
                    title="Vague wording -- consider a more specific, testable phrasing"
                  >
                    vague: {quality.vagueTerms.map((v) => v.word).join(", ")}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h3 className="font-semibold text-foreground">Business rules</h3>
        <ul className="mt-1.5 space-y-1.5">
          {m.decisions.map((d) => (
            <li key={d.id} className="rounded-md border bg-card p-2.5 text-sm">
              <IdChip id={d.id} tone="primary" /> <strong>{d.text}</strong>
              <span className="text-muted-foreground">
                {" — "}
                {decisionBranches(d).map((b, i) => (
                  <span key={b.id}>{i > 0 && ", "}if {b.label.toLowerCase()} → {b.targetId}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold text-foreground">Non-functional requirements</h3>
        <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
          {NFR_CATEGORIES.map((cat) => (
            <div key={cat} className="rounded-md border bg-card p-2.5">
              <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">{cat}</h4>
              <EditableList
                items={nfrs.filter((n) => n.category === cat)}
                onAdd={(t) => onAddNFR(cat, t)}
                onDelete={onDeleteAny}
                onEdit={(id, t) => onUpdateItem(id, { text: t })}
                compact showIds={false}
                placeholder={`Add a ${cat.toLowerCase()} requirement…`}
              />
            </div>
          ))}
        </div>
      </section>

      {unclearSteps.length > 0 && (
        <section className="rounded-md border border-unresolved bg-unresolved/10 p-3">
          <h4 className="text-sm font-semibold text-unresolved-ink">
            Needs confirmation
          </h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-unresolved-ink">
            {unclearSteps.map((s) => {
              const quote = verifiedQuote(s);
              return (
                <li key={s.id}>
                  {s.text}
                  {quote
                    ? <> — <em>“{quote}”</em></>
                    : s.snippet ? <> — quote not found in the source</> : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}

export function BacklogTab({
  m, onUpdateItem,
}: {
  m: ProcessModel;
  onUpdateItem: ArtifactEditing["onUpdateItem"];
}) {
  const byActor = m.actors.map((a) => ({
    actor: a,
    stories: m.steps.filter((s) => s.actorId === a.id),
  })).filter((g) => g.stories.length);

  return (
    <div className="space-y-4">
      <div className="eyebrow text-muted-foreground">
        Backlog · each story links to its source step
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {byActor.map(({ actor, stories }, i) => (
          <section key={actor.id} className="rounded-lg border bg-card p-3">
            <header className="flex items-center justify-between border-b border-dashed pb-2 mb-2">
              <div className="flex items-center gap-2">
                <IdChip id={`EPIC-${String(i + 1).padStart(2, "0")}`} tone="primary" />
                <h4 className="font-semibold text-sm">{actor.text}</h4>
              </div>
              <span className="text-[11px] font-mono-tight text-muted-foreground">{stories.length} {stories.length === 1 ? "story" : "stories"}</span>
            </header>
            <ul className="space-y-1.5">
              {stories.map((s, j) => {
                const g = gradeOf(s);
                return (
                  <li key={s.id}
                    className={cn("rounded-md border p-2 text-sm", gradeFrame(g))}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono-tight text-muted-foreground">
                      <span className="text-foreground">US-{i + 1}.{j + 1}</span>
                      <span>→</span>
                      <IdChip id={s.id} tone="primary" />
                      {worthAChip(g) && <span className="font-sans"><ConfidenceBadge item={s} /></span>}
                    </div>
                    <div className="mt-0.5 leading-snug">
                      <span className="text-muted-foreground">As a</span> <strong>{actor.text}</strong>,
                      <span className="text-muted-foreground"> I want to</span> {s.text.toLowerCase()}.
                    </div>
                    <div className="mt-1.5 rounded-md border border-dashed bg-muted/30 px-2 py-1 text-[12px]">
                      <span className="text-muted-foreground">Acceptance criteria: </span>
                      <InlineEdit
                        value={s.acceptanceCriteria ?? ""}
                        onChange={(v) => onUpdateItem(s.id, { acceptanceCriteria: v })}
                        placeholder={`Given the current state, when ${actor.text.toLowerCase()} performs "${s.text.toLowerCase()}", then the workflow reflects it accurately.`}
                        multiline
                        label={`Acceptance criteria for US-${i + 1}.${j + 1}`}
                      />
                    </div>
                  </li>
                );
              })}
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
    b.items.filter(needsLook).map((i) => ({ ...i, block: b.title })),
  );

  return (
    <article className="max-w-3xl space-y-5 text-sm leading-relaxed">
      <header>
        <div className="eyebrow text-muted-foreground">
          BRIEF-001 · One-page summary
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
          <h4 className="text-sm font-semibold text-unresolved-ink">
            Needs confirmation ({lows.length})
          </h4>
          <ul className="mt-1.5 list-disc pl-5 text-sm text-unresolved-ink">
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
    b.items.filter(needsLook).map((i) => ({ ...i, block: b })),
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
      <div className="eyebrow text-muted-foreground">
        Questions · from items that need confirming
      </div>
      <p className="text-sm text-muted-foreground">
        Bring these to the next call. Each one points to an item the call didn't make clear.
      </p>
      <ol className="space-y-2">
        {lows.map((l, i) => {
          const quote = verifiedQuote(l);
          return (
            <li key={l.id} className="rounded-md border bg-card p-3">
              <div className="flex items-center gap-2 text-[10px] font-mono-tight text-muted-foreground">
                <span className="text-foreground">Q-{String(i + 1).padStart(2, "0")}</span>
                <span>→</span>
                <IdChip id={l.id} />
                <span className="text-muted-foreground">· {l.block.title}</span>
              </div>
              <div className="mt-1 text-sm">
                {templates[l.id] ?? `Can you clarify: ${l.text}?${quote ? ` The source quote was: “${quote}”.` : ""}`}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

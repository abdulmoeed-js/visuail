import {
  PRIORITIZATION_TECHNIQUES, type ArtifactModel, type PrioritizationTechnique, type RequirementsManagementPlan,
} from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InlineEdit } from "./InlineEdit";

const FIELDS_BEFORE: { key: "purpose" | "scope" | "elicitationApproach"; label: string; placeholder: string }[] = [
  { key: "purpose", label: "Purpose", placeholder: "Why does this plan exist, and who is it for?" },
  { key: "scope", label: "Scope", placeholder: "What requirements work is -- and isn't -- covered?" },
  { key: "elicitationApproach", label: "Elicitation approach", placeholder: "How will requirements be gathered -- interviews, workshops, document analysis?" },
];

const FIELDS_AFTER: { key: "traceabilityApproach" | "changeControlProcess"; label: string; placeholder: string }[] = [
  { key: "traceabilityApproach", label: "Traceability approach", placeholder: "How does each requirement stay linked back to its source and forward to delivery?" },
  { key: "changeControlProcess", label: "Change control process", placeholder: "How do requirement changes get proposed, reviewed, and approved after baseline?" },
];

/** General, public prioritization techniques -- not sourced from any one
 *  book. Picking one inserts its starter block into the free-text approach
 *  field rather than replacing it, since the field itself stays free-form
 *  and a team's real approach is usually a filled-in version of this, not
 *  the template verbatim. */
const TECHNIQUE_TEMPLATES: Record<PrioritizationTechnique, string> = {
  "MoSCoW": "Must have:\nShould have:\nCould have:\nWon't have (this phase):",
  "Weighted scoring": "Criteria and weights:\n- \nScore each requirement 1-5 per criterion, multiply by weight, rank by total.",
  "Kano model": "Basic (expected, causes dissatisfaction if missing):\nPerformance (more is better):\nDelighter (unexpected, drives satisfaction):",
  "Value vs. effort": "Plot each requirement on a value (low/high) vs. effort (low/high) grid. Prioritize high-value, low-effort first.",
  "Stack ranking": "Single ordered list, most to least important. No ties -- every requirement gets a unique rank.",
  "Cost of Delay (WSJF)": "Score = (business value + time criticality + risk reduction) / job size. Rank by score, highest first.",
};

/** Requirements Management Plan -- purpose/scope/elicitation/change-control,
 *  from the corpus's Requirements Management Plan Template. A project-level
 *  planning document, same shape on both model kinds. */
export function RequirementsManagementPlanView({
  model, onUpdateRMP,
}: {
  model: ArtifactModel;
  onUpdateRMP: ArtifactEditing["onUpdateRMP"];
}) {
  const rmp = model.requirementsManagementPlan ?? {};
  const selectedTechniques = rmp.prioritizationTechniques ?? [];

  const handleTechniqueChange = (next: string[]) => {
    const added = next.filter((t) => !selectedTechniques.includes(t as PrioritizationTechnique));
    let approach = rmp.prioritizationApproach ?? "";
    for (const t of added as PrioritizationTechnique[]) {
      const header = `${t}:`;
      if (!approach.includes(header)) {
        const block = `${header}\n${TECHNIQUE_TEMPLATES[t]}`;
        approach = approach ? `${approach}\n\n${block}` : block;
      }
    }
    onUpdateRMP({ prioritizationTechniques: next as PrioritizationTechnique[], prioritizationApproach: approach });
  };

  const field = (f: { key: "purpose" | "scope" | "elicitationApproach" | "traceabilityApproach" | "changeControlProcess"; label: string; placeholder: string }) => (
    <section key={f.key}>
      <h3 className="font-semibold text-foreground mb-1">{f.label}</h3>
      <div className="rounded-md border bg-card p-2.5">
        <InlineEdit
          value={rmp[f.key] ?? ""}
          onChange={(v) => onUpdateRMP({ [f.key]: v })}
          placeholder={f.placeholder}
          multiline as="block"
        />
      </div>
    </section>
  );

  return (
    <article className="max-w-3xl space-y-5 text-sm leading-relaxed">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
        REQUIREMENTS MANAGEMENT PLAN
      </div>
      {FIELDS_BEFORE.map(field)}

      <section>
        <h3 className="font-semibold text-foreground mb-1">Prioritization approach</h3>
        <p className="text-xs text-muted-foreground mb-2">
          Pick any techniques in play -- selecting one drops a starter template into the box below.
        </p>
        <ToggleGroup
          type="multiple"
          value={selectedTechniques}
          onValueChange={handleTechniqueChange}
          className="flex-wrap justify-start gap-1.5 mb-2"
        >
          {PRIORITIZATION_TECHNIQUES.map((t) => (
            <ToggleGroupItem
              key={t} value={t}
              className="h-7 rounded-full border px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            >
              {t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="rounded-md border bg-card p-2.5">
          <InlineEdit
            value={rmp.prioritizationApproach ?? ""}
            onChange={(v) => onUpdateRMP({ prioritizationApproach: v })}
            placeholder="How do requirements get ranked? Pick a technique above, or describe your own."
            multiline as="block"
          />
        </div>
      </section>

      {FIELDS_AFTER.map(field)}
    </article>
  );
}

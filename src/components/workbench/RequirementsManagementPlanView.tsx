import type { ArtifactModel } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { InlineEdit } from "./InlineEdit";

const FIELDS: { key: "purpose" | "scope" | "elicitationApproach" | "changeControlProcess"; label: string; placeholder: string }[] = [
  { key: "purpose", label: "Purpose", placeholder: "Why does this plan exist, and who is it for?" },
  { key: "scope", label: "Scope", placeholder: "What requirements work is -- and isn't -- covered?" },
  { key: "elicitationApproach", label: "Elicitation approach", placeholder: "How will requirements be gathered -- interviews, workshops, document analysis?" },
  { key: "changeControlProcess", label: "Change control process", placeholder: "How do requirement changes get proposed, reviewed, and approved after baseline?" },
];

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

  return (
    <article className="max-w-3xl space-y-5 text-sm leading-relaxed">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
        REQUIREMENTS MANAGEMENT PLAN
      </div>
      {FIELDS.map((f) => (
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
      ))}
    </article>
  );
}

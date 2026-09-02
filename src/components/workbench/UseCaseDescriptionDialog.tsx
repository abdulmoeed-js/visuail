import type { ProcessModel } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { deriveUseCaseDescription } from "@/lib/usecase";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";

// Renders a step as a classic Use Case Description: actor, pre/post-condition,
// basic flow, alternate flows (from decisions pointing at this step), and
// exception flows (from exceptions pointing at this step). Basic/alternate/
// exception flow are fully derived; pre/post-condition can't be inferred and
// are small user-fillable fields on the step itself.

export function UseCaseDescriptionDialog({
  model, stepId, onOpenChange, onUpdateItem,
}: {
  model: ProcessModel;
  stepId: string | null;
  onOpenChange: (open: boolean) => void;
  onUpdateItem: ArtifactEditing["onUpdateItem"];
}) {
  const draft = stepId ? deriveUseCaseDescription(model, stepId) : undefined;

  return (
    <Dialog open={!!stepId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {draft && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
                Use case <IdChip id={draft.step.id} />
              </div>
              <DialogTitle>{draft.step.text}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <Field label="Actor">
                {draft.actor ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm">
                    {draft.actor.text}
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">No actor assigned</span>
                )}
              </Field>

              <Field label="Pre-condition">
                <Blank
                  value={draft.step.preCondition ?? ""}
                  onChange={(v) => onUpdateItem(draft.step.id, { preCondition: v })}
                  placeholder="What must be true before this use case starts?"
                />
              </Field>

              <Field label="Basic flow">
                <ol className="space-y-1">
                  {draft.basicFlow.map((line, i) => (
                    <li key={i} className="rounded-md border bg-card px-2.5 py-1.5">
                      {i + 1}. {line}
                    </li>
                  ))}
                </ol>
              </Field>

              {draft.alternateFlows.length > 0 && (
                <Field label="Alternate flows">
                  <ul className="space-y-1.5">
                    {draft.alternateFlows.map((f, i) => (
                      <li key={i} className="rounded-md border bg-card px-2.5 py-1.5">
                        <IdChip id={f.decision.id} tone="primary" /> {f.decision.text}
                        <span className="text-muted-foreground"> — if {f.branch} → </span>
                        {f.targetLabel}
                      </li>
                    ))}
                  </ul>
                </Field>
              )}

              {draft.exceptionFlows.length > 0 && (
                <Field label="Exception flows">
                  <ul className="space-y-1.5">
                    {draft.exceptionFlows.map((e) => (
                      <li key={e.id} className="rounded-md border border-drift/40 bg-drift/5 px-2.5 py-1.5">
                        <IdChip id={e.id} /> {e.text}
                      </li>
                    ))}
                  </ul>
                </Field>
              )}

              <Field label="Post-condition">
                <Blank
                  value={draft.step.postCondition ?? ""}
                  onChange={(v) => onUpdateItem(draft.step.id, { postCondition: v })}
                  placeholder="What must be true after this use case completes?"
                />
              </Field>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Pre/post-condition editor -- amber "needs confirmation" treatment when empty,
 *  matching BRDTab's low-confidence styling, since this is data we genuinely
 *  don't have rather than something extracted at low confidence. */
function Blank({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5",
        value ? "bg-card" : "border-unresolved bg-unresolved/10 text-[color:var(--unresolved-foreground)]",
      )}
    >
      <InlineEdit value={value} onChange={onChange} placeholder={placeholder} multiline as="block" />
    </div>
  );
}

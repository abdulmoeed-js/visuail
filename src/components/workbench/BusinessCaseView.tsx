import type { ArtifactModel } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";

/** Business Case -- problem statement, options considered (incl. an
 *  implicit "do nothing"), recommendation. Structure converged across the
 *  corpus's Corporate Education Group / TheBAGuide / OSSIE templates. */
export function BusinessCaseView({
  model, onUpdateBusinessCase, onAddBusinessCaseOption, onUpdateItem, onDeleteAny,
}: {
  model: ArtifactModel;
  onUpdateBusinessCase: ArtifactEditing["onUpdateBusinessCase"];
  onAddBusinessCaseOption: ArtifactEditing["onAddBusinessCaseOption"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
  onDeleteAny: ArtifactEditing["onDeleteAny"];
}) {
  const bc = model.businessCase ?? {};
  const options = bc.options ?? [];

  return (
    <article className="max-w-3xl space-y-5 text-sm leading-relaxed">
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
        BUSINESS CASE
      </div>

      <section>
        <h3 className="font-semibold text-foreground mb-1">Problem statement</h3>
        <div className="rounded-md border bg-card p-2.5">
          <InlineEdit
            value={bc.problemStatement ?? ""}
            onChange={(v) => onUpdateBusinessCase({ problemStatement: v })}
            placeholder="What opportunity or issue is this project addressing?"
            multiline as="block"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-foreground">Options considered</h3>
          <Button size="sm" variant="outline" onClick={() => onAddBusinessCaseOption("New option")}>
            <Plus className="size-3.5" /> Add option
          </Button>
        </div>
        {options.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Include every real option, even "do nothing" -- it's the baseline every other option gets compared against.
          </div>
        ) : (
          <div className="space-y-2">
            {options.map((o) => (
              <div key={o.id} className="rounded-md border bg-card p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    <IdChip id={o.id} />
                    <InlineEdit value={o.text} onChange={(v) => onUpdateItem(o.id, { text: v })} />
                  </div>
                  <button onClick={() => onDeleteAny(o.id)} className="text-muted-foreground hover:text-destructive transition">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2 text-xs">
                  <div>
                    <div className="text-muted-foreground mb-0.5">Pros</div>
                    <InlineEdit value={o.pros ?? ""} onChange={(v) => onUpdateItem(o.id, { pros: v })} multiline as="block" />
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-0.5">Cons</div>
                    <InlineEdit value={o.cons ?? ""} onChange={(v) => onUpdateItem(o.id, { cons: v })} multiline as="block" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="font-semibold text-foreground mb-1">Recommendation</h3>
        <div className="rounded-md border bg-card p-2.5">
          <InlineEdit
            value={bc.recommendation ?? ""}
            onChange={(v) => onUpdateBusinessCase({ recommendation: v })}
            placeholder="Which option, and why?"
            multiline as="block"
          />
        </div>
      </section>
    </article>
  );
}

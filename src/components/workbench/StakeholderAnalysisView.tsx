import type { ArtifactModel, Level } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";
import { SelectBadge } from "./SelectBadge";

const LEVELS: readonly Level[] = ["Low", "Medium", "High"];
const levelTone = (v: Level) =>
  v === "High" ? "border-drift/50 bg-drift/10 text-drift"
  : v === "Medium" ? "border-unresolved bg-unresolved/15 text-[color:var(--unresolved-foreground)]"
  : "border-confident/40 bg-confident/10 text-[color:var(--confident)]";

interface Row { id: string; text: string; role?: string; influence: Level; interest: Level }

const QUADRANTS: { title: string; hint: string; influence: "high" | "low"; interest: "high" | "low" }[] = [
  { title: "Manage Closely", hint: "High influence, high interest", influence: "high", interest: "high" },
  { title: "Keep Satisfied", hint: "High influence, lower interest", influence: "high", interest: "low" },
  { title: "Keep Informed", hint: "Lower influence, high interest", influence: "low", interest: "high" },
  { title: "Monitor", hint: "Lower influence, lower interest", influence: "low", interest: "low" },
];

/** Stakeholder Analysis -- the classic influence/interest 2x2 grid from the
 *  corpus's Stakeholder Analysis templates. On Process this enriches Actor
 *  directly (no duplicate stakeholder list); BMC has no actor concept, so
 *  it gets its own small array instead -- same grid, different source. */
export function StakeholderAnalysisView({
  model, onAddStakeholder, onUpdateItem,
}: {
  model: ArtifactModel;
  /** Undefined on Process -- actors are added via the canvas, not here. */
  onAddStakeholder?: ArtifactEditing["onAddStakeholder"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
}) {
  const rows: Row[] = model.kind === "process"
    ? model.actors.map((a) => ({ id: a.id, text: a.text, role: a.role, influence: a.influence ?? "Medium", interest: a.interest ?? "Medium" }))
    : (model.stakeholders ?? []).map((s) => ({ id: s.id, text: s.text, role: s.role, influence: s.influence, interest: s.interest }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          STAKEHOLDER ANALYSIS · {rows.length}
        </div>
        {onAddStakeholder && (
          <Button size="sm" variant="outline" onClick={() => onAddStakeholder("New stakeholder")}>
            <Plus className="size-3.5" /> Add stakeholder
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {model.kind === "process"
            ? "Add actors on the Process map, then rate their influence and interest here."
            : "No stakeholders logged yet."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {QUADRANTS.map((q) => {
              const inQuadrant = rows.filter((r) =>
                (q.influence === "high" ? r.influence !== "Low" : r.influence === "Low") &&
                (q.interest === "high" ? r.interest !== "Low" : r.interest === "Low"),
              );
              return (
                <div key={q.title} className="rounded-lg border bg-card p-3 min-h-[110px]">
                  <div className="flex items-baseline justify-between">
                    <h4 className="text-sm font-semibold">{q.title}</h4>
                    <span className="text-[10px] font-mono-tight text-muted-foreground">{q.hint}</span>
                  </div>
                  {inQuadrant.length === 0 ? (
                    <div className="text-xs text-muted-foreground mt-2 italic">none yet</div>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {inQuadrant.map((r) => (
                        <li key={r.id} className="rounded-md border bg-background px-2 py-1 text-xs">
                          {r.text}{r.role ? <span className="text-muted-foreground"> · {r.role}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] text-muted-foreground">
                  <th className="p-2 font-medium">Stakeholder</th>
                  <th className="p-2 font-medium">Role</th>
                  <th className="p-2 font-medium">Influence</th>
                  <th className="p-2 font-medium">Interest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2">
                      <div className="flex items-center gap-1.5"><IdChip id={r.id} tone="primary" /> {r.text}</div>
                    </td>
                    <td className="p-2">
                      <InlineEdit value={r.role ?? ""} onChange={(v) => onUpdateItem(r.id, { role: v })} placeholder="Role" />
                    </td>
                    <td className={cn("p-2")}>
                      <SelectBadge value={r.influence} options={LEVELS} tone={levelTone}
                        onChange={(v) => onUpdateItem(r.id, { influence: v })} />
                    </td>
                    <td className="p-2">
                      <SelectBadge value={r.interest} options={LEVELS} tone={levelTone}
                        onChange={(v) => onUpdateItem(r.id, { interest: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

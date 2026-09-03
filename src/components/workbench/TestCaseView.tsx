import { TEST_STATUSES, type Level, type ProcessModel, type TestStatus } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";
import { SelectBadge } from "./SelectBadge";

const statusTone = (v: TestStatus) =>
  v === "Pass" ? "border-confident/40 bg-confident/10 text-[color:var(--confident)]"
  : v === "Fail" ? "border-drift/50 bg-drift/10 text-drift"
  : "border-muted-foreground/30 bg-muted text-muted-foreground";

const PRIORITIES: readonly Level[] = ["Low", "Medium", "High"];
const priorityTone = (v: Level) =>
  v === "High" ? "border-drift/50 bg-drift/10 text-drift"
  : v === "Medium" ? "border-unresolved bg-unresolved/15 text-[color:var(--unresolved-foreground)]"
  : "border-confident/40 bg-confident/10 text-[color:var(--confident)]";

/** Test Case -- objective, preconditions, expected result, pass/fail status,
 *  optionally linked to the step it verifies. Process only: a business
 *  model has no steps to write test cases against. */
export function TestCaseView({
  model, onAddTestCase, onUpdateItem, onDeleteAny,
}: {
  model: ProcessModel;
  onAddTestCase: ArtifactEditing["onAddTestCase"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
  onDeleteAny: ArtifactEditing["onDeleteAny"];
}) {
  const cases = model.testCases ?? [];
  const stepText = (id?: string) => model.steps.find((s) => s.id === id)?.text;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          TEST CASES · {cases.length}
        </div>
        <Button size="sm" variant="outline" onClick={() => onAddTestCase("New test case")}>
          <Plus className="size-3.5" /> Add test case
        </Button>
      </div>

      {cases.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No test cases yet. Write one for any step where "it works" needs a concrete, checkable definition.
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Objective</TableHead>
                <TableHead className="min-w-[140px]">Verifies step</TableHead>
                <TableHead className="min-w-[180px]">Preconditions</TableHead>
                <TableHead className="min-w-[160px]">Test data</TableHead>
                <TableHead className="min-w-[200px]">Steps</TableHead>
                <TableHead className="min-w-[200px]">Expected result</TableHead>
                <TableHead className="min-w-[200px]">Actual result</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="flex items-start gap-1.5">
                      <IdChip id={t.id} tone="primary" />
                      <InlineEdit value={t.text} onChange={(v) => onUpdateItem(t.id, { text: v })} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <select
                      value={t.relatedStepId ?? ""}
                      onChange={(e) => onUpdateItem(t.id, { relatedStepId: e.target.value || undefined })}
                      className="w-full rounded border bg-transparent px-1.5 py-1 text-xs"
                    >
                      <option value="">— none —</option>
                      {model.steps.map((s) => (
                        <option key={s.id} value={s.id}>{s.id} · {s.text.slice(0, 30)}</option>
                      ))}
                    </select>
                    {t.relatedStepId && !stepText(t.relatedStepId) && (
                      <div className="text-[10px] text-drift mt-0.5">step no longer exists</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={t.preconditions ?? ""} onChange={(v) => onUpdateItem(t.id, { preconditions: v })}
                      placeholder="What must be true first?" />
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={t.testData ?? ""} onChange={(v) => onUpdateItem(t.id, { testData: v })}
                      placeholder="Specific input values used" />
                  </TableCell>
                  <TableCell>
                    <InlineEdit
                      value={(t.steps ?? []).join("\n")}
                      onChange={(v) => onUpdateItem(t.id, { steps: v.split("\n").map((s) => s.trim()).filter(Boolean) })}
                      placeholder="One action per line, or a single paragraph"
                      multiline as="block"
                    />
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={t.expectedResult} onChange={(v) => onUpdateItem(t.id, { expectedResult: v })}
                      placeholder="What should happen?" />
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={t.actualResult ?? ""} onChange={(v) => onUpdateItem(t.id, { actualResult: v })}
                      placeholder={t.status === "Not Run" ? "Fill in after running" : "What actually happened?"} />
                  </TableCell>
                  <TableCell>
                    <SelectBadge<Level> value={t.priority ?? "Medium"} options={PRIORITIES} tone={priorityTone}
                      onChange={(v) => onUpdateItem(t.id, { priority: v })} />
                  </TableCell>
                  <TableCell>
                    <SelectBadge<TestStatus> value={t.status} options={TEST_STATUSES} tone={statusTone}
                      onChange={(v) => onUpdateItem(t.id, { status: v })} />
                  </TableCell>
                  <TableCell>
                    <button onClick={() => onDeleteAny(t.id)} className="text-muted-foreground hover:text-destructive transition">
                      <X className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

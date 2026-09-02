import { RISK_RESPONSES, type ArtifactModel, type Level, type RiskItem, type RiskResponse } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";
import { SelectBadge } from "./SelectBadge";

const LEVELS: readonly Level[] = ["Low", "Medium", "High"];
const levelTone = (v: Level) =>
  v === "High" ? "border-drift/50 bg-drift/10 text-drift"
  : v === "Medium" ? "border-unresolved bg-unresolved/15 text-[color:var(--unresolved-foreground)]"
  : "border-confident/40 bg-confident/10 text-[color:var(--confident)]";
const responseTone = () => "border-primary/40 bg-primary/10 text-primary";
const LEVEL_SCORE: Record<Level, number> = { Low: 1, Medium: 2, High: 3 };
const scoreTone = (score: number) =>
  score >= 6 ? "border-drift/50 bg-drift/10 text-drift"
  : score >= 3 ? "border-unresolved bg-unresolved/15 text-[color:var(--unresolved-foreground)]"
  : "border-confident/40 bg-confident/10 text-[color:var(--confident)]";

/** Risk Log -- probability x impact scoring, response strategy, status.
 *  Available on both Process and BMC models (every project has risks). */
export function RiskLogView({
  model, onAddRisk, onUpdateItem, onDeleteAny,
}: {
  model: ArtifactModel;
  onAddRisk: ArtifactEditing["onAddRisk"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
  onDeleteAny: ArtifactEditing["onDeleteAny"];
}) {
  const risks = model.riskLog ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          RISK LOG · {risks.length} risk{risks.length === 1 ? "" : "s"}
        </div>
        <Button size="sm" variant="outline" onClick={() => onAddRisk("New risk")}>
          <Plus className="size-3.5" /> Add risk
        </Button>
      </div>

      {risks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No risks logged yet. A risk is anything that could stop this project or model from succeeding.
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[240px]">Risk</TableHead>
                <TableHead>Probability</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {risks.map((r: RiskItem) => {
                const score = LEVEL_SCORE[r.probability] * LEVEL_SCORE[r.impact];
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-start gap-1.5">
                        <IdChip id={r.id} tone="primary" />
                        <InlineEdit value={r.text} onChange={(v) => onUpdateItem(r.id, { text: v })} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <SelectBadge value={r.probability} options={LEVELS} tone={levelTone}
                        onChange={(v) => onUpdateItem(r.id, { probability: v })} />
                    </TableCell>
                    <TableCell>
                      <SelectBadge value={r.impact} options={LEVELS} tone={levelTone}
                        onChange={(v) => onUpdateItem(r.id, { impact: v })} />
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono-tight", scoreTone(score))}>
                        {score}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SelectBadge<RiskResponse> value={r.response} options={RISK_RESPONSES} tone={responseTone}
                        onChange={(v) => onUpdateItem(r.id, { response: v })} />
                    </TableCell>
                    <TableCell>
                      <SelectBadge value={r.status} options={["Open", "Closed"] as const} tone={() => "border-muted-foreground/30 bg-muted text-muted-foreground"}
                        onChange={(v) => onUpdateItem(r.id, { status: v })} />
                    </TableCell>
                    <TableCell>
                      <button onClick={() => onDeleteAny(r.id)} className="text-muted-foreground hover:text-destructive transition">
                        <X className="size-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

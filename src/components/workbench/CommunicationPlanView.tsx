import type { ArtifactModel } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";

/** Communication Plan -- activity/audience/method/frequency, from the
 *  corpus's Communication Plan Template. Both model kinds. */
export function CommunicationPlanView({
  model, onAddCommunicationPlanItem, onUpdateItem, onDeleteAny,
}: {
  model: ArtifactModel;
  onAddCommunicationPlanItem: ArtifactEditing["onAddCommunicationPlanItem"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
  onDeleteAny: ArtifactEditing["onDeleteAny"];
}) {
  const items = model.communicationPlan ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          COMMUNICATION PLAN · {items.length} activit{items.length === 1 ? "y" : "ies"}
        </div>
        <Button size="sm" variant="outline" onClick={() => onAddCommunicationPlanItem("New activity")}>
          <Plus className="size-3.5" /> Add activity
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No communication activities planned yet -- who needs to hear what, how, and how often?
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Activity</TableHead>
                <TableHead className="min-w-[160px]">Audience</TableHead>
                <TableHead className="min-w-[140px]">Method</TableHead>
                <TableHead className="min-w-[120px]">Frequency</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-start gap-1.5">
                      <IdChip id={c.id} tone="primary" />
                      <InlineEdit value={c.text} onChange={(v) => onUpdateItem(c.id, { text: v })} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={c.audience} onChange={(v) => onUpdateItem(c.id, { audience: v })} placeholder="Who" />
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={c.method} onChange={(v) => onUpdateItem(c.id, { method: v })} placeholder="Email, meeting, …" />
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={c.frequency} onChange={(v) => onUpdateItem(c.id, { frequency: v })} placeholder="Weekly, …" />
                  </TableCell>
                  <TableCell>
                    <button onClick={() => onDeleteAny(c.id)} className="text-muted-foreground hover:text-destructive transition">
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

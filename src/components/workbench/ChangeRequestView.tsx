import { CHANGE_TYPES, CHANGE_DISPOSITIONS, type ArtifactModel, type ChangeType, type ChangeDisposition } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { IdChip } from "./atoms";
import { InlineEdit } from "./InlineEdit";
import { SelectBadge } from "./SelectBadge";

const typeTone = () => "border-primary/40 bg-primary/10 text-primary";
const dispositionTone = (v: ChangeDisposition) =>
  v === "Approved" ? "border-confident/40 bg-confident/10 text-confident-ink"
  : v === "Denied" ? "border-drift/50 bg-drift/10 text-drift-ink"
  : v === "Postponed" ? "border-unresolved bg-unresolved/15 text-unresolved-ink"
  : "border-muted-foreground/30 bg-muted text-muted-foreground";

/** Change Request -- proposed additions/modifications/deletions to the
 *  requirements or model, with a disposition workflow. Both model kinds. */
export function ChangeRequestView({
  model, onAddChangeRequest, onUpdateItem, onDeleteAny,
}: {
  model: ArtifactModel;
  onAddChangeRequest: ArtifactEditing["onAddChangeRequest"];
  onUpdateItem: ArtifactEditing["onUpdateItem"];
  onDeleteAny: ArtifactEditing["onDeleteAny"];
}) {
  const items = model.changeRequests ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow text-muted-foreground">
          Change requests · {items.length}
        </div>
        <Button size="sm" variant="outline" onClick={() => onAddChangeRequest("New change request")}>
          <Plus className="size-3.5" /> Add change request
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No change requests yet. Log a request whenever a requirement or the model itself needs to change after baseline.
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="min-w-[200px]">Rationale</TableHead>
                <TableHead>Disposition</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-start gap-1.5">
                      <IdChip id={c.id} tone="primary" />
                      <InlineEdit value={c.text} onChange={(v) => onUpdateItem(c.id, { text: v })} label={`Description for ${c.id}`} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <SelectBadge<ChangeType> value={c.changeType} options={CHANGE_TYPES} tone={typeTone} label={`Type for ${c.id}`}
                      onChange={(v) => onUpdateItem(c.id, { changeType: v })} />
                  </TableCell>
                  <TableCell>
                    <InlineEdit value={c.rationale} onChange={(v) => onUpdateItem(c.id, { rationale: v })}
                      placeholder="Why is this change needed?" label={`Rationale for ${c.id}`} />
                  </TableCell>
                  <TableCell>
                    <SelectBadge<ChangeDisposition> value={c.disposition} options={CHANGE_DISPOSITIONS} tone={dispositionTone} label={`Disposition for ${c.id}`}
                      onChange={(v) => onUpdateItem(c.id, { disposition: v })} />
                  </TableCell>
                  <TableCell>
                    <button onClick={() => onDeleteAny(c.id)} aria-label={`Delete change request ${c.id}`} className="text-muted-foreground hover:text-destructive transition">
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

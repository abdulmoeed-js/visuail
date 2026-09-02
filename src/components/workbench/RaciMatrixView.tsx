import type { ProcessModel, Step } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IdChip } from "./atoms";

// A RACI matrix is just the Process canvas's existing actors x steps, with a
// code per cell -- no new artifact type, no new axes, reuses what's already
// on the canvas.

type RaciCode = "R" | "A" | "C" | "I";
const CODES: { code: RaciCode; label: string }[] = [
  { code: "R", label: "Responsible" },
  { code: "A", label: "Accountable" },
  { code: "C", label: "Consulted" },
  { code: "I", label: "Informed" },
];

const CODE_TONE: Record<RaciCode, string> = {
  R: "border-confident/40 bg-confident/10 text-[color:var(--confident)]",
  A: "border-primary/40 bg-primary/10 text-primary",
  C: "border-unresolved bg-unresolved/15 text-[color:var(--unresolved-foreground)]",
  I: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

export function RaciMatrixView({
  model, onUpdateItem,
}: {
  model: ProcessModel;
  onUpdateItem: ArtifactEditing["onUpdateItem"];
}) {
  const setCell = (step: Step, actorId: string, code: RaciCode | null) => {
    const next = { ...step.raci };
    if (code) next[actorId] = code; else delete next[actorId];
    onUpdateItem(step.id, { raci: next });
  };

  if (model.actors.length === 0 || model.steps.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Add actors and steps on the Process map to build a RACI matrix here.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="min-w-[260px]">Step</TableHead>
            {model.actors.map((a) => (
              <TableHead key={a.id} className="text-center min-w-[110px]">
                <div className="truncate">{a.text}</div>
                <IdChip id={a.id} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.steps.map((step) => (
            <TableRow key={step.id}>
              <TableCell className="align-top">
                <div className="flex items-start gap-1.5">
                  <IdChip id={step.id} tone="primary" />
                  <span>{step.text}</span>
                </div>
              </TableCell>
              {model.actors.map((actor) => (
                <TableCell key={actor.id} className="text-center">
                  <RaciCell
                    code={step.raci?.[actor.id] as RaciCode | undefined}
                    onSet={(code) => setCell(step, actor.id, code)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RaciCell({ code, onSet }: { code: RaciCode | undefined; onSet: (code: RaciCode | null) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md border text-xs font-mono-tight font-semibold transition-colors hover:opacity-80",
            code ? CODE_TONE[code] : "border-dashed text-muted-foreground",
          )}
          title={code ?? "Set RACI code"}
        >
          {code ?? "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1.5" align="center">
        <div className="grid grid-cols-2 gap-1">
          {CODES.map(({ code: c, label }) => (
            <button
              key={c}
              type="button"
              onClick={() => onSet(c)}
              title={label}
              className={cn(
                "rounded-md border px-2 py-1.5 text-xs font-mono-tight font-semibold hover:opacity-80",
                CODE_TONE[c],
              )}
            >
              {c}
            </button>
          ))}
        </div>
        {code && (
          <button
            type="button"
            onClick={() => onSet(null)}
            className="mt-1.5 w-full rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

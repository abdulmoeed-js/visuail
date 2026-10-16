import { useMemo, useState } from "react";
import { Search, Plus, ChevronRight, AlertTriangle, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import type { ArtifactModel } from "@/data/samples";
import type { StoredCanvas, ViewKind } from "@/lib/session";
import { summarizeGrades } from "@/lib/grade";
import { cn } from "@/lib/utils";
import { ALL_VIEW_KINDS, VIEW_KIND_META } from "@/lib/view-kind-meta";

interface Props {
  canvases: StoredCanvas[];
  onOpen: (id: string) => void;
  onCreate: (viewKind: ViewKind, name: string) => void;
}

export function ArtifactSidebar({ canvases, onOpen, onCreate }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const byKind = new Map<ViewKind, StoredCanvas[]>();
    for (const vk of ALL_VIEW_KINDS) byKind.set(vk, []);
    for (const c of canvases) {
      const vk = c.viewKind ?? c.kind;
      if (!byKind.has(vk)) byKind.set(vk, []);
      byKind.get(vk)!.push(c);
    }
    return ALL_VIEW_KINDS.map((viewKind) => {
      const items = byKind.get(viewKind) ?? [];
      return { viewKind, items: q ? items.filter((c) => c.name.toLowerCase().includes(q)) : items };
    });
  }, [canvases, q]);

  const nothingFound = q.length > 0 && groups.every((g) => g.items.length === 0);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="relative mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artifacts by name…"
          aria-label="Search artifacts by name"
          className="pl-8 h-9"
        />
      </div>

      {nothingFound && (
        <p className="text-sm text-muted-foreground text-center py-6">No artifacts match "{query}".</p>
      )}

      <div className="space-y-5">
        {groups.map(({ viewKind, items }) => {
          if (q && items.length === 0) return null;
          const meta = VIEW_KIND_META[viewKind];
          const Icon = meta.icon;
          return (
            <div key={viewKind}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 eyebrow text-muted-foreground">
                  <Icon className="size-3.5" /> {meta.plural} · {items.length}
                </div>
                <NewInstanceButton viewKind={viewKind} existingCount={items.length} onCreate={onCreate} />
              </div>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">None yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {items.map((c) => <ArtifactRow key={c.id} canvas={c} onOpen={onOpen} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** An artifact's items in words: how many, how many need a look (unclear,
 *  changed in the source, or sources disagree), and how many changed in the
 *  source. Shared by the list rows and the board cards. */
export function ArtifactCounts({ model, className }: { model: ArtifactModel; className?: string }) {
  const s = summarizeGrades(model);
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground", className)}>
      <span>{s.total} {s.total === 1 ? "item" : "items"}</span>
      {s.needsLook > 0 && (
        <span className={cn("inline-flex items-center gap-0.5", s.changed + s.disagree > 0 ? "text-drift-ink" : "text-unresolved-ink")}>
          <CircleHelp className="size-3" aria-hidden /> {s.needsLook} {s.needsLook === 1 ? "needs" : "need"} a look
        </span>
      )}
      {s.changed > 0 && (
        <span className="inline-flex items-center gap-0.5 text-drift-ink">
          <AlertTriangle className="size-3" aria-hidden /> {s.changed} changed in the source
        </span>
      )}
    </span>
  );
}

function ArtifactRow({ canvas, onOpen }: { canvas: StoredCanvas; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(canvas.id)}
      className="w-full flex items-center justify-between gap-3 rounded-lg border bg-background/60 hover:bg-muted/60 transition p-2.5 text-left"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{canvas.name}</div>
        <ArtifactCounts model={canvas.model} className="mt-0.5" />
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </button>
  );
}

export function NewInstanceButton({
  viewKind, existingCount, onCreate, namesKind = false,
}: {
  viewKind: ViewKind; existingCount: number; onCreate: (viewKind: ViewKind, name: string) => void;
  /** Say which kind on the button itself ("New data flow diagram"). Off in
   *  the list, where the group heading above already names it. */
  namesKind?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = VIEW_KIND_META[viewKind];
  const defaultName = existingCount === 0 ? meta.label : `${meta.label} ${existingCount + 1}`;
  const [name, setName] = useState(defaultName);
  const startsEmptyOnly = viewKind === "decisiontree" || viewKind === "statediagram";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setName(defaultName); }}>
      <Button
        size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setOpen(true)}
        aria-label={`New ${meta.noun}`} title={`New ${meta.noun}`}
      >
        <Plus className="size-3" /> {namesKind ? `New ${meta.noun}` : "New"}
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New {meta.noun}</DialogTitle>
          <DialogDescription>
            {startsEmptyOnly
              ? "Always starts empty — add items on the canvas yourself; sources don't fill this one in."
              : "Starts empty — add items on the canvas, or paste a source into this project later."}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(viewKind, name.trim()); setOpen(false); } }}
          placeholder={defaultName}
          aria-label="Artifact name"
        />
        <div className="flex justify-end pt-2">
          <Button disabled={!name.trim()} onClick={() => { onCreate(viewKind, name.trim()); setOpen(false); }}>
            Create artifact
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

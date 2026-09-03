import { useMemo, useState } from "react";
import { Search, Plus, ChevronRight, AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { allItems, stats } from "@/data/samples";
import type { StoredCanvas, ViewKind } from "@/lib/session";
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
                <div className="flex items-center gap-1.5 text-[11px] font-mono-tight uppercase tracking-widest text-muted-foreground">
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

function ArtifactRow({ canvas, onOpen }: { canvas: StoredCanvas; onOpen: (id: string) => void }) {
  const st = stats(canvas.model);
  const drifted = allItems(canvas.model).some((i) => i.drift);
  return (
    <button
      onClick={() => onOpen(canvas.id)}
      className="w-full flex items-center justify-between gap-3 rounded-lg border bg-background/60 hover:bg-muted/60 transition p-2.5 text-left"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{canvas.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span>{st.count} item{st.count === 1 ? "" : "s"}</span>
          {st.unresolved > 0 && (
            <span className="inline-flex items-center gap-0.5 text-drift">
              <ShieldAlert className="size-3" /> {st.unresolved} unresolved
            </span>
          )}
          {drifted && (
            <span className="inline-flex items-center gap-0.5 text-drift">
              <AlertTriangle className="size-3" /> drift
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </button>
  );
}

export function NewInstanceButton({
  viewKind, existingCount, onCreate,
}: {
  viewKind: ViewKind; existingCount: number; onCreate: (viewKind: ViewKind, name: string) => void;
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
        aria-label={`New ${meta.label}`} title={`New ${meta.label}`}
      >
        <Plus className="size-3" /> New
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New {meta.label}</DialogTitle>
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
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

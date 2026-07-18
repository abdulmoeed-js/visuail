import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileDown, Loader2, Workflow, LayoutGrid, Users2, ShieldCheck } from "lucide-react";
import { ArtifactView } from "@/components/Workbench";
import { useArtifactEditing } from "@/lib/artifact-editing";
import { stats, allItems, type ArtifactModel } from "@/data/samples";
import type { ProjectResult } from "./IntakeWizard";
import { exportSectionsToPdf, type ExportSection } from "@/lib/export-pdf";

interface Props {
  project: ProjectResult;
  onPublish: (action: string) => void;
}

interface CanvasPane {
  key: string;
  kind: "process" | "bmc";
  initial: ArtifactModel;
}

export function ProjectView({ project, onPublish }: Props) {
  const panes: CanvasPane[] = useMemo(
    () => project.canvases.map(c => ({ key: c.kind, kind: c.kind, initial: c.model })),
    [project],
  );

  const [active, setActive] = useState(panes[0]?.key ?? "");
  const [exporting, setExporting] = useState(false);
  // Refs per pane's canvas root, keyed by pane.key. Populated as ArtifactView
  // mounts. The combined export snapshots whichever refs exist.
  const paneRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const exportAll = async () => {
    setExporting(true);
    const originalActive = active;
    try {
      const sections: ExportSection[] = panes.map(p => ({
        title: `${project.name} — ${p.kind === "process" ? "Process map" : "Business Model Canvas"}`,
        getElement: async () => {
          setActive(p.key);
          // Two rAFs: React commits, then browser paints the newly visible pane.
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          );
          return paneRefs.current[p.key];
        },
      }));
      const safe = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await exportSectionsToPdf(`${safe || "visuail-project"}.pdf`, sections);
    } catch (e) {
      console.error(e);
      alert("PDF export failed. See console for details.");
    } finally {
      setActive(originalActive);
      setExporting(false);
    }
  };

  // Reconciliation summary — counts confirmed and conflicted items across all canvases.
  const recon = useMemo(() => {
    let confirmed = 0, conflict = 0, total = 0;
    for (const c of project.canvases) {
      const items = allItems(c.model);
      for (const it of items) {
        total++;
        if (it.conflict) conflict++;
        else if ((it.confirmedBySources?.length ?? 0) >= 2) confirmed++;
      }
    }
    return { confirmed, conflict, total };
  }, [project]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Users2 className="size-3.5 text-primary" />
            <span className="font-mono-tight uppercase tracking-widest text-muted-foreground">Sources</span>
            {project.sources.map((s, i) => (
              <span key={i} className="rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">
                {s.label}
              </span>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-3 text-[11px]">
            {recon.confirmed > 0 && (
              <span className="inline-flex items-center gap-1 text-[color:var(--confident)]">
                <ShieldCheck className="size-3.5" /> {recon.confirmed} confirmed by multiple sources
              </span>
            )}
            {recon.conflict > 0 && (
              <span className="inline-flex items-center gap-1 text-drift">
                <ShieldCheck className="size-3.5" /> {recon.conflict} conflicting item{recon.conflict === 1 ? "" : "s"}
              </span>
            )}
            {recon.confirmed === 0 && recon.conflict === 0 && (
              <span className="text-muted-foreground">Single-source project — no reconciliation applied.</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" className="flex items-center gap-1 rounded-md border bg-muted/40 p-1">
            {panes.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => setActive(p.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition",
                  active === p.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.kind === "process"
                  ? <><Workflow className="size-3.5" /> Process map</>
                  : <><LayoutGrid className="size-3.5" /> Business Model Canvas</>}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={exportAll} disabled={exporting}>
            {exporting
              ? <><Loader2 className="size-3.5 animate-spin" /> Building PDF…</>
              : <><FileDown className="size-3.5" /> Export all to PDF</>}
          </Button>
        </div>
      </div>

      {/* Render each pane, keep them all mounted so refs exist for combined export.
          Only the active one is visible. */}
      <div className="relative">
        {panes.map(pane => (
          <CanvasPaneMount
            key={pane.key}
            pane={pane}
            visible={pane.key === active}
            onPublish={onPublish}
            registerRef={(el) => { paneRefs.current[pane.key] = el; }}
          />
        ))}
      </div>
    </div>
  );
}

function CanvasPaneMount({
  pane, visible, onPublish, registerRef,
}: {
  pane: CanvasPane;
  visible: boolean;
  onPublish: (action: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  const editing = useArtifactEditing(pane.initial);
  const st = stats(editing.model);
  const rootRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      className={cn("rounded-xl border bg-card min-h-[560px] flex flex-col", !visible && "hidden")}
      ref={(el) => { rootRef.current = el; registerRef(el); }}
    >
      <ArtifactView editing={editing} stats={st} onPublish={onPublish} />
    </div>
  );
}

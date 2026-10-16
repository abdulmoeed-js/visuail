import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { cn } from "@/lib/utils";
import { FileDown, Loader2, Workflow, LayoutGrid, Users2, CheckCheck, Split } from "lucide-react";
import { ArtifactView } from "@/components/Workbench";
import { useArtifactEditing } from "@/lib/artifact-editing";
import type { ArtifactModel } from "@/data/samples";
import type { ProjectResult } from "./IntakeWizard";
import { exportSectionsToPdf, type ExportSection } from "@/lib/export-pdf";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";
import { addSummaries, summarizeGrades } from "@/lib/grade";

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
  const [exportError, setExportError] = useState<FriendlyError | null>(null);
  // Refs per pane's canvas root, keyed by pane.key. Populated as ArtifactView
  // mounts. The combined export snapshots whichever refs exist.
  const paneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Each pane's current model (with any edits), so the PDF grades what is
  // on screen rather than what was first loaded.
  const paneModels = useRef<Record<string, ArtifactModel>>({});

  const exportAll = async () => {
    setExportError(null);
    setExporting(true);
    const originalActive = active;
    try {
      const sections: ExportSection[] = panes.map(p => ({
        title: `${project.name} — ${p.kind === "process" ? "Process map" : "Business Model Canvas"}`,
        summary: summarizeGrades(paneModels.current[p.key] ?? p.initial),
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
      const fe = friendlyError(e, "create the PDF");
      setExportError(fe.kind === "unknown" ? { ...fe, detail: "Your diagrams are safe. Try again in a moment." } : fe);
    } finally {
      setActive(originalActive);
      setExporting(false);
    }
  };

  // How the sources line up across every canvas, graded the same way as each
  // item's chip.
  const recon = useMemo(
    () => addSummaries(project.canvases.map((c) => summarizeGrades(c.model))),
    [project],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Users2 className="size-3.5 text-primary" />
            <span className="eyebrow text-muted-foreground">Sources</span>
            {project.sources.map((s, i) => (
              <span key={i} className="rounded-md border bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono-tight">
                {s.label}
              </span>
            ))}
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-3 text-[11px]">
            {recon.confirmed > 0 && (
              <span className="inline-flex items-center gap-1 text-confident-ink">
                <CheckCheck className="size-3.5" aria-hidden /> {recon.confirmed} confirmed by 2 or more sources
              </span>
            )}
            {recon.disagree > 0 && (
              <span className="inline-flex items-center gap-1 text-drift-ink">
                <Split className="size-3.5" aria-hidden /> {recon.disagree} where sources disagree
              </span>
            )}
            {recon.confirmed === 0 && recon.disagree === 0 && (
              <span className="text-muted-foreground">
                {project.sources.length === 1
                  ? "One source only, so nothing to cross-check"
                  : "Each item comes from one source"}
              </span>
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

      <InlineError error={exportError} onRetry={exportAll} />

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
            onModel={(m) => { paneModels.current[pane.key] = m; }}
          />
        ))}
      </div>
    </div>
  );
}

function CanvasPaneMount({
  pane, visible, onPublish, registerRef, onModel,
}: {
  pane: CanvasPane;
  visible: boolean;
  onPublish: (action: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onModel: (m: ArtifactModel) => void;
}) {
  const editing = useArtifactEditing(pane.initial);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onModelRef = useRef(onModel);
  useEffect(() => { onModelRef.current = onModel; });
  useEffect(() => { onModelRef.current(editing.model); }, [editing.model]);
  return (
    <div
      className={cn("rounded-xl border bg-card min-h-[560px] flex flex-col", !visible && "hidden")}
      ref={(el) => { rootRef.current = el; registerRef(el); }}
    >
      <ArtifactView editing={editing} onPublish={onPublish} />
    </div>
  );
}

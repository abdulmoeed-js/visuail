import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/components/Nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, FileDown, Loader2, Workflow, LayoutGrid, Users2,
  ShieldCheck, Plus, AlertTriangle,
} from "lucide-react";
import { ArtifactView } from "@/components/Workbench";
import { useArtifactEditing } from "@/lib/artifact-editing";
import { stats, allItems, type ArtifactModel } from "@/data/samples";
import { exportSectionsToPdf, type ExportSection } from "@/lib/export-pdf";
import { sessionStore, useSession, type StoredProject } from "@/lib/session";
import { SignupWallModal } from "@/components/SignupWallModal";
import { SourceIntake, makeSource, type SourceDraft } from "@/components/workbench/SourceIntake";
import { extractFromSource, type ArtifactKind } from "@/lib/extract";
import { mergeByKind } from "@/lib/merge";
import { checkRefusal } from "@/lib/refusal";

export const Route = createFileRoute("/project/$id")({
  head: () => ({
    meta: [
      { title: "Project — Visuail" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectPage,
});

function ProjectPage() {
  const { id } = Route.useParams();
  const session = useSession();
  const project = useMemo(() => session.projects.find(p => p.id === id), [session, id]);

  if (session.loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="mx-auto max-w-3xl px-4 pt-24 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="mx-auto max-w-3xl px-4 pt-16 text-center">
          <h1 className="font-display text-3xl">Project not found</h1>
          <p className="text-muted-foreground mt-2">
            {session.signedIn
              ? "It may have been deleted, or belongs to a different account."
              : "Sign in to see your projects."}
          </p>
          <Link to="/dashboard" className="inline-block mt-6">
            <Button><ArrowLeft className="size-4" /> Back to dashboard</Button>
          </Link>
        </main>
      </div>
    );
  }

  return <ProjectShell project={project} />;
}

interface CanvasPane { key: string; kind: ArtifactKind; initial: ArtifactModel; }

function ProjectShell({ project }: { project: StoredProject }) {
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupAction, setSignupAction] = useState("Export");
  const panes: CanvasPane[] = useMemo(
    () => project.canvases.map(c => ({ key: c.kind, kind: c.kind, initial: c.model })),
    [project.id],
  );
  const [active, setActive] = useState(panes[0]?.key ?? "");
  const [exporting, setExporting] = useState(false);
  const paneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editingModelsRef = useRef<Record<string, ArtifactModel>>({});

  // Persist canvas edits back to the stored project. Fires on every edit, so
  // this goes through the debounced writer -- one network write per pause in
  // typing/dragging, not one per keystroke.
  const registerModel = useCallback((key: string, model: ArtifactModel) => {
    editingModelsRef.current[key] = model;
  }, []);
  const persist = useCallback(() => {
    const merged = panes.map(p => ({
      kind: p.kind,
      model: editingModelsRef.current[p.key] ?? p.initial,
    }));
    sessionStore.updateProjectDebounced(project.id, { canvases: merged });
  }, [panes, project.id]);

  const onPublish = (action: string) => {
    setSignupAction(action);
    setSignupOpen(true);
  };

  const exportAll = async () => {
    if (project.canvases.length === 0) return;
    setExporting(true);
    const originalActive = active;
    try {
      const sections: ExportSection[] = panes.map(p => ({
        title: `${project.name} — ${p.kind === "process" ? "Process map" : "Business Model Canvas"}`,
        getElement: async () => {
          setActive(p.key);
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          );
          return paneRefs.current[p.key];
        },
      }));
      const safe = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await exportSectionsToPdf(`${safe || "visuail-project"}.pdf`, sections);
    } catch (e) {
      console.error(e); alert("PDF export failed. See console for details.");
    } finally {
      setActive(originalActive); setExporting(false);
    }
  };

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
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div className="min-w-0">
            <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> Dashboard
            </Link>
            <h1 className="font-display text-2xl md:text-3xl mt-1 truncate">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <AddSourceDialog project={project} />
            <Button size="sm" onClick={exportAll} disabled={exporting || panes.length === 0}>
              {exporting
                ? <><Loader2 className="size-3.5 animate-spin" /> Building PDF…</>
                : <><FileDown className="size-3.5" /> Export all to PDF</>}
            </Button>
          </div>
        </div>

        {panes.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/60 p-12 text-center bp-grid-fine">
            <h2 className="font-display text-xl">This project has no canvases yet.</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Add a source to extract, or an artifact type to start from scratch.
            </p>
            <div className="mt-4"><AddSourceDialog project={project} /></div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <Users2 className="size-3.5 text-primary" />
                  <span className="font-mono-tight uppercase tracking-widest text-muted-foreground">Sources</span>
                  {project.sources.length === 0 ? (
                    <span className="text-muted-foreground italic">none — started from scratch</span>
                  ) : project.sources.map((s, i) => (
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
              <div role="tablist" className="flex items-center gap-1 rounded-md border bg-muted/40 p-1">
                {panes.map(p => (
                  <button
                    key={p.key} type="button" onClick={() => setActive(p.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition",
                      active === p.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.kind === "process"
                      ? <><Workflow className="size-3.5" /> Process map</>
                      : <><LayoutGrid className="size-3.5" /> Business Model Canvas</>}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              {panes.map(pane => (
                <CanvasPaneMount
                  key={pane.key}
                  pane={pane}
                  visible={pane.key === active}
                  onPublish={onPublish}
                  registerRef={(el) => { paneRefs.current[pane.key] = el; }}
                  onModelChange={(m) => { registerModel(pane.key, m); persist(); }}
                />
              ))}
            </div>
          </>
        )}
      </main>
      <SignupWallModal open={signupOpen} onOpenChange={setSignupOpen} action={signupAction} />
    </div>
  );
}

function CanvasPaneMount({
  pane, visible, onPublish, registerRef, onModelChange,
}: {
  pane: CanvasPane; visible: boolean;
  onPublish: (action: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  onModelChange: (m: ArtifactModel) => void;
}) {
  const editing = useArtifactEditing(pane.initial);
  const st = stats(editing.model);
  const changeRef = useRef(onModelChange);
  useEffect(() => { changeRef.current = onModelChange; });
  const lastModelRef = useRef<ArtifactModel | null>(null);
  useEffect(() => {
    if (lastModelRef.current === editing.model) return;
    lastModelRef.current = editing.model;
    changeRef.current(editing.model);
  }, [editing.model]);
  return (
    <div
      className={cn("rounded-xl border bg-card min-h-[560px] flex flex-col", !visible && "hidden")}
      ref={(el) => { registerRef(el); }}
    >
      <ArtifactView editing={editing} stats={st} onPublish={onPublish} />
    </div>
  );
}

function AddSourceDialog({ project }: { project: StoredProject }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceDraft[]>([makeSource(0)]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const ready = sources.filter(s => s.status === "ready" && s.text.trim().length > 0);

  const apply = async () => {
    setBusy(true);

    const newStored = ready.map(s => ({
      label: s.label, text: s.text, origin: s.origin, filename: s.filename,
    }));
    const allSources = [...project.sources, ...newStored];

    // Re-run extraction across the full source list per kind, then merge.
    // This regenerates the canvases and preserves reconciliation; note it will
    // overwrite manual canvas edits made after the last source-based generation.
    let perSource: { label: string; results: Awaited<ReturnType<typeof extractFromSource>> }[];
    try {
      perSource = await Promise.all(allSources.map(async (s, i) => ({
        label: s.label,
        results: await extractFromSource({ label: s.label, text: s.text, index: i }, project.kinds),
      })));
    } catch (err) {
      setBusy(false);
      alert(err instanceof Error ? err.message : "Extraction failed. Try again.");
      return;
    }
    const canvases: { kind: ArtifactKind; model: ArtifactModel }[] = [];
    for (const kind of project.kinds) {
      const models: ArtifactModel[] = [];
      const labels: string[] = [];
      for (const { label, results } of perSource) {
        const hit = results.find(r => r.kind === kind);
        if (hit) { models.push(hit.model); labels.push(label); }
      }
      if (models.length === 0) continue;
      const merged = mergeByKind(models, labels);
      if (!merged) continue;
      if (checkRefusal(merged).refuse) continue;
      canvases.push({ kind, model: merged });
    }
    // Preserve any existing canvas whose kind didn't get produced by extraction.
    for (const existing of project.canvases) {
      if (!canvases.find(c => c.kind === existing.kind)) canvases.push(existing);
    }

    try {
      await sessionStore.updateProject(project.id, {
        sources: allSources,
        canvases,
        fromScratch: false,
      });
    } catch (err) {
      setBusy(false);
      alert(err instanceof Error ? err.message : "Couldn't save the new source. Try again.");
      return;
    }
    setBusy(false);
    setOpen(false);
    // Force full remount so the ProjectShell picks up regenerated canvases.
    navigate({ to: "/project/$id", params: { id: project.id }, replace: true });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setSources([makeSource(0)]); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="size-3.5" /> Add source</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a source to this project</DialogTitle>
          <DialogDescription>
            Paste a transcript or upload a .pdf / .docx. Visuail will re-extract across all
            sources and reconcile matching items — bumping confidence when sources agree and
            flagging conflicts when they don't.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-drift/30 bg-drift/[0.06] p-2.5 text-[11px] flex items-start gap-2">
          <AlertTriangle className="size-3.5 text-drift shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            Adding a source regenerates the canvases from all sources. Manual edits to the current canvas will be replaced.
          </span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto pr-1">
          <SourceIntake sources={sources} onChange={setSources} />
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-[11px] text-muted-foreground">
            {ready.length} new source{ready.length === 1 ? "" : "s"} ready
          </span>
          <Button disabled={ready.length === 0 || busy} onClick={apply}>
            {busy
              ? <><Loader2 className="size-4 animate-spin" /> Reconciling…</>
              : <>Add & reconcile</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

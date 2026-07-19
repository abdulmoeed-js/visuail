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
  ShieldCheck, Plus, AlertTriangle, History, RotateCcw, Clock, ImageDown,
} from "lucide-react";
import { ArtifactView } from "@/components/Workbench";
import { useArtifactEditing } from "@/lib/artifact-editing";
import { stats, allItems, type ArtifactModel } from "@/data/samples";
import { exportSectionsToPdf, exportElementToPng, exportElementToSvg, type ExportSection } from "@/lib/export-pdf";
import {
  sessionStore, useSession, type StoredProject, type SnapshotSummary, type SnapshotTrigger,
} from "@/lib/session";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { CommentsDialog } from "@/components/CommentsDialog";
import { ShareLinkDialog } from "@/components/ShareLinkDialog";
import { SignupWallModal } from "@/components/SignupWallModal";
import { SourceIntake, makeSource, type SourceDraft } from "@/components/workbench/SourceIntake";
import { extractFromSource, type ArtifactKind } from "@/lib/extract";
import { mergeByKind } from "@/lib/merge";
import { checkRefusal } from "@/lib/refusal";
import { diffModels } from "@/lib/diff";
import { DriftNotifier } from "@/components/workbench/DriftNotifier";
import { buildAuditTrail, type AuditEvent } from "@/lib/audit";

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
  const project = session.projects.find(p => p.id === id);

  // Gate the spinner on "loading AND no project yet" rather than "loading"
  // alone -- session.loading also flips true->false on every background
  // refetch (e.g. after an autosave's `notify()`), and once we already have
  // a project to show, tearing the canvas down and remounting it on every
  // such refetch would itself re-trigger the canvas's mount-time save,
  // causing another refetch: a self-sustaining reload loop.
  if (session.loading && !project) {
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

/** Scans every canvas for items flagged `drift: true` by diffModels(). Derived
 *  fresh from stored data on every render rather than kept in local state, so
 *  it survives the remount recheckDrift() triggers after saving. */
function collectDrift(canvases: StoredProject["canvases"]): { drifted: boolean; driftedNames: string[] } {
  const names: string[] = [];
  for (const c of canvases) {
    for (const item of allItems(c.model)) {
      if (item.drift) names.push(item.text);
    }
  }
  return { drifted: names.length > 0, driftedNames: names };
}

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

  const session = useSession();
  const [savingVersion, setSavingVersion] = useState(false);
  const saveVersion = async () => {
    if (!session.userId) return;
    setSavingVersion(true);
    const merged = panes.map(p => ({
      kind: p.kind,
      model: editingModelsRef.current[p.key] ?? p.initial,
    }));
    try {
      await sessionStore.saveSnapshot(project.id, merged, "manual_save", session.userId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't save this version. Try again.");
    } finally {
      setSavingVersion(false);
    }
  };

  const navigateDrift = useNavigate();
  const [checkingDrift, setCheckingDrift] = useState(false);
  const recheckDrift = async () => {
    if (!session.userId || project.sources.length === 0) return;
    setCheckingDrift(true);
    try {
      // Re-extract from the same stored sources. Real LLM calls aren't
      // perfectly deterministic, so a re-check on genuinely unchanged text
      // can occasionally surface trivial rephrasing as "drift" -- that's an
      // honest limitation of re-checking via re-extraction rather than a bug
      // to paper over, and it's also useful diagnostic signal on its own.
      const perSource = await Promise.all(project.sources.map(async (s, i) => ({
        label: s.label,
        results: await extractFromSource({ label: s.label, text: s.text, index: i }, project.kinds),
      })));

      const latest = await sessionStore.listSnapshots(project.id);
      const baseline = latest.length > 0 ? await sessionStore.getSnapshotCanvases(latest[0].id) : project.canvases;

      const nextCanvases: { kind: ArtifactKind; model: ArtifactModel }[] = [];
      for (const kind of project.kinds) {
        const freshModels: ArtifactModel[] = [];
        const freshLabels: string[] = [];
        for (const { label, results } of perSource) {
          const hit = results.find(r => r.kind === kind);
          if (hit) { freshModels.push(hit.model); freshLabels.push(label); }
        }
        if (freshModels.length === 0) continue;
        const fresh = mergeByKind(freshModels, freshLabels);
        if (!fresh || checkRefusal(fresh).refuse) continue;

        // Current (possibly hand-edited) canvas goes FIRST so mergeByKind
        // keeps it as canonical text and flags any real discrepancy from
        // the fresh re-check as a conflict, rather than silently
        // overwriting a manual edit -- same reconciliation logic already
        // used to merge multiple sources, just applied to "live state" vs
        // "re-checked state" as the two inputs.
        const currentModel = editingModelsRef.current[kind] ?? panes.find(p => p.kind === kind)?.initial;
        const reconciled = currentModel ? mergeByKind([currentModel, fresh], ["Current", "Re-checked source"]) : fresh;
        if (!reconciled) continue;

        const baselineModel = baseline.find(c => c.kind === kind)?.model;
        const withDrift = baselineModel ? diffModels(baselineModel, reconciled) : reconciled;
        nextCanvases.push({ kind, model: withDrift });
      }
      // Preserve any canvas kind the re-check didn't produce anything for.
      for (const existing of project.canvases) {
        if (!nextCanvases.find(c => c.kind === existing.kind)) nextCanvases.push(existing);
      }

      await sessionStore.updateProject(project.id, { canvases: nextCanvases });
      await sessionStore.saveSnapshot(project.id, nextCanvases, "drift_recheck", session.userId);
      navigateDrift({ to: "/project/$id", params: { id: project.id }, replace: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't re-check for drift. Try again.");
    } finally {
      setCheckingDrift(false);
    }
  };

  const [shareOpen, setShareOpen] = useState(false);
  const onPublish = (action: string) => {
    // Both real capabilities now exist for this (signed-in, real-data) page
    // -- route to them directly instead of the generic sign-up wall, which
    // this component only still uses for actions that genuinely have
    // nothing built behind them yet.
    if (action === "Share link") { setShareOpen(true); return; }
    if (action === "Export") { exportAll(); return; }
    setSignupAction(action);
    setSignupOpen(true);
  };

  const [exportingImage, setExportingImage] = useState(false);
  const exportActiveImage = async (format: "png" | "svg") => {
    const el = paneRefs.current[active];
    if (!el) return;
    setExportingImage(true);
    const safe = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const activeKind = panes.find(p => p.key === active)?.kind;
    const suffix = activeKind === "process" ? "process-map" : "bmc";
    try {
      if (format === "png") await exportElementToPng(`${safe || "visuail"}-${suffix}.png`, el);
      else await exportElementToSvg(`${safe || "visuail"}-${suffix}.svg`, el);
    } catch (e) {
      console.error(e); alert(`${format.toUpperCase()} export failed. See console for details.`);
    } finally {
      setExportingImage(false);
    }
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

  const driftInfo = useMemo(() => collectDrift(project.canvases), [project]);

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
            <DriftNotifier
              drifted={driftInfo.drifted} driftedNames={driftInfo.driftedNames}
              artifactTitle={project.name}
            />
            <Button
              size="sm" variant="outline" onClick={recheckDrift}
              disabled={checkingDrift || project.sources.length === 0}
              title={project.sources.length === 0 ? "No sources to re-check against" : undefined}
            >
              {checkingDrift
                ? <><Loader2 className="size-3.5 animate-spin" /> Re-checking…</>
                : <><AlertTriangle className="size-3.5" /> Re-check for drift</>}
            </Button>
            <AddSourceDialog project={project} />
            <CommentsDialog projectId={project.id} />
            <VersionHistoryDialog project={project} />
            <Button size="sm" variant="outline" onClick={saveVersion} disabled={savingVersion || panes.length === 0}>
              {savingVersion
                ? <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
                : <><History className="size-3.5" /> Save version</>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={exportingImage || panes.length === 0}>
                  {exportingImage
                    ? <><Loader2 className="size-3.5 animate-spin" /> Exporting…</>
                    : <><ImageDown className="size-3.5" /> Export this canvas</>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportActiveImage("png")}>PNG</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportActiveImage("svg")}>SVG (vector)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      <ShareLinkDialog open={shareOpen} onOpenChange={setShareOpen} projectId={project.id} />
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

const TRIGGER_LABEL: Record<SnapshotTrigger, string> = {
  manual_save: "Saved version",
  source_added: "Source added",
  drift_recheck: "Drift re-check",
  manual_edit: "Edited",
};

function fmtVersionTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function VersionHistoryDialog({ project }: { project: StoredProject }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"versions" | "activity">("versions");
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const navigate = useNavigate();
  const session = useSession();

  const load = () => {
    setLoading(true);
    Promise.all([
      sessionStore.listSnapshots(project.id),
      sessionStore.listSnapshotsWithCanvases(project.id).then(buildAuditTrail),
    ])
      .then(([s, e]) => { setSnapshots(s); setEvents(e); })
      .catch(() => { setSnapshots([]); setEvents([]); })
      .finally(() => setLoading(false));
  };

  const restore = async (snapshotId: string) => {
    if (!confirm("Restore this version? Your current canvases will be replaced -- this itself is saved as a new version first, so nothing is lost.")) return;
    setRestoringId(snapshotId);
    try {
      const canvases = await sessionStore.getSnapshotCanvases(snapshotId);
      await sessionStore.updateProject(project.id, { canvases });
      if (session.userId) {
        await sessionStore.saveSnapshot(project.id, canvases, "manual_save", session.userId);
      }
      setOpen(false);
      navigate({ to: "/project/$id", params: { id: project.id }, replace: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't restore this version. Try again.");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><History className="size-3.5" /> History</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tab === "versions" ? "Version history" : "Activity"}</DialogTitle>
          <DialogDescription>
            {tab === "versions"
              ? "Checkpoints from project creation, re-extraction, and manual saves. Restoring keeps what you had before as its own version too."
              : "Per-item changes between checkpoints, derived from the same versions."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-md border bg-muted/40 p-0.5 w-fit">
          <button
            onClick={() => setTab("versions")}
            className={cn("px-2.5 py-1 rounded text-xs font-medium transition", tab === "versions" ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            Versions
          </button>
          <button
            onClick={() => setTab("activity")}
            className={cn("px-2.5 py-1 rounded text-xs font-medium transition", tab === "activity" ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            Activity
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : tab === "versions" ? (
          snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No versions saved yet.</p>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto space-y-1.5">
              {snapshots.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Clock className="size-3.5 text-muted-foreground shrink-0" />
                      {TRIGGER_LABEL[s.trigger]}
                      {i === 0 && <span className="text-[10px] font-mono-tight uppercase text-muted-foreground">latest</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {fmtVersionTime(s.createdAt)}{s.createdByEmail ? ` · ${s.createdByEmail}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="ghost" disabled={restoringId === s.id}
                    onClick={() => restore(s.id)}
                  >
                    {restoringId === s.id
                      ? <Loader2 className="size-3.5 animate-spin" />
                      : <><RotateCcw className="size-3.5" /> Restore</>}
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No activity yet.</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {events.map((e, i) => (
              <div key={i} className="text-sm border-b pb-2 last:border-0">
                <p className="text-foreground/90">{e.description}</p>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {fmtVersionTime(e.timestamp)} · {TRIGGER_LABEL[e.trigger]}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddSourceDialog({ project }: { project: StoredProject }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceDraft[]>([makeSource(0)]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const session = useSession();

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
      if (canvases.length > 0 && session.userId) {
        // Best-effort -- a missed snapshot isn't worth blocking the save over.
        sessionStore.saveSnapshot(project.id, canvases, "source_added", session.userId).catch(() => {});
      }
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

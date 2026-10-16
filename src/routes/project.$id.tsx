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
  ArrowLeft, FileDown, Loader2, Users2,
  ShieldCheck, Plus, AlertTriangle, History, RotateCcw, Clock, ImageDown,
} from "lucide-react";
import { ArtifactView, tabForViewKind, type ArtifactTab } from "@/components/Workbench";
import { useArtifactEditing } from "@/lib/artifact-editing";
import { stats, allItems, type ArtifactModel } from "@/data/samples";
import { exportSectionsToPdf, exportElementToPng, exportElementToSvg, type ExportSection } from "@/lib/export-pdf";
import {
  sessionStore, useSession, defaultCanvasName, type StoredProject, type StoredCanvas, type ViewKind,
  type SnapshotSummary, type SnapshotTrigger, type DriftAlert,
} from "@/lib/session";
import { emptyCanvas } from "@/lib/empty-models";
import { ArtifactSidebar } from "@/components/workbench/ArtifactSidebar";
import { ArtifactBoard } from "@/components/workbench/ArtifactBoard";
import { underlyingKind } from "@/lib/view-kind-meta";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { CommentsDialog } from "@/components/CommentsDialog";
import { ShareLinkDialog } from "@/components/ShareLinkDialog";
import { SignupWallModal } from "@/components/SignupWallModal";
import { SourceIntake, makeSource, type SourceDraft } from "@/components/workbench/SourceIntake";
import { extractFromSource, extractSources, type ArtifactKind } from "@/lib/extract";
import { mergeByKind } from "@/lib/merge";
import { checkRefusal } from "@/lib/refusal";
import { diffModels } from "@/lib/diff";
import { DriftNotifier } from "@/components/workbench/DriftNotifier";
import { buildAuditTrail, type AuditEvent } from "@/lib/audit";
import { useProjectPresence } from "@/lib/presence";
import type { Peer } from "@/lib/artifact-channel";
import { toast } from "sonner";

export const Route = createFileRoute("/project/$id")({
  head: () => ({
    meta: [
      { title: "Project — visu" },
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
      <div className="min-h-screen text-foreground">
        <Nav />
        <main className="mx-auto max-w-3xl px-4 pt-24 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen text-foreground">
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

type Frame = { x: number; y: number; w: number; h: number };
interface CanvasPane { key: string; id: string; name: string; kind: ArtifactKind; viewKind?: ViewKind; initial: ArtifactModel; frame?: Frame; }

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

/** Source-based operations (Add source, Re-check drift) only know "kind",
 *  not which specific named instance to update -- and now that a DFD or RACI
 *  instance can share `kind: "process"` with a plain Process Map, "the first
 *  canvas of this kind" is no longer a safe way to find it. This only ever
 *  targets the PLAIN (non-flavored) instance of a kind, falling back to a
 *  lone flavored instance if that's genuinely the only one of its kind (so a
 *  DFD-only project still benefits from re-extraction), and skipping the
 *  kind entirely rather than guessing when it's ambiguous (2+ flavored
 *  instances, no plain one). Only creates a brand new plain instance in the
 *  true bootstrap case -- zero canvases of that kind exist anywhere yet. */
function pickPrimaryInstance(
  canvases: StoredCanvas[], kind: ArtifactKind,
): { action: "update"; canvas: StoredCanvas } | { action: "create" } | { action: "skip" } {
  const ofKind = canvases.filter(c => c.kind === kind);
  if (ofKind.length === 0) return { action: "create" };
  const plain = ofKind.find(c => c.viewKind === undefined || c.viewKind === kind);
  if (plain) return { action: "update", canvas: plain };
  return ofKind.length === 1 ? { action: "update", canvas: ofKind[0] } : { action: "skip" };
}

function ProjectShell({ project }: { project: StoredProject }) {
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupAction, setSignupAction] = useState("Export");
  // Regenerating canvases (add-source, drift re-check) writes straight to
  // Postgres and only reaches this component again via the session's own
  // background refetch -- which, even once it lands, wouldn't change
  // anything here, since neither `panes` nor CanvasPaneMount's `key` were
  // tied to canvas content. Both call sites used to paper over that with a
  // same-URL navigate({replace:true}), hoping it would force a remount --
  // it doesn't reliably (same path/params rarely triggers a real unmount),
  // which is exactly why extraction could succeed and save correctly while
  // the canvas on screen kept showing stale (sometimes empty) data.
  // canvasVersion is bumped ONLY by those two explicit actions -- never by
  // routine autosave/background refetch -- so this can't reintroduce the
  // reload loop the original project.id-only memo was guarding against.
  const [canvasOverride, setCanvasOverride] = useState<StoredProject["canvases"] | null>(null);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const onCanvasesRegenerated = useCallback((canvases: StoredProject["canvases"]) => {
    setCanvasOverride(canvases);
    setCanvasVersion(v => v + 1);
  }, []);
  const panes: CanvasPane[] = useMemo(
    () => (canvasOverride ?? project.canvases).map(c => (
      { key: c.id, id: c.id, name: c.name, kind: c.kind, viewKind: c.viewKind, initial: c.model, frame: c.frame }
    )),
    [project.id, canvasOverride],
  );
  // null = showing the sidebar/board hub rather than a specific canvas. Always
  // starts here -- opening a project should always let you choose which
  // artifact to work in, never assume one for you, even when there's only one.
  const [active, setActive] = useState<string | null>(null);
  const [boardView, setBoardView] = useState<"sidebar" | "board">("sidebar");
  // One editor per artifact. This tab is told apart from the same person's
  // other tabs by an id that lives as long as the page; each pane works out
  // who edits it from the tabs that have it open (see useArtifactEditing).
  const tabIdRef = useRef<string | null>(null);
  if (tabIdRef.current === null) tabIdRef.current = Math.random().toString(36).slice(2, 10);
  const tabId = tabIdRef.current;
  const openArtifact = useCallback((key: string | null) => { setActive(key); }, []);
  // Who edits each artifact, as reported by its pane (another tab's editor
  // matters even for an artifact this tab is not looking at).
  const [paneEditors, setPaneEditors] = useState<Record<string, Peer | null>>({});
  const onEditorChange = useCallback((key: string, editor: Peer | null) => {
    setPaneEditors((cur) => (cur[key] === editor ? cur : { ...cur, [key]: editor }));
  }, []);

  // Arriving from the dashboard's comments inbox: jump to whichever pane
  // actually contains the linked item and hand it down so that pane opens
  // the right thread. Cleared once panes has a chance to render with it, so
  // switching tabs afterward doesn't keep re-scrolling/re-opening.
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get("focusItem");
    if (!itemId) return;
    window.history.replaceState(null, "", window.location.pathname);
    const pane = panes.find((p) => allItems(p.initial).some((i) => i.id === itemId));
    if (!pane) return;
    openArtifact(pane.key);
    setFocusItemId(itemId);
    // Runs once panes are actually populated, not on every panes identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.length > 0]);
  const [exporting, setExporting] = useState(false);
  // "Export all" shows each pane in turn to photograph it. That is not the
  // person opening an artifact, so it must not touch `active` (which drives
  // presence and the editor rule); it only changes which pane is visible.
  const [exportPane, setExportPane] = useState<string | null>(null);
  const paneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editingModelsRef = useRef<Record<string, ArtifactModel>>({});
  const frameOverridesRef = useRef<Record<string, Frame>>({});

  // Persist canvas edits back to the stored project. Fires on every edit, so
  // this goes through the debounced writer -- one network write per pause in
  // typing/dragging, not one per keystroke.
  const registerModel = useCallback((key: string, model: ArtifactModel) => {
    editingModelsRef.current[key] = model;
  }, []);

  const buildMergedCanvases = useCallback((): StoredCanvas[] => panes.map(p => ({
    id: p.id, name: p.name, kind: p.kind, viewKind: p.viewKind,
    model: editingModelsRef.current[p.key] ?? p.initial,
    frame: frameOverridesRef.current[p.id] ?? p.frame,
  })), [panes]);
  // Each tab saves only the artifact it is editing (and, from the board, the
  // frame it dragged). Writing every artifact in one go rewrote the others
  // from this tab's copy, which could be stale when someone else was editing.
  const persistPane = useCallback((pane: CanvasPane, model: ArtifactModel) => {
    sessionStore.updateCanvasDebounced(project.id, pane.id, { model });
  }, [project.id]);
  const onFrameChange = useCallback((id: string, frame: Frame) => {
    frameOverridesRef.current[id] = frame;
    sessionStore.updateCanvasDebounced(project.id, id, { frame });
  }, [project.id]);

  const session = useSession();
  const [savingVersion, setSavingVersion] = useState(false);
  const saveVersion = async () => {
    if (!session.userId) return;
    setSavingVersion(true);
    const merged = buildMergedCanvases();
    try {
      await sessionStore.saveSnapshot(project.id, merged, "manual_save", session.userId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't save this version. Try again.");
    } finally {
      setSavingVersion(false);
    }
  };

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
      // First source alone, then the rest -- see extractSources for why.
      const perSource = await extractSources(project.sources, project.kinds);

      const latest = await sessionStore.listSnapshots(project.id);
      const baseline = latest.length > 0 ? await sessionStore.getSnapshotCanvases(latest[0].id) : project.canvases;

      const nextCanvases: StoredCanvas[] = [];
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

        const primary = pickPrimaryInstance(project.canvases, kind);
        if (primary.action === "skip") continue;
        const primaryExisting = primary.action === "update" ? primary.canvas : undefined;
        const primaryPane = primaryExisting ? panes.find(p => p.id === primaryExisting.id) : undefined;

        // Current (possibly hand-edited) canvas goes FIRST so mergeByKind
        // keeps it as canonical text and flags any real discrepancy from
        // the fresh re-check as a conflict, rather than silently
        // overwriting a manual edit -- same reconciliation logic already
        // used to merge multiple sources, just applied to "live state" vs
        // "re-checked state" as the two inputs.
        const currentModel = primaryPane ? (editingModelsRef.current[primaryPane.key] ?? primaryPane.initial) : undefined;
        const reconciled = currentModel ? mergeByKind([currentModel, fresh], ["Current", "Re-checked source"]) : fresh;
        if (!reconciled) continue;

        const baselineModel = (primaryExisting ? baseline.find(c => c.id === primaryExisting.id) : undefined)?.model;
        const withDrift = baselineModel ? diffModels(baselineModel, reconciled) : reconciled;
        nextCanvases.push(primaryExisting
          ? { ...primaryExisting, model: withDrift }
          : { id: crypto.randomUUID(), name: defaultCanvasName(kind), kind, model: withDrift });
      }
      // Preserve every existing canvas the loop above didn't touch -- kinds
      // with no fresh extraction hit, and any additional same-kind instance.
      for (const existing of project.canvases) {
        if (!nextCanvases.find(c => c.id === existing.id)) nextCanvases.push(existing);
      }

      await sessionStore.updateProject(project.id, { canvases: nextCanvases });
      await sessionStore.saveSnapshot(project.id, nextCanvases, "drift_recheck", session.userId);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "drift_recheck", project.id);
      onCanvasesRegenerated(nextCanvases);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't re-check for drift. Try again.");
    } finally {
      setCheckingDrift(false);
    }
  };

  const createInstance = useCallback(async (viewKind: ViewKind, name: string) => {
    if (!session.userId) return;
    const kind = underlyingKind(viewKind);
    const fresh: StoredCanvas = {
      id: crypto.randomUUID(), name, kind, model: emptyCanvas(kind, name),
      viewKind: viewKind !== kind ? viewKind : undefined,
    };
    const next = [...(canvasOverride ?? project.canvases), fresh];
    const patch: Partial<StoredProject> = { canvases: next };
    if (!project.kinds.includes(kind)) patch.kinds = [...project.kinds, kind];
    try {
      await sessionStore.updateProject(project.id, patch);
      sessionStore.saveSnapshot(project.id, next, "manual_save", session.userId).catch(() => {});
      onCanvasesRegenerated(next);
      openArtifact(fresh.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't create this artifact. Try again.");
    }
  }, [canvasOverride, project.canvases, project.kinds, project.id, session.userId, onCanvasesRegenerated, openArtifact]);

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
    const el = active ? paneRefs.current[active] : null;
    if (!el) return;
    setExportingImage(true);
    const safe = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const activeName = panes.find(p => p.key === active)?.name ?? "canvas";
    const suffix = activeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    try {
      if (format === "png") await exportElementToPng(`${safe || "visuail"}-${suffix}.png`, el);
      else await exportElementToSvg(`${safe || "visuail"}-${suffix}.svg`, el);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "export_used", project.id, { format });
    } catch (e) {
      console.error(e); alert(`${format.toUpperCase()} export failed. See console for details.`);
    } finally {
      setExportingImage(false);
    }
  };

  const exportAll = async () => {
    if (project.canvases.length === 0) return;
    setExporting(true);
    try {
      const sections: ExportSection[] = panes.map(p => ({
        title: `${project.name} — ${p.name}`,
        getElement: async () => {
          setExportPane(p.key);
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          );
          return paneRefs.current[p.key];
        },
      }));
      const safe = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await exportSectionsToPdf(`${safe || "visuail-project"}.pdf`, sections);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "export_used", project.id, { format: "pdf" });
    } catch (e) {
      console.error(e); alert("PDF export failed. See console for details.");
    } finally {
      setExportPane(null); setExporting(false);
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

  // Fetched once per project, not per canvas -- item ids are unique across
  // both canvases anyway, and this avoids one query per pane.
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    sessionStore.listCommentCounts(project.id).then(setCommentCounts).catch(() => {});
  }, [project.id]);
  const onCommentCountChange = useCallback((itemId: string, delta: number) => {
    setCommentCounts((cur) => ({ ...cur, [itemId]: Math.max(0, (cur[itemId] ?? 0) + delta) }));
  }, []);

  const presentUsers = useProjectPresence(project.id, session.userId, session.email);
  // Adding a source, re-checking drift and restoring a version rewrite every
  // artifact from the database. While another tab is editing one, it would
  // keep working on its own copy and save that back over the result.
  const blockedReason = useMemo(() => {
    for (const p of panes) {
      const e = paneEditors[p.key];
      if (e && e.tabId !== tabId) return `${peerLabel(e, session.userId)} is editing \u201c${p.name}\u201d. Ask them to leave it first.`;
    }
    return null;
  }, [panes, paneEditors, tabId, session.userId]);

  return (
    <div className="min-h-screen text-foreground">
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {presentUsers.length > 0 && (
              <div className="flex items-center -space-x-2 mr-1" title={presentUsers.map(u => u.email).join(", ")}>
                {presentUsers.slice(0, 4).map((u) => (
                  <div
                    key={u.userId}
                    className="h-7 w-7 rounded-full border-2 border-background bg-primary/15 text-primary text-[11px] font-medium grid place-items-center"
                  >
                    {u.email.slice(0, 1).toUpperCase()}
                  </div>
                ))}
                {presentUsers.length > 4 && (
                  <div className="h-7 w-7 rounded-full border-2 border-background bg-muted text-muted-foreground text-[10px] font-medium grid place-items-center">
                    +{presentUsers.length - 4}
                  </div>
                )}
              </div>
            )}
            <DriftNotifier
              drifted={driftInfo.drifted} driftedNames={driftInfo.driftedNames}
              artifactTitle={project.name} hasSources={project.sources.length > 0}
            />
            <Button
              size="sm" variant="outline" onClick={recheckDrift}
              disabled={checkingDrift || project.sources.length === 0 || !!blockedReason}
              title={blockedReason ?? (project.sources.length === 0 ? "No sources to re-check against" : undefined)}
            >
              {checkingDrift
                ? <><Loader2 className="size-3.5 animate-spin" /> Re-checking…</>
                : <><AlertTriangle className="size-3.5" /> Re-check for drift</>}
            </Button>
            <AddSourceDialog project={project} onCanvasesRegenerated={onCanvasesRegenerated} blockedReason={blockedReason} />
            <CommentsDialog projectId={project.id} />
            <VersionHistoryDialog project={project} blockedReason={blockedReason} />
            <Button size="sm" variant="outline" onClick={saveVersion} disabled={savingVersion || panes.length === 0}>
              {savingVersion
                ? <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
                : <><History className="size-3.5" /> Save version</>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={exportingImage || !active} title={!active ? "Open an artifact first" : undefined}>
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

        <ScheduledDriftBanner project={project} onRecheck={recheckDrift} blockedReason={blockedReason} />

        <>
            <div className="rounded-xl border bg-card p-3 flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <Users2 className="size-3.5 text-primary" />
                  <span className="eyebrow text-muted-foreground">Sources</span>
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
              {active ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => openArtifact(null)}>
                    <ArrowLeft className="size-3.5" /> All artifacts
                  </Button>
                  <span className="text-sm font-medium truncate max-w-[240px]">
                    {panes.find(p => p.key === active)?.name}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-1">
                  <button
                    onClick={() => setBoardView("sidebar")}
                    aria-pressed={boardView === "sidebar"}
                    className={cn("px-2.5 py-1 rounded text-xs font-medium transition", boardView === "sidebar" ? "bg-card shadow-sm" : "text-muted-foreground")}
                  >
                    List
                  </button>
                  <button
                    onClick={() => setBoardView("board")}
                    aria-pressed={boardView === "board"}
                    className={cn("px-2.5 py-1 rounded text-xs font-medium transition", boardView === "board" ? "bg-card shadow-sm" : "text-muted-foreground")}
                  >
                    Board
                  </button>
                </div>
              )}
            </div>

            <div className={cn("relative", !active && "hidden")}>
              {panes.map(pane => (
                <CanvasPaneMount
                  key={`${pane.key}-${canvasVersion}`}
                  pane={pane}
                  visible={pane.key === (exportPane ?? active)}
                  onPublish={onPublish}
                  registerRef={(el) => { paneRefs.current[pane.key] = el; }}
                  onModelChange={(m, save) => { registerModel(pane.key, m); if (save) persistPane(pane, m); }}
                  projectId={project.id}
                  commentCounts={commentCounts}
                  onCommentCountChange={onCommentCountChange}
                  focusItemId={pane.key === active ? (focusItemId ?? undefined) : undefined}
                  tabId={tabId}
                  open={pane.key === active}
                  onEditorChange={onEditorChange}
                />
              ))}
            </div>

            {!active && (
              boardView === "sidebar" ? (
                <ArtifactSidebar
                  canvases={canvasOverride ?? project.canvases}
                  onOpen={openArtifact}
                  onCreate={createInstance}
                />
              ) : (
                <ArtifactBoard
                  canvases={canvasOverride ?? project.canvases}
                  onOpen={openArtifact}
                  onCreate={createInstance}
                  onFrameChange={onFrameChange}
                />
              )
            )}
        </>
      </main>
      <SignupWallModal open={signupOpen} onOpenChange={setSignupOpen} action={signupAction} />
      <ShareLinkDialog open={shareOpen} onOpenChange={setShareOpen} projectId={project.id} />
    </div>
  );
}

/** "Another of your tabs" for the same person, else their email. */
function peerLabel(peer: Peer, myUserId: string | undefined): string {
  return peer.userId && peer.userId === myUserId ? "Another of your tabs" : peer.email || "Someone else";
}

function CanvasPaneMount({
  pane, visible, onPublish, registerRef, onModelChange, projectId, commentCounts, onCommentCountChange, focusItemId,
  tabId, open, onEditorChange,
}: {
  pane: CanvasPane; visible: boolean;
  onPublish: (action: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  /** `save` is true only while this tab is the artifact's editor: a viewer's
   *  copy is kept for the merged save but must never be written itself. */
  onModelChange: (m: ArtifactModel, save: boolean) => void;
  projectId: string;
  commentCounts: Record<string, number>;
  onCommentCountChange: (itemId: string, delta: number) => void;
  focusItemId?: string;
  tabId: string;
  /** True while this pane is the one on screen (not merely shown for export). */
  open: boolean;
  onEditorChange: (key: string, editor: Peer | null) => void;
}) {
  const session = useSession();
  const lastBlockedToast = useRef(0);
  const editorRef = useRef<Peer | null>(null);
  const onBlocked = useCallback(() => {
    const now = Date.now();
    if (now - lastBlockedToast.current < 2500) return;
    lastBlockedToast.current = now;
    const e = editorRef.current;
    toast(`${e ? peerLabel(e, session.userId) : "Someone else"} is editing this artifact`, {
      description: "Press \u201cTake over editing\u201d to make changes.",
    });
  }, [session.userId]);
  const editing = useArtifactEditing(pane.initial, {
    channelName: `project:${projectId}:${pane.id}`, tabId, open,
    me: { userId: session.userId ?? "", email: session.email ?? "" }, onBlocked,
  });
  editorRef.current = editing.editor;
  const role = editing.role;
  useEffect(() => { onEditorChange(pane.key, editing.editor); }, [editing.editor, pane.key, onEditorChange]);
  const viewing = open && role === "viewer" && editing.editor
    ? { editorLabel: peerLabel(editing.editor, session.userId), onTakeOver: editing.takeOver }
    : undefined;
  const st = stats(editing.model);
  const changeRef = useRef(onModelChange);
  useEffect(() => { changeRef.current = onModelChange; });
  const roleRef = useRef(role);
  useEffect(() => { roleRef.current = role; });
  const lastModelRef = useRef<ArtifactModel | null>(null);
  useEffect(() => {
    if (lastModelRef.current === editing.model) return;
    lastModelRef.current = editing.model;
    changeRef.current(editing.model, roleRef.current === "editor");
  }, [editing.model]);
  // Handing over: whatever this tab still had waiting to save goes now, so
  // the next editor starts from it rather than overwriting it.
  const wasEditor = useRef(role === "editor");
  useEffect(() => {
    if (wasEditor.current && role === "viewer") sessionStore.flushCanvasUpdates(projectId);
    wasEditor.current = role === "editor";
  }, [role, projectId]);
  return (
    <div
      className={cn("rounded-xl border bg-card min-h-[560px] flex flex-col", !visible && "hidden")}
      ref={(el) => { registerRef(el); }}
    >
      <ArtifactView
        editing={editing} stats={st} onPublish={onPublish}
        projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange}
        focusItemId={focusItemId} initialTab={tabForViewKind(pane.viewKind)}
        viewing={viewing}
      />
    </div>
  );
}

/** Surfaces unnotified drift_alerts from the scheduled background scan
 *  (supabase/functions/scheduled-drift-scan). The scan only detects and
 *  records -- it never touches the canvas -- so this banner's job is to
 *  route a human to the existing "Re-check for drift" button, which does
 *  the real reconcile-with-manual-edits update. */
function ScheduledDriftBanner({ project, onRecheck, blockedReason }: { project: StoredProject; onRecheck: () => void; blockedReason?: string | null }) {
  const [alerts, setAlerts] = useState<DriftAlert[]>([]);

  useEffect(() => {
    sessionStore.listDriftAlerts(project.id).then(setAlerts).catch(() => setAlerts([]));
  }, [project.id]);

  const dismiss = async (id: string) => {
    setAlerts((cur) => cur.filter((a) => a.id !== id));
    try { await sessionStore.dismissDriftAlert(id); } catch { /* already removed from view either way */ }
  };

  if (alerts.length === 0) return null;
  const latest = alerts[0];
  const itemCount = latest.summary.reduce((n, s) => n + s.changed.length + s.added.length + s.removed.length, 0);

  return (
    <div className="mb-4 rounded-lg border border-drift/40 bg-drift/5 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <AlertTriangle className="size-4 text-drift-ink shrink-0" />
        <span>
          Automated scan found <strong>{itemCount} change{itemCount === 1 ? "" : "s"}</strong> in the source
          {alerts.length > 1 ? ` (+${alerts.length - 1} earlier scan${alerts.length - 1 === 1 ? "" : "s"})` : ""}.
          Nothing's been changed on the canvas yet.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" disabled={!!blockedReason} title={blockedReason ?? undefined}
          onClick={() => { onRecheck(); alerts.forEach((a) => dismiss(a.id)); }}>
          Review now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismiss(latest.id)}>Dismiss</Button>
      </div>
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

function VersionHistoryDialog({ project, blockedReason }: { project: StoredProject; blockedReason?: string | null }) {
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
            aria-pressed={tab === "versions"}
            className={cn("px-2.5 py-1 rounded text-xs font-medium transition", tab === "versions" ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            Versions
          </button>
          <button
            onClick={() => setTab("activity")}
            aria-pressed={tab === "activity"}
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
                      {i === 0 && <span className="eyebrow text-muted-foreground">latest</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {fmtVersionTime(s.createdAt)}{s.createdByEmail ? ` · ${s.createdByEmail}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="ghost" disabled={restoringId === s.id || !!blockedReason}
                    title={blockedReason ?? undefined}
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

function AddSourceDialog({
  project, onCanvasesRegenerated, blockedReason,
}: {
  project: StoredProject;
  onCanvasesRegenerated: (canvases: StoredProject["canvases"]) => void;
  blockedReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceDraft[]>([makeSource(0)]);
  const [busy, setBusy] = useState(false);
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
      // First source alone, then the rest -- see extractSources for why.
      perSource = await extractSources(allSources, project.kinds);
    } catch (err) {
      setBusy(false);
      alert(err instanceof Error ? err.message : "Extraction failed. Try again.");
      return;
    }
    if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "extraction_run", project.id, { sourceCount: allSources.length });
    // Re-extraction only knows "kind", not which specific named instance to
    // update -- pickPrimaryInstance targets the plain (non-flavored)
    // instance of each kind, or a lone flavored one if that's the only
    // instance of its kind, skipping ambiguous cases. Same logic as
    // recheckDrift in the parent component.
    const canvases: StoredCanvas[] = [];
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
      const primary = pickPrimaryInstance(project.canvases, kind);
      if (primary.action === "skip") continue;
      canvases.push(primary.action === "update"
        ? { ...primary.canvas, model: merged }
        : { id: crypto.randomUUID(), name: defaultCanvasName(kind), kind, model: merged });
    }
    // Preserve every existing canvas the loop above didn't touch -- kinds
    // with no extraction hit, and any additional same-kind instance.
    for (const existing of project.canvases) {
      if (!canvases.find(c => c.id === existing.id)) canvases.push(existing);
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
    onCanvasesRegenerated(canvases);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setSources([makeSource(0)]); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!!blockedReason} title={blockedReason ?? undefined}><Plus className="size-3.5" /> Add source</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a source to this project</DialogTitle>
          <DialogDescription>
            Paste a transcript or upload a .pdf / .docx. visu will re-extract across all
            sources and reconcile matching items — bumping confidence when sources agree and
            flagging conflicts when they don't.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-drift/30 bg-drift/[0.06] p-2.5 text-[11px] flex items-start gap-2">
          <AlertTriangle className="size-3.5 text-drift-ink shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            Adding a source regenerates the canvases from all sources. Manual edits to the current canvas will be replaced.
          </span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
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

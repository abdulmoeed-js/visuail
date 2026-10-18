import { createFileRoute, Link } from "@tanstack/react-router";
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
  CheckCheck, Split, Plus, AlertTriangle, History, RotateCcw, Clock, ImageDown,
} from "lucide-react";
import { ArtifactView, tabForViewKind, type ArtifactTab } from "@/components/Workbench";
import { useArtifactEditing, type BlockReason } from "@/lib/artifact-editing";
import { OUTDATED_DETAIL, OUTDATED_SAFE, OUTDATED_TITLE, assertCurrent, useOutdated } from "@/lib/model-schema";
import { keepArrangements } from "@/lib/canvas/layout";
import { allItems, type ArtifactModel } from "@/data/samples";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";
import { addSummaries, gradeOf, gradedItems, summarizeGrades } from "@/lib/grade";

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
          <Button asChild className="mt-6">
            <Link to="/dashboard"><ArrowLeft className="size-4" /> Back to dashboard</Link>
          </Button>
        </main>
      </div>
    );
  }

  return <ProjectShell project={project} />;
}

type Frame = { x: number; y: number; w: number; h: number };
interface CanvasPane { key: string; id: string; name: string; kind: ArtifactKind; viewKind?: ViewKind; initial: ArtifactModel; frame?: Frame; }

/** Lists the items whose grade is "Source changed" (flagged `drift: true` by
 *  diffModels()), counted the same way as every other certainty surface.
 *  Derived fresh from stored data on every render rather than kept in local
 *  state, so it survives the remount recheckDrift() triggers after saving. */
function collectDrift(canvases: StoredProject["canvases"]): { drifted: boolean; driftedNames: string[] } {
  const names: string[] = [];
  for (const c of canvases) {
    for (const item of gradedItems(c.model)) {
      if (gradeOf(item).grade === "changed") names.push(item.text);
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
    // Compare what matters, not object identity: a copy of the same editor
    // must not count as a change, or the page re-renders without end.
    setPaneEditors((cur) => (samePeer(cur[key] ?? null, editor) ? cur : { ...cur, [key]: editor }));
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
  // One status line under the header actions: a failure from any of them
  // (or from Export on a canvas, which lands here too) is shown there, in
  // place of a browser alert, and cleared when the next action starts.
  const [headerError, setHeaderError] = useState<FriendlyError | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (headerError) statusRef.current?.scrollIntoView({ block: "nearest" });
  }, [headerError]);

  const [savingVersion, setSavingVersion] = useState(false);
  const saveVersion = async () => {
    if (!session.userId) return;
    setHeaderError(null);
    setSavingVersion(true);
    const merged = buildMergedCanvases();
    try {
      assertCurrent();
      await sessionStore.saveSnapshot(project.id, merged, "manual_save", session.userId);
    } catch (e) {
      setHeaderError(friendlyError(e, "save this version"));
    } finally {
      setSavingVersion(false);
    }
  };

  const [checkingDrift, setCheckingDrift] = useState(false);
  /** Returns what went wrong (or null), so the header button and the
   *  scheduled-check banner can each show it where it was pressed. */
  const recheckDrift = async (): Promise<FriendlyError | null> => {
    if (!session.userId || project.sources.length === 0) return null;
    const userId = session.userId;
    setHeaderError(null);
    setCheckingDrift(true);
    try {
      assertCurrent();
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
        const reconciled = currentModel ? mergeByKind([currentModel, fresh], ["Current", "Re-checked source"], { stamp: false }) : fresh;
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

      assertCurrent();
      await sessionStore.updateProject(project.id, { canvases: nextCanvases });
      // The artifacts have changed from here on, so show them even if keeping
      // a version of them fails below.
      onCanvasesRegenerated(nextCanvases);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, userId, "drift_recheck", project.id);
      try {
        await sessionStore.saveSnapshot(project.id, nextCanvases, "drift_recheck", userId);
      } catch (err) {
        setHeaderError({
          ...friendlyError(err, "save the re-check as a version"),
          detail: "The artifacts are up to date. Press Save version to keep this point in the history.",
        });
      }
      return null;
    } catch (err) {
      const fe = friendlyError(err, "re-check for drift");
      return fe.kind === "rate-limit"
        ? { ...fe, detail: "A re-check reads every source again, so it reaches the hourly limit quickly. Try again later this hour." }
        : fe;
    } finally {
      setCheckingDrift(false);
    }
  };
  const recheckFromHeader = async () => {
    setHeaderError(null);
    const fe = await recheckDrift();
    if (fe) setHeaderError(fe);
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
    setHeaderError(null);
    try {
      // It writes every artifact back as this page loaded them.
      assertCurrent();
      await sessionStore.updateProject(project.id, patch);
      sessionStore.saveSnapshot(project.id, next, "manual_save", session.userId).catch(() => {});
      onCanvasesRegenerated(next);
      openArtifact(fresh.id);
    } catch (err) {
      setHeaderError(friendlyError(err, `create \u201c${name}\u201d`));
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
    setHeaderError(null);
    setExportingImage(true);
    const safe = project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const activeName = panes.find(p => p.key === active)?.name ?? "canvas";
    const suffix = activeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    try {
      if (format === "png") await exportElementToPng(`${safe || "visuail"}-${suffix}.png`, el);
      else await exportElementToSvg(`${safe || "visuail"}-${suffix}.svg`, el);
      if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "export_used", project.id, { format });
    } catch (e) {
      setHeaderError(friendlyError(e, `make the ${format.toUpperCase()} of \u201c${activeName}\u201d`));
    } finally {
      setExportingImage(false);
    }
  };

  const exportAll = async () => {
    if (project.canvases.length === 0) return;
    setHeaderError(null);
    setExporting(true);
    try {
      const sections: ExportSection[] = panes.map(p => ({
        title: `${project.name} — ${p.name}`,
        summary: summarizeGrades(editingModelsRef.current[p.key] ?? p.initial),
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
      const fe = friendlyError(e, "create the PDF");
      setHeaderError(fe.kind === "unknown" ? { ...fe, detail: "Your diagrams are safe. Try again in a moment." } : fe);
    } finally {
      setExportPane(null); setExporting(false);
    }
  };

  // How the sources line up across every artifact, graded the same way as
  // each item's chip (Re-check's own labels never count as a second source).
  const recon = useMemo(
    () => addSummaries(project.canvases.map((c) => summarizeGrades(c.model))),
    [project],
  );

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
  const outdated = useOutdated();
  // Adding a source, re-checking drift and restoring a version rewrite every
  // artifact from the database. While another tab is editing one, it would
  // keep working on its own copy and save that back over the result. A page
  // older than the data would write back models missing what it can't read.
  const blockedReason = useMemo(() => {
    if (outdated) return `${OUTDATED_TITLE}. ${OUTDATED_DETAIL}`;
    for (const p of panes) {
      const e = paneEditors[p.key];
      if (e && e.tabId !== tabId) return `${peerLabel(e, session.userId)} is editing \u201c${p.name}\u201d. Ask them to leave it first.`;
    }
    return null;
  }, [outdated, panes, paneEditors, tabId, session.userId]);

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
              size="sm" onClick={recheckFromHeader}
              disabled={checkingDrift || project.sources.length === 0 || !!blockedReason}
              title={blockedReason ?? (project.sources.length === 0 ? "No sources to re-check against" : undefined)}
            >
              {checkingDrift
                ? <><Loader2 className="size-3.5 animate-spin" /> Re-checking…</>
                : <><AlertTriangle className="size-3.5" /> Re-check for drift</>}
            </Button>
            <AddSourceDialog project={project} onCanvasesRegenerated={onCanvasesRegenerated} blockedReason={blockedReason} getCurrentCanvases={buildMergedCanvases} />
            <CommentsDialog projectId={project.id} />
            <VersionHistoryDialog project={project} blockedReason={blockedReason} getCurrentCanvases={buildMergedCanvases} onRestored={onCanvasesRegenerated} />
            <Button
              size="sm" variant="outline" onClick={saveVersion} disabled={savingVersion || panes.length === 0 || outdated}
              // A version kept by an out-of-date page would be missing what it can't read.
              title={outdated ? `${OUTDATED_TITLE}. ${OUTDATED_DETAIL}` : undefined}
            >
              {savingVersion
                ? <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
                : <><History className="size-3.5" /> Save version</>}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={exportingImage || !active} title={!active ? "Open an artifact first" : undefined}>
                  {exportingImage
                    ? <><Loader2 className="size-3.5 animate-spin" /> Downloading…</>
                    : <><ImageDown className="size-3.5" /> Download this artifact</>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportActiveImage("png")}>As an image (PNG)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportActiveImage("svg")}>As a vector file (SVG)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" onClick={exportAll} disabled={exporting || panes.length === 0}>
              {exporting
                ? <><Loader2 className="size-3.5 animate-spin" /> Building PDF…</>
                : <><FileDown className="size-3.5" /> Download all as PDF</>}
            </Button>
          </div>
        </div>

        <div ref={statusRef} className="scroll-mt-20">
          {headerError && (
            <div className="mb-4 flex items-start gap-2">
              <InlineError error={headerError} className="flex-1" />
              <Button size="sm" variant="link" className="h-auto py-2" onClick={() => setHeaderError(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </div>

        {outdated && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-unresolved/10 px-4 py-2.5 text-sm">
            <span><strong>{OUTDATED_TITLE}.</strong> {OUTDATED_DETAIL} {OUTDATED_SAFE}</span>
            <Button size="sm" onClick={() => window.location.reload()}>Reload</Button>
          </div>
        )}

        <ScheduledDriftBanner
          project={project} onRecheck={recheckDrift} checking={checkingDrift} blockedReason={blockedReason}
        />

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
                {project.sources.length > 0 && (
                  <>
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
                  </>
                )}
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

function samePeer(a: Peer | null, b: Peer | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.tabId === b.tabId && a.userId === b.userId && a.email === b.email
    && a.openedAt === b.openedAt && a.claimedAt === b.claimedAt && a.schema === b.schema;
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
  const onBlocked = useCallback((reason: BlockReason) => {
    const now = Date.now();
    if (now - lastBlockedToast.current < 2500) return;
    lastBlockedToast.current = now;
    if (reason === "outdated") {
      toast(OUTDATED_TITLE, {
        id: "visu-outdated", description: `${OUTDATED_DETAIL} ${OUTDATED_SAFE}`,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
      return;
    }
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
  // An out-of-date page can't take over; the artifact says to reload instead.
  const viewing = open && role === "viewer" && editing.editor && !editing.outdated
    ? { editorLabel: peerLabel(editing.editor, session.userId), onTakeOver: editing.takeOver }
    : undefined;
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
        editing={editing} onPublish={onPublish} exportLabel="Download all as PDF"
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
function ScheduledDriftBanner({ project, onRecheck, checking, blockedReason }: {
  project: StoredProject;
  /** Resolves to what went wrong, or null once the re-check is done. */
  onRecheck: () => Promise<FriendlyError | null>;
  checking: boolean;
  blockedReason?: string | null;
}) {
  const [alerts, setAlerts] = useState<DriftAlert[]>([]);
  const [error, setError] = useState<FriendlyError | null>(null);
  // A re-check started from anywhere clears a failure shown here earlier.
  useEffect(() => { if (checking) setError(null); }, [checking]);

  useEffect(() => {
    sessionStore.listDriftAlerts(project.id).then(setAlerts).catch(() => setAlerts([]));
  }, [project.id]);

  const dismiss = async (id: string) => {
    setAlerts((cur) => cur.filter((a) => a.id !== id));
    try { await sessionStore.dismissDriftAlert(id); } catch { /* already removed from view either way */ }
  };

  // The alerts are cleared only once the re-check has worked; if it fails,
  // they stay and the failure is shown here, where it was pressed.
  const recheck = async () => {
    setError(null);
    const fe = await onRecheck();
    if (fe) { setError(fe); return; }
    alerts.forEach((a) => dismiss(a.id));
  };

  if (alerts.length === 0) return null;
  const latest = alerts[0];
  const itemCount = latest.summary.reduce((n, s) => n + s.changed.length + s.added.length + s.removed.length, 0);
  const earlier = alerts.length - 1;

  return (
    <div className="mb-4 rounded-lg border border-drift/40 bg-drift/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <AlertTriangle className="size-4 text-drift-ink shrink-0" aria-hidden />
          <span>
            A scheduled check found <strong>{itemCount} change{itemCount === 1 ? "" : "s"}</strong> in the sources.
            {earlier > 0 ? ` ${earlier} earlier check${earlier === 1 ? "" : "s"} also found changes.` : ""}
            {" "}Your artifacts haven't changed yet.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" disabled={!!blockedReason || checking} title={blockedReason ?? undefined}
            onClick={() => { void recheck(); }}>
            {checking ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Re-checking…</> : "Re-check now"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismiss(latest.id)}>Hide alert</Button>
        </div>
      </div>
      <InlineError error={error} className="mt-2" />
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

function VersionHistoryDialog({ project, blockedReason, getCurrentCanvases, onRestored }: {
  project: StoredProject;
  blockedReason?: string | null;
  /** What's on screen now, live edits included, so a restore can keep it. */
  getCurrentCanvases: () => StoredProject["canvases"];
  /** Remounts the panes from the restored canvases, so what's on screen (and
   *  what autosave writes next) is the restored version, not the old one. */
  onRestored: (canvases: StoredProject["canvases"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"versions" | "activity">("versions");
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [pendingRestore, setPendingRestore] = useState<SnapshotSummary | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const session = useSession();

  const load = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      sessionStore.listSnapshots(project.id),
      sessionStore.listSnapshotsWithCanvases(project.id).then(buildAuditTrail),
    ])
      .then(([s, e]) => { setSnapshots(s); setEvents(e); })
      .catch((err) => {
        setSnapshots([]); setEvents([]);
        setLoadError(friendlyError(err, "load the version history"));
      })
      .finally(() => setLoading(false));
  };

  // Keep what's on screen as its own version first, so restoring never
  // loses work done since the last checkpoint (the dialog promises this).
  const restore = async (snapshotId: string) => {
    if (!session.userId) throw { code: "PGRST301", message: "Not signed in." };
    assertCurrent();
    const current = getCurrentCanvases();
    sessionStore.flushCanvasUpdates(project.id);
    await sessionStore.saveSnapshot(project.id, current, "manual_save", session.userId);
    const canvases = await sessionStore.getSnapshotCanvases(snapshotId);
    assertCurrent();
    await sessionStore.updateProject(project.id, { canvases });
    onRestored(canvases);
    setOpen(false);
    // The restore is done; recording it as a version too is a nicety, so a
    // failure here mustn't report the restore itself as failed.
    sessionStore.saveSnapshot(project.id, canvases, "manual_save", session.userId).catch(() => {});
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
              ? "Saved when the project was created, when sources were added or re-checked, and when someone pressed Save version. Restoring one saves what you have now as a version first."
              : "What changed in each item between saved versions."}
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
        ) : loadError ? (
          <InlineError error={loadError} onRetry={load} />
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
                    size="sm" variant="ghost" disabled={!!blockedReason}
                    title={blockedReason ?? undefined}
                    onClick={() => setPendingRestore(s)}
                  >
                    <RotateCcw className="size-3.5" /> Restore
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
      <ConfirmDialog
        open={!!pendingRestore}
        onOpenChange={(o) => { if (!o) setPendingRestore(null); }}
        title={pendingRestore ? `Restore the version from ${fmtVersionTime(pendingRestore.createdAt)}?` : ""}
        consequence="Every artifact goes back to how it was then. What you have now is saved as a version first, so you can switch back."
        confirmLabel="Restore this version"
        busyLabel="Restoring…"
        cancelLabel="Keep current"
        tone="default"
        doing="restore this version"
        onConfirm={() => (pendingRestore ? restore(pendingRestore.id) : undefined)}
      />
    </Dialog>
  );
}

function AddSourceDialog({
  project, onCanvasesRegenerated, blockedReason, getCurrentCanvases,
}: {
  project: StoredProject;
  onCanvasesRegenerated: (canvases: StoredProject["canvases"]) => void;
  blockedReason?: string | null;
  /** What's on screen now, including a collaborator's changes received
   *  since the page loaded: the arrangements to keep come from here. */
  getCurrentCanvases: () => StoredCanvas[];
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceDraft[]>([makeSource(0)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const session = useSession();

  const ready = sources.filter(s => s.status === "ready" && s.text.trim().length > 0);
  // The dialog stays open on a failure, so the files are never lost.
  const keepFiles = (fe: FriendlyError): FriendlyError => ({
    ...fe,
    detail: fe.kind === "unknown" ? "Your files are still here. Try again in a moment." : `${fe.detail} Your files are still here.`,
  });

  const apply = async () => {
    setError(null);
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
      // Before reading every source again, not only before the save.
      assertCurrent();
      // First source alone, then the rest -- see extractSources for why.
      perSource = await extractSources(allSources, project.kinds);
    } catch (err) {
      setBusy(false);
      setError(keepFiles(friendlyError(err, "read the sources")));
      return;
    }
    if (session.currentOrgId) sessionStore.trackEvent(session.currentOrgId, session.userId, "extraction_run", project.id, { sourceCount: allSources.length });
    // Re-extraction only knows "kind", not which specific named instance to
    // update -- pickPrimaryInstance targets the plain (non-flavored)
    // instance of each kind, or a lone flavored one if that's the only
    // instance of its kind, skipping ambiguous cases. Same logic as
    // recheckDrift in the parent component.
    const live = new Map(getCurrentCanvases().map((c) => [c.id, c.model]));
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
        // The fresh extraction replaces the model; the arrangement on screen
        // stays (the stored copy can be older than a collaborator's moves).
        ? { ...primary.canvas, model: keepArrangements(live.get(primary.canvas.id) ?? primary.canvas.model, merged) }
        : { id: crypto.randomUUID(), name: defaultCanvasName(kind), kind, model: merged });
    }
    // Preserve every existing canvas the loop above didn't touch -- kinds
    // with no extraction hit, and any additional same-kind instance.
    for (const existing of project.canvases) {
      if (!canvases.find(c => c.id === existing.id)) canvases.push(existing);
    }

    try {
      assertCurrent();
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
      setError(keepFiles(friendlyError(err, "save the new source")));
      return;
    }
    setBusy(false);
    setOpen(false);
    onCanvasesRegenerated(canvases);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      // Reading the sources takes a few seconds; closing mid-way would hide a
      // failure and lose the files, so the dialog stays open until it's done.
      if (busy && !o) return;
      setOpen(o);
      if (o) { setSources([makeSource(0)]); setError(null); }
    }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!!blockedReason} title={blockedReason ?? undefined}><Plus className="size-3.5" /> Add source</Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Add a source to this project</DialogTitle>
          <DialogDescription>
            Paste a transcript or add a PDF or Word file. The artifacts are then redrawn from all
            the sources together.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-drift/30 bg-drift/[0.06] p-2.5 text-[11px] flex items-start gap-2">
          <AlertTriangle className="size-3.5 text-drift-ink shrink-0 mt-0.5" aria-hidden />
          <span className="text-muted-foreground">
            Adding a source redraws the artifacts from all the sources, so edits made by hand will be replaced.
          </span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          <SourceIntake sources={sources} onChange={setSources} />
        </div>
        <InlineError error={error} />
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-[11px] text-muted-foreground">
            {ready.length} new source{ready.length === 1 ? "" : "s"} ready
          </span>
          <Button disabled={ready.length === 0 || busy} onClick={apply}>
            {busy
              ? <><Loader2 className="size-4 animate-spin" /> Reading all sources…</>
              : <>Add and redraw</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

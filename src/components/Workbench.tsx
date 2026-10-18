import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Sparkles, RotateCcw, AlertOctagon, Share2, FileDown,
  LayoutList, Shuffle, ShieldCheck, Loader2, Info,
  FolderOpen, X as XIcon, Undo2, Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SAMPLES,
  type ArtifactModel, type Sample, type BaseItem,
} from "@/data/samples";
import { gradeOf, summarizeGrades } from "@/lib/grade";
import { GradeBar } from "./workbench/atoms";
import { EditableList } from "./workbench/EditableList";
import { ProcessCanvas } from "./workbench/ProcessCanvas";
import { BMCCanvas } from "./workbench/BMCCanvas";
import { CanvasErrorBoundary } from "./workbench/CanvasErrorBoundary";
import {
  CanvasViewStoreProvider, useCanvasViewStore, useNewCanvasViewStore, LAYOUT_MOVED_KEY,
} from "./workbench/canvas-view-store";
import { historyNotice } from "@/lib/describe-edit";
import { BRDTab, BacklogTab, BriefTab, QuestionsTab } from "./workbench/DownstreamTabs";
import { UseCaseDiagramView } from "./workbench/UseCaseDiagramView";
import { DFDView } from "./workbench/DFDView";
import { DecisionTreeView } from "./workbench/DecisionTreeView";
import { StateDiagramView } from "./workbench/StateDiagramView";
import { ActivityDiagramView } from "./workbench/ActivityDiagramView";
import { UseCaseDescriptionDialog } from "./workbench/UseCaseDescriptionDialog";
import { RaciMatrixView } from "./workbench/RaciMatrixView";
import { ToolkitPanel } from "./workbench/ToolkitPanel";
import { DriftNotifier } from "./workbench/DriftNotifier";
import {
  ArtifactFullscreenProvider, ignoreShortcut, useArtifactFullscreenController,
} from "./workbench/artifact-fullscreen";
import { FullscreenHeader, LaserPointer, ShortcutsCard } from "./workbench/FullscreenChrome";
import { TemplateGallery } from "./workbench/TemplateGallery";
import { Link } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";
import { type ProjectResult } from "./workbench/IntakeWizard";
import { ProjectView } from "./workbench/ProjectView";
import { SignupWallModal } from "./SignupWallModal";
import { useArtifactEditing, type ArtifactEditing } from "@/lib/artifact-editing";
import { OUTDATED_DETAIL, OUTDATED_SAFE, OUTDATED_TITLE } from "@/lib/model-schema";
import { checkRefusal } from "@/lib/refusal";
import { verifyGrounding } from "@/lib/grounding";
import type { ViewKind } from "@/lib/session";

type State =
  | { status: "empty" }
  | { status: "extracting" }
  | { status: "refused"; reason: string }
  | { status: "ready" };

export type ArtifactTab = "artifact" | "usecases" | "raci" | "dfd" | "decisiontree" | "statediagram" | "activity" | "toolkit" | "items" | "downstream1" | "downstream2";

/** The 5 new ViewKinds are spelled identically to their ArtifactTab, so this
 *  is nearly the identity function -- process/bmc/undefined all land on the
 *  base "artifact" tab. */
export function tabForViewKind(vk: ViewKind | undefined): ArtifactTab {
  if (vk === "dfd" || vk === "raci" || vk === "decisiontree" || vk === "statediagram" || vk === "activity") return vk;
  return "artifact";
}

export function Workbench() {
  const [transcript, setTranscript] = useState(SAMPLES[0].transcript);
  const [activeSample, setActiveSample] = useState<Sample>(SAMPLES[0]);
  const [state, setState] = useState<State>({ status: "empty" });
  const [wallOpen, setWallOpen] = useState(false);
  const [wallAction, setWallAction] = useState("Share link");
  const [project, setProject] = useState<ProjectResult | null>(null);

  const initialModel = useMemo(() => SAMPLES[0].build()!, []);
  const editing = useArtifactEditing(initialModel);

  const loadSample = (s: Sample) => {
    setActiveSample(s);
    setTranscript(s.transcript);
    setState({ status: "empty" });
  };

  const extract = () => {
    setState({ status: "extracting" });
    setTimeout(() => {
      const rawModel = transcript.trim().length < 120 ? null : activeSample.build();
      // Check the quotes first, as the project paths do, so a quote the
      // text doesn't contain counts as unclear when deciding to refuse.
      const model = rawModel ? verifyGrounding(rawModel, transcript) : null;
      const refusal = checkRefusal(model);
      if (refusal.refuse || !model) {
        setState({ status: "refused", reason: refusal.reason! });
        return;
      }
      editing.reset(model);
      setState({ status: "ready" });
    }, 900);
  };

  const openWall = (action: string) => { setWallAction(action); setWallOpen(true); };

  // Project mode short-circuits the single-source workbench UI.
  if (project) {
    return (
      <section id="workbench" className="mx-auto max-w-[1400px] px-4 pb-24">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 eyebrow text-primary">
              <FolderOpen className="size-3" /> Project · {project.sources.length} source{project.sources.length === 1 ? "" : "s"}
            </div>
            <h2 className="font-display text-3xl md:text-4xl mt-1 truncate max-w-[820px]">
              {project.name}
            </h2>
            <p className="text-muted-foreground text-sm mt-1 max-w-xl">
              {project.canvases.length} artifact{project.canvases.length === 1 ? "" : "s"} generated from {project.sources.length} reconciled source{project.sources.length === 1 ? "" : "s"}.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setProject(null)}>
            <XIcon className="size-3.5" /> Exit project
          </Button>
        </div>
        <ProjectView project={project} onPublish={openWall} />
        <SignupWallModal open={wallOpen} onOpenChange={setWallOpen} action={wallAction} />
      </section>
    );
  }

  return (
    <section id="workbench" className="mx-auto max-w-[1400px] px-4 pb-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-primary">
            No signup to start
          </div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">See it on a sample call.</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-xl">
            Edit it and press Extract. To use your own transcript, start a free project.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
            <Link to="/new">
              <FolderPlus className="size-3.5" /> New project
            </Link>
          </Button>
          <TemplateGallery onPick={loadSample} />
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          {SAMPLES.map((sm) => (
            <button
              key={sm.id}
              onClick={() => loadSample(sm)}
              aria-pressed={activeSample.id === sm.id}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                activeSample.id === sm.id
                  ? "bg-primary/10 text-primary border-primary"
                  : "bg-card border-separator-strong hover:bg-fill-4",
              )}
              title={sm.blurb}
            >
              {sm.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Source panel */}
        <div className="rounded-xl border bg-card p-4 flex flex-col gap-3 h-fit lg:sticky lg:top-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <h3 className="text-sm font-semibold">Source</h3>
              <span className="text-[10px] font-mono-tight text-muted-foreground">
                {transcript.length} chars · {transcript.trim().split(/\s+/).length} words
              </span>
            </div>
            <button
              onClick={() => setTranscript("")}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <Textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            aria-label="Sample call transcript"
            placeholder="Pick a sample call above to load its transcript."
            className="min-h-[380px] font-mono-tight text-xs leading-relaxed resize-y"
          />
          <div className="flex items-center gap-2">
            {/* The main action until there is a diagram; after that,
                extracting again is an ordinary choice. */}
            <Button
              onClick={extract}
              disabled={state.status === "extracting"}
              variant={state.status === "ready" ? "outline" : "default"}
              className="flex-1 h-10"
            >
              {state.status === "extracting" ? (
                <><Loader2 className="animate-spin size-4" /> Extracting…</>
              ) : (
                <><Sparkles className="size-4" /> Extract artifact</>
              )}
            </Button>
            <Button variant="ghost" size="icon" title="Reload the sample call" aria-label="Reload the sample call"
              onClick={() => { loadSample(activeSample); }}>
              <RotateCcw className="size-4" />
            </Button>
          </div>
          <div className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground leading-relaxed">
            <div className="flex items-start gap-1.5">
              <Info className="size-3.5 mt-0.5 shrink-0" />
              {/* The preview always draws the selected sample: pasted text is
                  only used to refuse very short input and to flag sample quotes
                  it doesn't contain. Say so the moment the text stops matching. */}
              {transcript.trim() && transcript.trim() !== activeSample.transcript.trim() ? (
                <span>
                  Only the sample call is drawn here, not your own text. To use your own transcript,{" "}
                  <Link to="/new" className="text-primary underline underline-offset-4">start a free project</Link>.
                </span>
              ) : (
                <span>Nothing you paste here leaves your browser.</span>
              )}
            </div>
          </div>
        </div>

        {/* Artifact panel */}
        <div className="rounded-xl border bg-card min-h-[560px] flex flex-col">
          {state.status === "empty" && <EmptyState onClick={extract} />}
          {state.status === "extracting" && <ExtractingState />}
          {state.status === "refused" && <RefusedState reason={state.reason} onRetry={() => setState({ status: "empty" })} />}
          {state.status === "ready" && (
            <ArtifactView editing={editing} onPublish={openWall} demoHints />
          )}
        </div>
      </div>

      <SignupWallModal open={wallOpen} onOpenChange={setWallOpen} action={wallAction} />
    </section>
  );
}

function EmptyState({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 gap-4 bp-grid-fine rounded-xl m-1">
      <h3 className="font-display text-2xl max-w-md">
        Your typed artifact will render here — not a shape library, a model.
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Pick a sample call and press <strong>Extract</strong>, or click <strong>New project</strong> to upload your own PDF or Word files.
      </p>
      {/* Ordinary here: the source panel's Extract button is the main one,
          and both are on screen together. */}
      <Button variant="outline" onClick={onClick} className="mt-2"><Sparkles className="size-4" /> Extract artifact</Button>
    </div>
  );
}

function ExtractingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-16">
      <div className="w-72 space-y-2">
        {/* The 900ms wait is the one moment a first-time visitor is guaranteed
         *  to be reading -- spend it on what the product does in plain BA
         *  language, not compiler vocabulary ("tokenizing", "typed IR"). Each
         *  line maps to a real step: extraction, typing, confidence, grounding. */}
        {["Reading the transcript…", "Finding actors, steps and decisions…", "Checking how clearly each one is stated…", "Flagging anything the source didn't actually say…"].map((t, i) => (
          <div key={t} className="flex items-center gap-2 text-xs font-mono-tight text-muted-foreground">
            <Loader2 className="size-3 animate-spin" style={{ animationDelay: `${i * 120}ms` }} />
            <span>{t}</span>
          </div>
        ))}
        <div className="h-1.5 w-full overflow-hidden rounded bg-muted mt-3">
          <div className="h-full w-1/3 animate-shimmer" />
        </div>
      </div>
    </div>
  );
}

function RefusedState({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-unresolved bg-unresolved/10 text-unresolved-ink">
        <ShieldCheck className="size-5" />
      </div>
      <div className="max-w-md space-y-1.5">
        <div className="eyebrow text-unresolved-ink">
          Not enough to draw from
        </div>
        <h3 className="font-display text-xl">Nothing was drawn from this one.</h3>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
      <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground max-w-md text-left">
        <strong className="text-foreground">Why this matters:</strong> most tools would happily
        fabricate a three-box diagram from a single sentence. Here, a diagram that would need
        guessing isn&rsquo;t drawn, and the reason is shown instead.
      </div>
      <Button variant="outline" onClick={onRetry}>Back to the transcript</Button>
    </div>
  );
}

/** The ArtifactView the person last clicked or focused in. More than one can
 *  be mounted at once (project mode), and Ctrl/Cmd+Z must only ever act on
 *  the one they are working in. */
let activeArtifactRoot: HTMLElement | null = null;

/** The tabs shown while presenting: diagrams to look at, nothing to edit. */
const PRESENT_TABS = new Set<ArtifactTab>(["artifact", "usecases", "raci", "dfd", "decisiontree", "statediagram", "activity"]);

/** Somewhere the browser's own text undo applies, so Ctrl/Cmd+Z must be left
 *  to it. A <select> is not one: it has no text history, and treating it as
 *  one made the shortcut go dead after any dropdown was used. */
const isTextEntry = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

/** One notice at a time for edit history, and a NEW one each time.
 *
 *  The obvious way -- one fixed toast id, updated in place -- has two traps
 *  in sonner: an update is merged into the toast on screen, so any field the
 *  new call leaves out keeps its old value (the last notice's second line and
 *  button lingered under the next title); and an update that lands in the
 *  fraction of a second while the old toast is fading out is thrown away with
 *  it, so that undo showed no notice at all. Dismissing the previous notice
 *  and raising a fresh one has neither problem. */
let lastHistoryToast: string | number | undefined;
function historyToast(
  title: string,
  extra: { description?: string; action?: { label: string; onClick: () => void } } = {},
): string | number {
  const { action } = extra;
  if (lastHistoryToast !== undefined) toast.dismiss(lastHistoryToast);
  lastHistoryToast = toast(title, {
    description: extra.description,
    action: action && {
      label: action.label,
      onClick: () => {
        // Pressing this leaves focus inside the toaster: on the button, or
        // (Safari, which does not focus a clicked button) on the notice
        // around it. sonner remembers what had focus before and hands it
        // back the next time focus leaves the toaster -- seconds later, in
        // the middle of whatever the person is typing by then. Letting go
        // now makes the hand-back happen here, at once, instead.
        const held = document.activeElement;
        if (held instanceof HTMLElement && held.closest("[data-sonner-toaster]")) held.blur();
        action.onClick();
      },
    },
  });
  return lastHistoryToast;
}

/**
 * ArtifactView — renders a single artifact model with all editing controls,
 * downstream tabs, and publish/export actions. Extracted so the multi-canvas
 * project view can reuse the exact same UI per artifact.
 */
export function ArtifactView({
  editing, onPublish, exportLabel = "Download as PDF", canvasRef, extraHeaderRight,
  projectId, commentCounts, onCommentCountChange, focusItemId, initialTab, demoHints, viewing,
}: {
  editing: ArtifactEditing;
  /** Share and export actions. Omitted on the public share page, where the
   *  reader has nothing to publish. */
  onPublish?: (action: string) => void;
  /** Names what the footer's PDF button downloads; on the project page it
   *  runs the same export as the header, every artifact at once. */
  exportLabel?: string;
  canvasRef?: React.RefObject<HTMLDivElement>;
  extraHeaderRight?: ReactNode;
  /** Only set on the real project page -- omitted in the marketing demo, which has no comments backend. */
  projectId?: string;
  commentCounts?: Record<string, number>;
  onCommentCountChange?: (itemId: string, delta: number) => void;
  /** Arriving from the dashboard's comments inbox -- lands on the Items tab
   *  with the relevant row scrolled to and its thread opened. */
  focusItemId?: string;
  /** Which tab this instance opens to -- e.g. a DFD-flavored instance passes
   *  "dfd" here so it lands on that lens by default. focusItemId still wins
   *  when both are set (an inbox deep link takes priority). */
  initialTab?: ArtifactTab;
  /** Marketing-demo only. A first-time visitor sees a nice diagram and reads
   *  "diagram tool" -- the whole differentiator (drift) sits behind a button
   *  they have no reason to click. This surfaces a one-time nudge toward it,
   *  and is the only place the simulated source change exists: on a real
   *  project it would put back the copy loaded with the page, wipe the drift
   *  flags from the last real re-check and autosave that. Never set on the
   *  real project page or the share page. */
  demoHints?: boolean;
  /** Project page only: someone else is editing this artifact right now, so
   *  this view is read-only until the person takes over. */
  viewing?: { editorLabel: string; onTakeOver: () => void };
}) {
  const { model, drifted } = editing;
  const grades = useMemo(() => summarizeGrades(model), [model]);
  const changedWords = `${grades.changed} item${grades.changed === 1 ? "" : "s"} changed in the source`;
  const [drilldownStepId, setDrilldownStepId] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);
  const showDriftHint = !!demoHints && !drifted && !hintDismissed;

  const tabs: { value: ArtifactTab; label: ReactNode }[] = [
    { value: "artifact", label: model.kind === "process" ? "Process map" : "Canvas" },
    ...(model.kind === "process" ? [{ value: "usecases" as const, label: "Use cases" }] : []),
    ...(model.kind === "process" ? [{ value: "raci" as const, label: "RACI" }] : []),
    ...(model.kind === "process" ? [{ value: "dfd" as const, label: "DFD" }] : []),
    ...(model.kind === "process" ? [{ value: "decisiontree" as const, label: "Decision tree" }] : []),
    ...(model.kind === "process" ? [{ value: "statediagram" as const, label: "State diagram" }] : []),
    ...(model.kind === "process" ? [{ value: "activity" as const, label: "Activity" }] : []),
    { value: "toolkit", label: "Toolkit" },
    { value: "items", label: <><LayoutList className="size-3.5" /> Items</> },
    { value: "downstream1", label: model.kind === "process" ? "BRD" : "Summary brief" },
    { value: "downstream2", label: model.kind === "process" ? "Traced backlog" : "Open questions" },
  ];

  // Lazy init (function form) so this only runs once on mount, not on every
  // render -- and clamps a stale/mismatched initialTab (e.g. a "dfd"
  // viewKind sitting on a non-process model) to "artifact" defensively
  // instead of landing on a tab that isn't actually in the bar.
  const [tab, setTab] = useState<ArtifactTab>(() => {
    if (focusItemId) return "items";
    if (initialTab && tabs.some((t) => t.value === initialTab)) return initialTab;
    return "artifact";
  });

  // Now that the tab bar scrolls instead of overflowing, a viewKind that
  // opens straight onto one of the far-right tabs (e.g. a DFD instance
  // landing on "DFD") would otherwise start scrolled to the left, showing
  // an unselected-looking bar with the real active tab off-screen.
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) for model edits. Three guards
  // keep this from ever surprising anyone: it only fires for the artifact
  // last clicked in; never while typing, where the browser's own text undo
  // must win; and never from inside something layered over the artifact (a
  // dialog or popover lives outside this element), where the person is
  // plainly not addressing the diagram.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Full screen takes the tabs, undo/redo and canvas together, so switching
  // diagram type never drops you out of it.
  const fsRef = useRef<HTMLDivElement | null>(null);
  const fs = useArtifactFullscreenController(fsRef);
  const fsToggleRef = useRef(fs.toggle);
  fsToggleRef.current = fs.toggle;
  const presentingRef = useRef(fs.presenting);
  presentingRef.current = fs.presenting;
  // Presenting shows the diagrams (and the read-only RACI grid); the
  // document tabs are where editing happens, so they step aside.
  const shownTabs = fs.presenting ? tabs.filter((t) => PRESENT_TABS.has(t.value)) : tabs;
  useEffect(() => {
    if (fs.presenting && !PRESENT_TABS.has(tab)) setTab("artifact");
  }, [fs.presenting, tab]);
  useEffect(() => {
    // F toggles full screen for the artifact on screen. Exactly one answers:
    // the project page keeps the others mounted but hidden, and the share
    // page shows several at once.
    const onKey = (e: KeyboardEvent) => {
      if (ignoreShortcut(e)) return;
      if (!(e.code === "KeyF" || e.key.toLowerCase() === "f")) return;
      const root = rootRef.current;
      if (!root || root.getClientRects().length === 0) return;
      // A key pressed in the page's own controls (nav, sidebar) is theirs.
      const t = e.target;
      if (t instanceof Node && t !== document.body && !root.contains(t)) return;
      const claimed = activeArtifactRoot;
      if (claimed && claimed.isConnected && claimed.getClientRects().length > 0) {
        if (claimed !== root) return;
      } else {
        const visible = [...document.querySelectorAll("[data-artifact-root]")].filter((r) => r.getClientRects().length > 0);
        if (visible.length > 1) {
          const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          if (!hit || !root.contains(hit)) return;
        }
      }
      activeArtifactRoot = root;
      e.preventDefault();
      fsToggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Created here rather than inside the provider below, because the undo
  // handler in this component needs to read it too.
  const viewStore = useNewCanvasViewStore();
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; });

  /** Undo or redo, and say what it did. The edit being stepped over is often
   *  in another tab or off-screen; done silently, undo either looks broken
   *  or removes something the person never sees go. */
  // A notice lives at the app root and can outlast this view (a route
  // change, the panes remounting after a re-check). Its Undo/Redo button
  // must not act on a view that is gone -- the step would be consumed and
  // reported, and nothing saved -- so the view takes its notice with it.
  const mounted = useRef(true);
  const ownNotice = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ownNotice.current !== undefined) toast.dismiss(ownNotice.current);
    };
  }, []);
  const viewingRef = useRef(viewing);
  useEffect(() => { viewingRef.current = viewing; });
  const runHistory = useCallback((direction: "undo" | "redo") => {
    if (!mounted.current) return;
    if (editingRef.current.outdated) {
      ownNotice.current = historyToast(OUTDATED_TITLE, { description: `${OUTDATED_DETAIL} ${OUTDATED_SAFE}` });
      return;
    }
    const v = viewingRef.current;
    if (v) {
      ownNotice.current = historyToast(`${v.editorLabel} is editing this artifact`, {
        description: "Press \u201cTake over editing\u201d to make changes.",
      });
      return;
    }
    const ed = editingRef.current;
    const other = direction === "undo" ? "redo" : "undo";
    // Undo steps through edits to the content, not through where shapes sit.
    // If the last thing done was a drag or resize, the person is asking to
    // undo THAT -- reverting some older edit instead would be a nasty
    // surprise. Say so once; the next press steps back as normal.
    if (direction === "undo" && viewStore.get(LAYOUT_MOVED_KEY) === ed.model) {
      viewStore.delete(LAYOUT_MOVED_KEY);
      ownNotice.current = historyToast("Moving or resizing a shape can't be undone", {
        description: ed.canUndo ? "Undo again to step back through your edits instead." : undefined,
      });
      return;
    }
    const summary = direction === "undo" ? ed.onUndo() : ed.onRedo();
    if (!summary) {
      ownNotice.current = historyToast(
        direction === "redo" ? "Nothing to redo"
          : ed.undoClearedByPeer ? "Undo history was cleared when someone else edited this"
          : "Nothing to undo",
      );
      return;
    }
    ownNotice.current = historyToast(historyNotice(direction, summary), {
      action: { label: other === "redo" ? "Redo" : "Undo", onClick: () => runHistory(other) },
    });
  }, [viewStore]);
  const runHistoryRef = useRef(runHistory);
  useEffect(() => { runHistoryRef.current = runHistory; });
  // "The last thing done was a move" stops being true the moment the model
  // changes, whatever changed it. (Comparing objects alone is not enough:
  // "Restore source" puts the original model object back.)
  useEffect(() => { viewStore.delete(LAYOUT_MOVED_KEY); }, [editing.model, viewStore]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const claim = () => { activeArtifactRoot = root; };
    root.addEventListener("pointerdown", claim, true);
    root.addEventListener("focusin", claim);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const undo = key === "z" && !e.shiftKey;
      // Ctrl+Y is redo on Windows and Linux only. Cmd+Y on a Mac opens the
      // browser's history, and must be left alone.
      const redo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey);
      if (!undo && !redo) return;
      if (activeArtifactRoot !== root) return;
      // The project page keeps every artifact mounted and hides the ones
      // not open; a hidden one has no boxes and must never act.
      if (root.getClientRects().length === 0) return;
      if (isTextEntry(e.target)) return;
      const t = e.target;
      const el = t instanceof Element ? t : null;
      // A pop-up over the artifact (full screen places them inside it) keeps
      // its keys; the notice area is the one overlay whose Undo/Redo is ours.
      if (el?.closest("[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]")
        && !el.closest("[data-sonner-toaster]")) return;
      // Focus must be somewhere that belongs to this artifact: inside it, on
      // nothing in particular, or on the history notice itself (its
      // Undo/Redo button keeps focus after a click).
      const ours = t === document.body || (t instanceof Node && root.contains(t))
        || !!el?.closest("[data-sonner-toaster]");
      if (!ours) return;
      e.preventDefault();
      // Presenting: nothing changes in front of the audience.
      if (presentingRef.current) {
        historyToast("Editing is off while presenting", { description: "Press P to go back to editing." });
        return;
      }
      runHistoryRef.current(redo ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("pointerdown", claim, true);
      root.removeEventListener("focusin", claim);
      window.removeEventListener("keydown", onKey);
      if (activeArtifactRoot === root) activeArtifactRoot = null;
    };
  }, []);

  return (
    <CanvasViewStoreProvider store={viewStore}>
    <div ref={rootRef} className="flex-1 flex flex-col" data-artifact-root>
      {editing.outdated && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b bg-unresolved/10 px-4 py-2 text-sm">
          <span><strong>{OUTDATED_TITLE}.</strong> {OUTDATED_DETAIL}</span>
          <Button size="sm" variant="outline" className="bg-card" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      )}
      {viewing && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b bg-unresolved/10 px-4 py-2 text-sm">
          <span>
            <strong>{viewing.editorLabel}</strong> is editing this artifact. You&rsquo;re viewing; changes appear here as they&rsquo;re made.
          </span>
          <Button size="sm" variant="outline" className="bg-card" onClick={viewing.onTakeOver}>
            Take over editing
          </Button>
        </div>
      )}
      {/* Header */}
      <div className="border-b p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 eyebrow text-muted-foreground">
            {model.kind === "process" ? "Process map" : "Business model canvas"}
          </div>
          <h3 className="font-display text-xl truncate">{model.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {/* How sure each item is, in words with a thin bar (DESIGN 3.3).
              The percentages stay in each item's own details. */}
          <GradeBar summary={grades} className="min-w-[160px] max-w-[320px]" />
          {demoHints && (
            <DriftNotifier
              demo
              drifted={drifted}
              driftedNames={changedNames(model, drifted)}
              artifactTitle={model.title}
            />
          )}
          {extraHeaderRight}
        </div>
      </div>

      {demoHints && drifted && (
        <div className="flex items-start gap-3 border-b bg-drift/10 px-4 py-3 text-drift-ink">
          <AlertOctagon className="size-5 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-semibold">Drift: {changedWords}.</div>
            <p className="text-[13px] mt-0.5 text-drift-ink">
              {model.kind === "process"
                ? "A follow-up call revised the KYC path: high-risk customers now bypass Ops entirely and route to a new dedicated onboarding team."
                : "A follow-up call revealed the Revenue Streams block is stale."}
            </p>
          </div>
          <Button size="sm" variant="outline"
            className="bg-card text-foreground border-drift/40 hover:border-drift/60 hover:bg-card"
            onClick={editing.onClearDrift}>
            Restore source
          </Button>
        </div>
      )}

      <ArtifactFullscreenProvider value={fs}>
      <div
        ref={fsRef}
        className={cn(
          "flex-1 flex min-h-0 flex-col isolate",
          fs.active && "bg-background",
          fs.fallback && "fixed inset-0 z-[9999]",
        )}
        // Marks the fill-the-window fallback for the notice area and the
        // overlay host; Present mode hides editing controls below it.
        data-canvas-fs={fs.fallback ? "" : undefined}
        data-presenting={fs.presenting ? "" : undefined}
        tabIndex={-1}
      >
        <FullscreenHeader
          kindLabel={model.kind === "process" ? "Process map" : "Business model canvas"}
          title={model.title}
          summary={<GradeBar summary={grades} />}
          viewing={viewing}
          outdated={editing.outdated}
        />
        <div className="relative z-40 flex items-center gap-2 border-b bg-card px-4" data-no-pan data-fs-chrome-end>
          {/* Scrolls instead of overflowing -- with 11 tabs (7 diagram types plus
           *  Toolkit/Items/BRD/Traced backlog) this row is wider than the container
           *  at any normal viewport width. It used to just overflow silently with no
           *  scroll affordance, making Items/BRD/Traced backlog unreachable by click. */}
          <div
            role="tablist" aria-label="Artifact views"
            className="flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 scroll-px-1 [scrollbar-width:thin]"
          >
            {shownTabs.map((item) => {
              const active = tab === item.value;
              return (
                <button
                  key={item.value}
                  ref={active ? activeTabRef : undefined}
                  type="button" role="tab" aria-selected={active}
                  data-state={active ? "active" : "inactive"}
                  className={cn(
                    "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground shadow-sm",
                  )}
                  onClick={() => setTab(item.value)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {/* Outside the scrolling tab list on purpose: history applies to
           *  every tab, so it must not scroll away with the tabs. */}
          {!fs.presenting && (
          <div role="group" aria-label="Edit history" className="flex shrink-0 items-center gap-1.5 border-l pl-2">
            {/* aria-disabled, not disabled: a button that disables itself the
             *  moment it is used throws keyboard focus back to the top of the
             *  page. These stay focusable and just report there is nothing
             *  to step to. */}
            <Button
              size="icon" variant="ghost"
              className="relative h-8 w-8 before:absolute before:-inset-x-[3px] before:-inset-y-[6px] before:content-[''] aria-disabled:[&_svg]:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:cursor-default"
              onClick={() => runHistory("undo")} aria-disabled={!editing.canUndo}
              title="Undo last edit (Ctrl/Cmd+Z). Moving or resizing shapes is not included."
              aria-label="Undo last edit"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className="relative h-8 w-8 before:absolute before:-inset-x-[3px] before:-inset-y-[6px] before:content-[''] aria-disabled:[&_svg]:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:cursor-default"
              onClick={() => runHistory("redo")} aria-disabled={!editing.canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo"
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
          )}
        </div>

        <div className={cn("relative z-0 flex-1 min-h-0", fs.active ? "overflow-auto" : "overflow-hidden")} ref={canvasRef}>
          {tab === "artifact" && (
            <div className="h-full p-4">
              <div className={fs.active ? "h-full" : "h-[640px]"}>
                <RecoverableCanvas onRemoveLastAdded={editing.onRemoveLastAdded}>
                  {model.kind === "process" ? (
                    <ProcessCanvas
                      model={model}
                      onAddStep={editing.onAddStep}
                      onAddActor={editing.onAddActor}
                      onAddDecision={editing.onAddDecision}
                      onAddException={editing.onAddException}
                      onAddConnection={editing.onAddConnection}
                      onDeleteConnection={editing.onDeleteConnection}
                      onUpdateConnection={editing.onUpdateConnection}

                      onDeleteAny={editing.onDeleteAny}
                      onUpdateItem={editing.onUpdateItem}
                      onApplyRefinement={editing.onApplyRefinement}
                      onOpenUseCase={setDrilldownStepId}
                      onPlaceShapes={editing.onPlaceShapes}
                      onTidyUp={editing.onTidyUp}
                      canEdit={editing.canEdit}
                    />
                  ) : (
                    <BMCCanvas
                      model={model}
                      onAdd={editing.onAddBMC}
                      onDelete={(_, id) => editing.onDeleteAny(id)}
                      onUpdate={editing.onUpdateItem}
                      onSetBlockHeight={editing.onSetBlockHeight}
                      canEdit={editing.canEdit}
                    />
                  )}
                </RecoverableCanvas>
              </div>
            </div>
          )}

          {tab === "usecases" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className={fs.active ? "h-full" : "h-[640px]"}>
                <UseCaseDiagramView model={model} onSelectUseCase={setDrilldownStepId} />
              </div>
            </div>
          )}

          {tab === "raci" && model.kind === "process" && (
            <div className="h-full p-4">
              <RaciMatrixView model={model} onUpdateItem={editing.onUpdateItem} />
            </div>
          )}

          {tab === "dfd" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className={fs.active ? "h-full" : "h-[640px]"}>
                <DFDView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "decisiontree" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className={fs.active ? "h-full" : "h-[640px]"}>
                <DecisionTreeView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "statediagram" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className={fs.active ? "h-full" : "h-[640px]"}>
                <StateDiagramView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "activity" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className={fs.active ? "h-full" : "h-[640px]"}>
                <ActivityDiagramView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "toolkit" && (
            <div className="h-full overflow-auto p-4">
              <ToolkitPanel model={model} editing={editing} />
            </div>
          )}

          {tab === "items" && (
            <div className="p-4 space-y-4">
              {model.kind === "process" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <ItemGroup title="Actors" items={model.actors} onAdd={editing.onAddActor} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange} focusItemId={focusItemId} />
                  <ItemGroup title="Systems" items={model.systems} onAdd={editing.onAddSystem} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange} focusItemId={focusItemId} />
                  <ItemGroup title="Steps" items={model.steps} onAdd={editing.onAddStep} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange} focusItemId={focusItemId} />
                  <ItemGroup title="Decisions" items={model.decisions} onAdd={editing.onAddDecision} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange} focusItemId={focusItemId} />
                  <ItemGroup title="Exceptions" items={model.exceptions} onAdd={editing.onAddException} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange} focusItemId={focusItemId} />
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {model.blocks.map((b) => (
                    <div key={b.id} className="rounded-lg border bg-card p-3">
                      <h4 className="text-sm font-semibold mb-2">{b.title}</h4>
                      <EditableList
                        items={b.items}
                        onAdd={(t) => editing.onAddBMC(b.id, t)}
                        onDelete={(id) => editing.onDeleteAny(id)}
                        onEdit={(id, t) => editing.onUpdateItem(id, { text: t })}
                        compact showIds={false}
                        projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange}
                        focusItemId={focusItemId}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "downstream1" && (
            <div className="p-4">
              {model.kind === "process" ? (
                <BRDTab
                  m={model}
                  onAddNFR={editing.onAddNFR}
                  onDeleteAny={editing.onDeleteAny}
                  onUpdateItem={editing.onUpdateItem}
                />
              ) : <BriefTab m={model} />}
            </div>
          )}
          {tab === "downstream2" && (
            <div className="p-4">
              {model.kind === "process" ? (
                <BacklogTab m={model} onUpdateItem={editing.onUpdateItem} />
              ) : <QuestionsTab m={model} />}
            </div>
          )}
        </div>
        <ShortcutsCard />
        <LaserPointer hostRef={fsRef} />
      </div>
      {model.kind === "process" && (
        <UseCaseDescriptionDialog
          model={model}
          stepId={drilldownStepId}
          onOpenChange={(open) => { if (!open) setDrilldownStepId(null); }}
          onUpdateItem={editing.onUpdateItem}
        />
      )}
      </ArtifactFullscreenProvider>

      {(demoHints || onPublish) && (
      <div className="border-t bg-muted/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        {demoHints && (
        <div className="flex flex-wrap items-center gap-2">
          {/* The main action only while the hint points at it; it is the
              demo's next step then, and an ordinary button otherwise. */}
          <Button size="sm" variant={showDriftHint ? "default" : "outline"}
            onClick={drifted ? editing.onClearDrift : editing.onSimulateDrift}>
            <Shuffle className="size-3.5" />
            {drifted ? "Restore source" : "Simulate source change"}
          </Button>
          {drifted && (
            <span className="inline-flex items-center gap-1 rounded-md bg-drift/10 px-2 py-0.5 text-xs font-medium text-drift-ink">
              <AlertOctagon className="size-3" aria-hidden /> {changedWords}
            </span>
          )}
          {showDriftHint && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs text-foreground">
              Now the part nobody else does — see what happens when the client changes their mind.
              <button
                type="button" onClick={() => setHintDismissed(true)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss hint"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          )}
        </div>
        )}
        {onPublish && (
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {/* The strings passed to onPublish are routing keys the callers
              compare ("Share link", "Export"); only the labels changed. */}
          <Button size="sm" variant="outline" onClick={() => onPublish("Share link")}>
            <Share2 className="size-3.5" /> Share a link
          </Button>
          <Button size="sm" variant="outline" onClick={() => onPublish("Export")}>
            <FileDown className="size-3.5" /> {exportLabel}
          </Button>
        </div>
        )}
      </div>
      )}
    </div>
    </CanvasViewStoreProvider>
  );
}

/** The canvas error boundary, plus the one thing only a child of the view
 *  store can do for it: on recovery, forget the parked layout (positions,
 *  sizes, palette) so the canvas really does come back clean. The camera
 *  entries ("shell:…") are kept; where the person was looking is harmless. */
function RecoverableCanvas({ onRemoveLastAdded, children }: { onRemoveLastAdded: () => void; children: ReactNode }) {
  const store = useCanvasViewStore();
  const forgetLayout = () => {
    if (!store) return;
    for (const key of [...store.keys()]) if (!key.startsWith("shell:")) store.delete(key);
  };
  return (
    <CanvasErrorBoundary onRemoveLastAdded={onRemoveLastAdded} onRecover={forgetLayout}>
      {children}
    </CanvasErrorBoundary>
  );
}

function ItemGroup({ title, items, onAdd, onDelete, onEdit, projectId, commentCounts, onCommentCountChange, focusItemId }: {
  title: string; items: BaseItem[];
  onAdd: (t: string) => void;
  onDelete: (id: string) => void;
  onEdit?: (id: string, t: string) => void;
  projectId?: string;
  commentCounts?: Record<string, number>;
  onCommentCountChange?: (itemId: string, delta: number) => void;
  focusItemId?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-[10px] font-mono-tight text-muted-foreground">{items.length}</span>
      </div>
      <EditableList
        items={items} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} compact
        projectId={projectId} commentCounts={commentCounts} onCommentCountChange={onCommentCountChange}
        focusItemId={focusItemId}
      />
    </div>
  );
}

/** The items graded "Source changed", by name, for the demo's drift alert.
 *  Same rule as the header bar and the item chips (grade.ts). */
function changedNames(model: ArtifactModel, drifted: boolean): string[] {
  if (!drifted) return [];
  const changed = (i: BaseItem) => gradeOf(i).grade === "changed";
  if (model.kind === "process") {
    return [
      ...model.actors.filter(changed).map((a) => a.text),
      ...model.systems.filter(changed).map((s) => s.text),
      ...model.steps.filter(changed).map((s) => s.text),
      ...model.decisions.filter(changed).map((d) => `Decision: ${d.text}`),
      ...model.exceptions.filter(changed).map((e) => `Exception: ${e.text}`),
    ];
  }
  return model.blocks.flatMap((b) => b.items.filter(changed).map((i) => `${b.title}: ${i.text}`));
}

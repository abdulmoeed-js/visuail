import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Sparkles, RotateCcw, AlertOctagon, Share2, FileDown,
  LayoutList, Shuffle, ShieldCheck, Loader2, Info,
  FolderOpen, X as XIcon, Undo2, Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SAMPLES, stats, driftSummary,
  type ArtifactModel, type Sample, type BaseItem,
} from "@/data/samples";
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
import { TemplateGallery } from "./workbench/TemplateGallery";
import { Link } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";
import { type ProjectResult } from "./workbench/IntakeWizard";
import { ProjectView } from "./workbench/ProjectView";
import { SignupWallModal } from "./SignupWallModal";
import { useArtifactEditing, type ArtifactEditing } from "@/lib/artifact-editing";
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
      const refusal = checkRefusal(rawModel);
      if (refusal.refuse) {
        setState({ status: "refused", reason: refusal.reason! });
        return;
      }
      const model = verifyGrounding(rawModel!, transcript);
      editing.reset(model);
      setState({ status: "ready" });
    }, 900);
  };

  const openWall = (action: string) => { setWallAction(action); setWallOpen(true); };
  const s = state.status === "ready" ? stats(editing.model) : null;

  // Project mode short-circuits the single-source workbench UI.
  if (project) {
    return (
      <section id="workbench" className="mx-auto max-w-[1400px] px-4 pb-24">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-mono-tight uppercase tracking-widest text-primary">
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
          <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">
            No signup to start
          </div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Try it on a real transcript.</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-xl">
            Upload real files, or paste a transcript.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to="/new">
            <Button variant="default" size="sm" className="h-8 gap-1.5">
              <FolderPlus className="size-3.5" /> New project
            </Button>
          </Link>
          <TemplateGallery onPick={loadSample} />
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          {SAMPLES.map((sm) => (
            <button
              key={sm.id}
              onClick={() => loadSample(sm)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition",
                activeSample.id === sm.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted",
              )}
              title={sm.blurb}
            >
              {sm.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
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
            placeholder="Paste your discovery call transcript here…"
            className="min-h-[380px] font-mono-tight text-xs leading-relaxed resize-y"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={extract}
              disabled={state.status === "extracting"}
              className="flex-1 h-10"
            >
              {state.status === "extracting" ? (
                <><Loader2 className="animate-spin size-4" /> Extracting…</>
              ) : (
                <><Sparkles className="size-4" /> Extract artifact</>
              )}
            </Button>
            <Button variant="ghost" size="icon" title="Reset"
              onClick={() => { loadSample(activeSample); }}>
              <RotateCcw className="size-4" />
            </Button>
          </div>
          <div className="rounded-md bg-muted/60 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
            <div className="flex items-start gap-1.5">
              <Info className="size-3.5 mt-0.5 shrink-0" />
              <span>
                Nothing you paste or upload leaves your browser.
              </span>
            </div>
          </div>
        </div>

        {/* Artifact panel */}
        <div className="rounded-xl border bg-card min-h-[560px] flex flex-col">
          {state.status === "empty" && <EmptyState onClick={extract} />}
          {state.status === "extracting" && <ExtractingState />}
          {state.status === "refused" && <RefusedState reason={state.reason} onRetry={() => setState({ status: "empty" })} />}
          {state.status === "ready" && s && (
            <ArtifactView editing={editing} stats={s} onPublish={openWall} demoHints />
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
      <div className="rounded-full border bg-card px-3 py-1 text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
        Artifact panel
      </div>
      <h3 className="font-display text-2xl max-w-md">
        Your typed artifact will render here — not a shape library, a model.
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Pick a sample and press <strong>Extract</strong>, or click <strong>New project</strong> to upload real PDF/DOCX files. Nothing leaves your browser.
      </p>
      <Button onClick={onClick} className="mt-2"><Sparkles className="size-4" /> Extract artifact</Button>
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
        {["Reading the transcript…", "Finding actors, steps and decisions…", "Scoring how sure it is about each one…", "Flagging anything the source didn't actually say…"].map((t, i) => (
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
      <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-unresolved bg-unresolved/10 text-[color:var(--unresolved-foreground)]">
        <ShieldCheck className="size-5" />
      </div>
      <div className="max-w-md space-y-1.5">
        <div className="text-[10px] font-mono-tight uppercase tracking-widest text-unresolved">
          Refused — not enough structure to draw safely
        </div>
        <h3 className="font-display text-xl">visu didn't extract this one.</h3>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
      <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground max-w-md text-left">
        <strong className="text-foreground">Why this matters:</strong> most tools would happily
        fabricate a three-box diagram from a single sentence. visu refuses when a model would
        require guessing — and shows you why.
      </div>
      <Button variant="outline" onClick={onRetry}>Back to source</Button>
    </div>
  );
}

/** The ArtifactView the person last clicked or focused in. More than one can
 *  be mounted at once (project mode), and Ctrl/Cmd+Z must only ever act on
 *  the one they are working in. */
let activeArtifactRoot: HTMLElement | null = null;

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
) {
  const { action } = extra;
  if (lastHistoryToast !== undefined) toast.dismiss(lastHistoryToast);
  lastHistoryToast = toast(title, {
    description: extra.description,
    action: action && {
      label: action.label,
      onClick: (e) => {
        // A mouse click leaves focus on this button, inside the toaster.
        // sonner remembers what had focus before and hands it back the next
        // time focus leaves -- which is the person's next click, so that
        // click (into a text field, say) lost its focus. Letting go now
        // makes the hand-back happen here instead. A keyboard press keeps
        // focus, so the button can be pressed again.
        if (e.detail > 0) e.currentTarget.blur();
        action.onClick();
      },
    },
  });
}

/**
 * ArtifactView — renders a single artifact model with all editing controls,
 * downstream tabs, and publish/export actions. Extracted so the multi-canvas
 * project view can reuse the exact same UI per artifact.
 */
export function ArtifactView({
  editing, stats: st, onPublish, canvasRef, extraHeaderRight,
  projectId, commentCounts, onCommentCountChange, focusItemId, initialTab, demoHints,
}: {
  editing: ArtifactEditing;
  stats: ReturnType<typeof stats>;
  onPublish: (action: string) => void;
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
   *  they have no reason to click. This surfaces a one-time nudge toward it.
   *  Never set on the real project page or the share page. */
  demoHints?: boolean;
}) {
  const { model, drifted } = editing;
  const avgPct = Math.round(st.avg * 100);
  const avgTone = avgPct >= 85 ? "text-confident" : avgPct >= 70 ? "text-unresolved" : "text-drift";
  const drift = drifted ? driftSummary(model) : { count: 0, label: "" };
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
  // Created here rather than inside the provider below, because the undo
  // handler in this component needs to read it too.
  const viewStore = useNewCanvasViewStore();
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; });

  /** Undo or redo, and say what it did. The edit being stepped over is often
   *  in another tab or off-screen; done silently, undo either looks broken
   *  or removes something the person never sees go. */
  const runHistory = useCallback((direction: "undo" | "redo") => {
    const ed = editingRef.current;
    const other = direction === "undo" ? "redo" : "undo";
    // Undo steps through edits to the content, not through where shapes sit.
    // If the last thing done was a drag or resize, the person is asking to
    // undo THAT -- reverting some older edit instead would be a nasty
    // surprise. Say so once; the next press steps back as normal.
    if (direction === "undo" && viewStore.get(LAYOUT_MOVED_KEY) === ed.model) {
      viewStore.delete(LAYOUT_MOVED_KEY);
      historyToast("Moving or resizing a shape can't be undone", {
        description: ed.canUndo ? "Undo again to step back through your edits instead." : undefined,
      });
      return;
    }
    const summary = direction === "undo" ? ed.onUndo() : ed.onRedo();
    if (!summary) {
      historyToast(
        direction === "redo" ? "Nothing to redo"
          : ed.undoClearedByPeer ? "Undo history was cleared when someone else edited this"
          : "Nothing to undo",
      );
      return;
    }
    historyToast(historyNotice(direction, summary), {
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
      // Focus must be somewhere that belongs to this artifact: inside it, on
      // nothing in particular, on the history notice itself (its Undo/Redo
      // button keeps focus after a click), or inside this artifact's canvas
      // while the CSS-fallback fullscreen has moved that canvas to <body>.
      const el = t instanceof Element ? t : null;
      const ours = t === document.body || (t instanceof Node && root.contains(t))
        || !!el?.closest("[data-sonner-toaster], [data-canvas-fs]");
      if (!ours) return;
      e.preventDefault();
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
    <div ref={rootRef} className="flex-1 flex flex-col">
      {/* Header */}
      <div className="border-b p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
            {model.kind === "process" ? "PROCESS MAP" : "BUSINESS MODEL CANVAS"}
          </div>
          <h3 className="font-display text-xl truncate">{model.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <MetricBlock label="Items" value={String(st.count)} />
          <MetricBlock label="Unresolved" value={String(st.unresolved)} tone={st.unresolved ? "warn" : undefined} />
          <div className="min-w-[140px]">
            <div className="flex items-center justify-between text-[10px] font-mono-tight text-muted-foreground">
              <span>CONFIDENCE</span>
              <span className={cn("font-semibold", avgTone)}>{avgPct}%</span>
            </div>
            <Progress value={avgPct} className="h-1.5 mt-1" />
          </div>
          <DriftNotifier
            drifted={drifted}
            driftedNames={driftedNames(model, drifted)}
            artifactTitle={model.title}
          />
          {extraHeaderRight}
        </div>
      </div>

      {drifted && (
        <div className="flex items-start gap-3 border-b bg-drift/10 px-4 py-3 text-drift">
          <AlertOctagon className="size-5 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-semibold">Source of truth drifted — {drift.label}.</div>
            <p className="text-[13px] mt-0.5 text-drift/90">
              {model.kind === "process"
                ? "A follow-up call revised the KYC path: high-risk customers now bypass Ops entirely and route to a new dedicated onboarding team."
                : "A follow-up call revealed the Revenue Streams block is stale."}
            </p>
          </div>
          <Button size="sm" variant="outline"
            className="bg-card text-foreground border-drift/40 hover:bg-card"
            onClick={editing.onClearDrift}>
            Reconcile
          </Button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 flex-col isolate">
        <div className="relative z-40 flex items-center gap-2 border-b bg-card px-4" data-no-pan>
          {/* Scrolls instead of overflowing -- with 11 tabs (7 diagram types plus
           *  Toolkit/Items/BRD/Traced backlog) this row is wider than the container
           *  at any normal viewport width. It used to just overflow silently with no
           *  scroll affordance, making Items/BRD/Traced backlog unreachable by click. */}
          <div
            role="tablist" aria-label="Artifact views"
            className="flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:thin]"
          >
            {tabs.map((item) => {
              const active = tab === item.value;
              return (
                <button
                  key={item.value}
                  ref={active ? activeTabRef : undefined}
                  type="button" role="tab" aria-selected={active}
                  data-state={active ? "active" : "inactive"}
                  className={cn(
                    "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          <div role="group" aria-label="Edit history" className="flex shrink-0 items-center gap-1.5 border-l pl-2">
            {/* aria-disabled, not disabled: a button that disables itself the
             *  moment it is used throws keyboard focus back to the top of the
             *  page. These stay focusable and just report there is nothing
             *  to step to. */}
            <Button
              size="icon" variant="ghost"
              className="relative h-8 w-8 before:absolute before:-inset-x-[3px] before:-inset-y-[6px] before:content-[''] aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:cursor-default"
              onClick={() => runHistory("undo")} aria-disabled={!editing.canUndo}
              title="Undo last edit (Ctrl/Cmd+Z). Moving or resizing shapes is not included."
              aria-label="Undo last edit"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className="relative h-8 w-8 before:absolute before:-inset-x-[3px] before:-inset-y-[6px] before:content-[''] aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:cursor-default"
              onClick={() => runHistory("redo")} aria-disabled={!editing.canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo"
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
        </div>

        <div className="relative z-0 flex-1 min-h-0 overflow-hidden" ref={canvasRef}>
          {tab === "artifact" && (
            <div className="h-full p-4">
              <div className="h-[640px]">
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
                    />
                  ) : (
                    <BMCCanvas
                      model={model}
                      onAdd={editing.onAddBMC}
                      onDelete={(_, id) => editing.onDeleteAny(id)}
                      onUpdate={editing.onUpdateItem}
                    />
                  )}
                </RecoverableCanvas>
              </div>
            </div>
          )}

          {tab === "usecases" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className="h-[640px]">
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
              <div className="h-[640px]">
                <DFDView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "decisiontree" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className="h-[640px]">
                <DecisionTreeView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "statediagram" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className="h-[640px]">
                <StateDiagramView model={model} editing={editing} />
              </div>
            </div>
          )}

          {tab === "activity" && model.kind === "process" && (
            <div className="h-full p-4">
              <div className="h-[640px]">
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
      </div>

      {model.kind === "process" && (
        <UseCaseDescriptionDialog
          model={model}
          stepId={drilldownStepId}
          onOpenChange={(open) => { if (!open) setDrilldownStepId(null); }}
          onUpdateItem={editing.onUpdateItem}
        />
      )}

      <div className="border-t bg-muted/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={drifted ? "secondary" : showDriftHint ? "default" : "outline"}
            onClick={drifted ? editing.onClearDrift : editing.onSimulateDrift}>
            <Shuffle className="size-3.5" />
            {drifted ? "Restore source" : "Simulate source change"}
          </Button>
          {drifted && <Badge variant="destructive" className="bg-drift">{drift.count} drifted</Badge>}
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono-tight text-muted-foreground mr-1">PUBLISH</span>
          <Button size="sm" variant="outline" onClick={() => onPublish("Share link")}>
            <Share2 className="size-3.5" /> Share link
          </Button>
          <Button size="sm" onClick={() => onPublish("Export")}>
            <FileDown className="size-3.5" /> Export
          </Button>
        </div>
      </div>
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

function MetricBlock({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <div className="text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-display leading-none mt-0.5", tone === "warn" && "text-unresolved")}>
        {value}
      </div>
    </div>
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

function driftedNames(model: ArtifactModel, drifted: boolean): string[] {
  if (!drifted) return [];
  if (model.kind === "process") {
    return [
      ...model.steps.filter((s) => s.drift).map((s) => s.text),
      ...model.decisions.filter((d) => d.drift).map((d) => `Decision: ${d.text}`),
    ];
  }
  return model.blocks.filter((b) => b.blockDrift).map((b) => b.title);
}

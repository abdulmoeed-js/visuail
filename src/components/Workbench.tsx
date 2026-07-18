import { useState, useMemo, type ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Sparkles, RotateCcw, AlertOctagon, Share2, FileDown,
  ExternalLink, LayoutList, Shuffle, ShieldCheck, Loader2, Info,
  FolderOpen, X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SAMPLES, stats, driftSummary,
  type ArtifactModel, type Sample, type BaseItem,
} from "@/data/samples";
import { EditableList } from "./workbench/EditableList";
import { ProcessCanvas } from "./workbench/ProcessCanvas";
import { BMCCanvas } from "./workbench/BMCCanvas";
import { BRDTab, BacklogTab, BriefTab, QuestionsTab } from "./workbench/DownstreamTabs";
import { DriftNotifier } from "./workbench/DriftNotifier";
import { TemplateGallery } from "./workbench/TemplateGallery";
import { Link } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";
import { type ProjectResult } from "./workbench/IntakeWizard";
import { ProjectView } from "./workbench/ProjectView";
import { SignupWallModal } from "./SignupWallModal";
import { useArtifactEditing, type ArtifactEditing } from "@/lib/artifact-editing";

type State =
  | { status: "empty" }
  | { status: "extracting" }
  | { status: "refused"; reason: string }
  | { status: "ready" };

type ArtifactTab = "artifact" | "items" | "downstream1" | "downstream2";

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
    if (transcript.trim().length < 120 || activeSample.id === "thin") {
      setState({ status: "extracting" });
      setTimeout(() => {
        setState({
          status: "refused",
          reason:
            "This input doesn't contain enough structure — actors, steps, or system references — to build a safe artifact. A blank canvas beats a confidently wrong diagram.",
        });
      }, 700);
      return;
    }
    setState({ status: "extracting" });
    setTimeout(() => {
      const model = activeSample.build();
      if (!model) { setState({ status: "refused", reason: "Sample intentionally unbuildable." }); return; }
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
            The workbench · No signup
          </div>
          <h2 className="font-display text-3xl md:text-4xl mt-1">Try it on a real transcript.</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-xl">
            Start a project with real files, or paste a transcript to try the workbench.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <IntakeWizard onComplete={setProject} />
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
                Nothing you paste — or upload via New project — leaves your browser in this demo.
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
            <ArtifactView editing={editing} stats={s} onPublish={openWall} />
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
        {["Tokenizing transcript…", "Building typed IR…", "Scoring confidence per item…", "Rendering artifact…"].map((t, i) => (
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
        <h3 className="font-display text-xl">Visuail didn't extract this one.</h3>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </div>
      <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground max-w-md text-left">
        <strong className="text-foreground">Why this matters:</strong> most tools would happily
        fabricate a three-box diagram from a single sentence. Visuail refuses when a model would
        require guessing — and shows you why.
      </div>
      <Button variant="outline" onClick={onRetry}>Back to source</Button>
    </div>
  );
}

/**
 * ArtifactView — renders a single artifact model with all editing controls,
 * downstream tabs, and publish/export actions. Extracted so the multi-canvas
 * project view can reuse the exact same UI per artifact.
 */
export function ArtifactView({
  editing, stats: st, onPublish, canvasRef, extraHeaderRight,
}: {
  editing: ArtifactEditing;
  stats: ReturnType<typeof stats>;
  onPublish: (action: string) => void;
  canvasRef?: React.RefObject<HTMLDivElement>;
  extraHeaderRight?: ReactNode;
}) {
  const { model, drifted } = editing;
  const avgPct = Math.round(st.avg * 100);
  const avgTone = avgPct >= 85 ? "text-confident" : avgPct >= 70 ? "text-unresolved" : "text-drift";
  const drift = drifted ? driftSummary(model) : { count: 0, label: "" };
  const [tab, setTab] = useState<ArtifactTab>("artifact");

  const tabs: { value: ArtifactTab; label: ReactNode }[] = [
    { value: "artifact", label: model.kind === "process" ? "Process map" : "Canvas" },
    { value: "items", label: <><LayoutList className="size-3.5" /> Items</> },
    { value: "downstream1", label: model.kind === "process" ? "BRD" : "Summary brief" },
    { value: "downstream2", label: model.kind === "process" ? "Traced backlog" : "Open questions" },
  ];

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="border-b p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
            {model.kind === "process" ? "PROCESS MAP" : "BUSINESS MODEL CANVAS"} · v1
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
        <div className="relative z-40 border-b bg-card px-4" data-no-pan>
          <div role="tablist" aria-label="Artifact views" className="flex h-11 items-center gap-1">
            {tabs.map((item) => {
              const active = tab === item.value;
              return (
                <button
                  key={item.value}
                  type="button" role="tab" aria-selected={active}
                  data-state={active ? "active" : "inactive"}
                  className={cn(
                    "inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-muted text-foreground shadow-sm",
                  )}
                  onClick={() => setTab(item.value)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative z-0 flex-1 min-h-0 overflow-hidden" ref={canvasRef}>
          {tab === "artifact" && (
            <div className="h-full p-4">
              <div className="h-[640px]">
                {model.kind === "process" ? (
                  <ProcessCanvas
                    model={model}
                    onAddStep={editing.onAddStep}
                    onDeleteAny={editing.onDeleteAny}
                    onUpdateItem={editing.onUpdateItem}
                    onApplyRefinement={editing.onApplyRefinement}
                  />
                ) : (
                  <BMCCanvas
                    model={model}
                    onAdd={editing.onAddBMC}
                    onDelete={(_, id) => editing.onDeleteAny(id)}
                    onUpdate={editing.onUpdateItem}
                  />
                )}
              </div>
            </div>
          )}

          {tab === "items" && (
            <div className="p-4 space-y-4">
              {model.kind === "process" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <ItemGroup title="Actors" items={model.actors} onAdd={editing.onAddActor} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} />
                  <ItemGroup title="Systems" items={model.systems} onAdd={editing.onAddSystem} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} />
                  <ItemGroup title="Steps" items={model.steps} onAdd={editing.onAddStep} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} />
                  <ItemGroup title="Decisions" items={model.decisions} onAdd={editing.onAddDecision} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} />
                  <ItemGroup title="Exceptions" items={model.exceptions} onAdd={editing.onAddException} onDelete={editing.onDeleteAny} onEdit={(id, t) => editing.onUpdateItem(id, { text: t })} />
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
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "downstream1" && (
            <div className="p-4">
              {model.kind === "process" ? <BRDTab m={model} /> : <BriefTab m={model} />}
            </div>
          )}
          {tab === "downstream2" && (
            <div className="p-4">
              {model.kind === "process" ? <BacklogTab m={model} /> : <QuestionsTab m={model} />}
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-muted/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={drifted ? "secondary" : "outline"}
            onClick={drifted ? editing.onClearDrift : editing.onSimulateDrift}>
            <Shuffle className="size-3.5" />
            {drifted ? "Restore source" : "Simulate source change"}
          </Button>
          {drifted && <Badge variant="destructive" className="bg-drift">{drift.count} drifted</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono-tight text-muted-foreground mr-1">PUBLISH</span>
          <Button size="sm" variant="outline" onClick={() => onPublish("Share link")}>
            <Share2 className="size-3.5" /> Share link
          </Button>
          <Button size="sm" variant="outline" onClick={() => onPublish("Push to Confluence")}>
            <ExternalLink className="size-3.5" /> Push to Confluence
          </Button>
          <Button size="sm" variant="outline" onClick={() => onPublish("Push to Jira")}>
            <ExternalLink className="size-3.5" /> Push to Jira
          </Button>
          <Button size="sm" onClick={() => onPublish("Export")}>
            <FileDown className="size-3.5" /> Export
          </Button>
        </div>
      </div>
    </div>
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

function ItemGroup({ title, items, onAdd, onDelete, onEdit }: {
  title: string; items: BaseItem[];
  onAdd: (t: string) => void;
  onDelete: (id: string) => void;
  onEdit?: (id: string, t: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-[10px] font-mono-tight text-muted-foreground">{items.length}</span>
      </div>
      <EditableList items={items} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} compact />
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

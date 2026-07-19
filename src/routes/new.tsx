import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ChevronRight, ChevronLeft, Workflow, LayoutGrid, FileText, LibraryBig,
  PenLine, Loader2, Sparkles, Check, ArrowLeft, FolderPlus,
} from "lucide-react";
import { SourceIntake, makeSource, type SourceDraft } from "@/components/workbench/SourceIntake";
import { extractFromSource, type ArtifactKind } from "@/lib/extract";
import { mergeByKind } from "@/lib/merge";
import { checkRefusal } from "@/lib/refusal";
import { SAMPLES } from "@/data/samples";
import type { ArtifactModel } from "@/data/samples";
import { emptyCanvas } from "@/lib/empty-models";
import { sessionStore, useSession } from "@/lib/session";
import { SignupWallModal } from "@/components/SignupWallModal";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "New project — Visuail" },
      { name: "description", content: "Create a new Visuail project." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewProjectPage,
});

type Step = 1 | 2 | 3;
type StartMode = "sources" | "template" | "scratch";

interface TemplateChoice {
  id: string;
  label: string;
  desc: string;
  sampleId: string;
  kind: ArtifactKind;
}

const TEMPLATES: TemplateChoice[] = [
  { id: "onboarding", label: "Client onboarding process", desc: "Ops walkthrough → typed process map with actors, systems, exceptions.", sampleId: "banking", kind: "process" },
  { id: "discovery", label: "Discovery call → BMC", desc: "Founder interview → 9-block Business Model Canvas.", sampleId: "haulpilot", kind: "bmc" },
  { id: "compliance", label: "Compliance / approval workflow", desc: "Decision branches, exceptions, and hand-offs across teams.", sampleId: "banking", kind: "process" },
  { id: "validate", label: "Validate a business idea", desc: "Pressure-test a pitch against the 9 BMC blocks.", sampleId: "haulpilot", kind: "bmc" },
];

function NewProjectPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  // Step 2
  const [kinds, setKinds] = useState<ArtifactKind[]>(["process"]);

  // Step 3
  const [mode, setMode] = useState<StartMode>("sources");
  const [sources, setSources] = useState<SourceDraft[]>([makeSource(0)]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capCheck = sessionStore.canCreateProject(session.projects.length, session.tier);
  const canContinue1 = name.trim().length > 0;
  const canContinue2 = kinds.length > 0;

  const toggleKind = (k: ArtifactKind) =>
    setKinds(cur => cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);

  const readySources = useMemo(
    () => sources.filter(s => s.status === "ready" && s.text.trim().length > 0),
    [sources],
  );

  const canCreate = (() => {
    if (mode === "sources") return readySources.length >= 1 && kinds.length >= 1;
    if (mode === "template") return !!templateId && kinds.length >= 1;
    return kinds.length >= 1;
  })();

  const create = async () => {
    if (!capCheck.ok) { setError(capCheck.reason ?? "Project limit reached."); return; }
    setCreating(true);
    setError(null);
    await new Promise(r => setTimeout(r, mode === "sources" ? 600 : 200));

    let canvases: { kind: ArtifactKind; model: ArtifactModel }[] = [];
    let storedSources: { label: string; text: string; origin: "paste" | "upload" | "scratch"; filename?: string }[] = [];
    let fromScratch = false;

    if (mode === "sources") {
      let perSource: { label: string; results: Awaited<ReturnType<typeof extractFromSource>> }[];
      try {
        perSource = await Promise.all(readySources.map(async (s, i) => ({
          label: s.label,
          results: await extractFromSource({ label: s.label, text: s.text, index: i }, kinds),
        })));
      } catch (err) {
        setCreating(false);
        setError(err instanceof Error ? err.message : "Extraction failed. Try again.");
        return;
      }
      let refusalReason: string | null = null;
      for (const kind of kinds) {
        const models: ArtifactModel[] = [];
        const labels: string[] = [];
        for (const { label, results } of perSource) {
          const hit = results.find(r => r.kind === kind);
          if (hit) { models.push(hit.model); labels.push(label); }
        }
        if (models.length === 0) continue;
        const merged = mergeByKind(models, labels);
        if (!merged) continue;
        const refusal = checkRefusal(merged);
        if (refusal.refuse) { refusalReason ??= refusal.reason ?? null; continue; }
        canvases.push({ kind, model: merged });
      }
      storedSources = readySources.map(s => ({
        label: s.label, text: s.text, origin: s.origin, filename: s.filename,
      }));
      if (canvases.length === 0) {
        setCreating(false);
        setError(
          refusalReason ??
          "Not enough structure in these sources to build the selected artifact(s). Try longer or more detailed inputs.",
        );
        return;
      }
    } else if (mode === "template" && templateId) {
      const tpl = TEMPLATES.find(t => t.id === templateId);
      const sample = tpl && SAMPLES.find(s => s.id === tpl.sampleId);
      const built = sample?.build();
      if (built) {
        for (const kind of kinds) {
          if (built.kind === kind) {
            canvases.push({ kind, model: structuredClone(built) });
          } else {
            canvases.push({ kind, model: emptyCanvas(kind, name.trim()) });
          }
        }
        storedSources = sample ? [{ label: "Template transcript", text: sample.transcript, origin: "paste" }] : [];
      }
    } else {
      // scratch
      fromScratch = true;
      canvases = kinds.map(kind => ({ kind, model: emptyCanvas(kind, name.trim()) }));
      storedSources = [];
    }

    if (!session.userId || !session.currentOrgId) {
      setCreating(false);
      setError("You need to be signed in to create a project.");
      return;
    }
    try {
      const project = await sessionStore.createProject(session.currentOrgId, session.userId, {
        name: name.trim(),
        description: desc.trim() || undefined,
        kinds,
        sources: storedSources,
        canvases,
        fromScratch,
      });
      if (canvases.length > 0) {
        // Best-effort -- a missed first snapshot isn't worth blocking project creation over.
        sessionStore.saveSnapshot(project.id, canvases, "manual_save", session.userId).catch(() => {});
      }
      navigate({ to: "/project/$id", params: { id: project.id } });
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : "Couldn't create this project. Try again.");
    }
  };

  const [signInOpen, setSignInOpen] = useState(false);

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

  if (!session.signedIn) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Nav />
        <main className="mx-auto max-w-3xl px-4 pt-24 text-center">
          <h1 className="font-display text-2xl">Sign in to start a project.</h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
            Projects are tied to your account now, so they follow you across devices.
          </p>
          <Button className="mt-6" onClick={() => setSignInOpen(true)}>Sign in</Button>
        </main>
        <SignupWallModal open={signInOpen} onOpenChange={setSignInOpen} action="Sign in" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-24">
        <div className="mb-8">
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="size-3.5" /> Back to dashboard
          </Link>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono-tight uppercase tracking-widest text-primary">
                New project
              </div>
              <h1 className="font-display text-3xl mt-1">
                {step === 1 && "Name your project"}
                {step === 2 && "Pick your artifacts"}
                {step === 3 && "Choose a starting point"}
              </h1>
            </div>
            <StepRail step={step} />
          </div>
        </div>

        {!capCheck.ok && (
          <div className="mb-4 rounded-lg border border-drift/40 bg-drift/5 p-3 text-sm text-drift">
            {capCheck.reason} <Link to="/dashboard" className="underline">Manage projects</Link>.
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6">
            <div className="space-y-1.5">
              <label className="text-xs font-mono-tight uppercase tracking-widest text-muted-foreground">
                Project / product name
              </label>
              <Input
                autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Acme Bank — onboarding overhaul"
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono-tight uppercase tracking-widest text-muted-foreground">
                Short description <span className="text-muted-foreground/70 normal-case">(optional)</span>
              </label>
              <Textarea
                value={desc} onChange={e => setDesc(e.target.value)}
                placeholder="One line to help you find this later."
                className="min-h-[80px]"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button disabled={!canContinue1} onClick={() => setStep(2)}>
                Continue <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5 rounded-2xl border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              What should Visuail build for this project?
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <KindCard
                active={kinds.includes("process")} onToggle={() => toggleKind("process")}
                icon={<Workflow className="size-4" />} title="Process map"
                desc="Actors, steps, decisions, exceptions." />
              <KindCard
                active={kinds.includes("bmc")} onToggle={() => toggleKind("bmc")}
                icon={<LayoutGrid className="size-4" />} title="Business Model Canvas"
                desc="9 classic blocks with confidence per item." />
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="size-4" /> Back
              </Button>
              <Button disabled={!canContinue2} onClick={() => setStep(3)}>
                Continue <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <ModeCard
                active={mode === "sources"} onSelect={() => setMode("sources")}
                icon={<FileText className="size-4" />} title="Paste / upload sources"
                desc="Extract from transcripts, PDFs, or DOCX." />
              <ModeCard
                active={mode === "template"} onSelect={() => setMode("template")}
                icon={<LibraryBig className="size-4" />} title="Start from a template"
                desc="Pre-filled sample to explore the workbench." />
              <ModeCard
                active={mode === "scratch"} onSelect={() => setMode("scratch")}
                icon={<PenLine className="size-4" />} title="Start from scratch"
                desc="Empty canvas — add items yourself." />
            </div>

            <div className="rounded-2xl border bg-card p-6">
              {mode === "sources" && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Nothing you paste or upload leaves your browser.
                  </p>
                  <SourceIntake sources={sources} onChange={setSources} />
                </div>
              )}
              {mode === "template" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={cn(
                        "text-left rounded-lg border p-3 transition",
                        templateId === t.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "bg-card hover:bg-muted/60",
                      )}
                    >
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        {t.kind === "process" ? <Workflow className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                        {t.label}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{t.desc}</div>
                    </button>
                  ))}
                </div>
              )}
              {mode === "scratch" && (
                <div className="text-sm text-muted-foreground">
                  We'll create an empty {kinds.length === 1 ? "canvas" : "set of canvases"} for{" "}
                  <strong>
                    {kinds.map(k => k === "process" ? "Process map" : "BMC").join(" + ")}
                  </strong>.
                  You can add sources anytime from inside the project.
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-drift/40 bg-drift/5 p-3 text-sm text-drift">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ChevronLeft className="size-4" /> Back
              </Button>
              <Button disabled={!canCreate || creating || !capCheck.ok} onClick={create}>
                {creating
                  ? <><Loader2 className="size-4 animate-spin" /> Creating…</>
                  : <><Sparkles className="size-4" /> Create project</>}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StepRail({ step }: { step: Step }) {
  const items = [1, 2, 3];
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono-tight uppercase tracking-widest">
      {items.map(i => (
        <div key={i} className={cn(
          "h-6 w-6 rounded-full grid place-items-center border",
          i < step && "bg-primary/10 border-primary/40 text-primary",
          i === step && "bg-primary text-primary-foreground border-primary",
          i > step && "text-muted-foreground",
        )}>
          {i < step ? <Check className="size-3" /> : i}
        </div>
      ))}
    </div>
  );
}

function KindCard({ active, onToggle, icon, title, desc }: {
  active: boolean; onToggle: () => void; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-left transition cursor-pointer",
        active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "bg-card hover:bg-muted/60",
      )}
    >
      <Checkbox checked={active} onCheckedChange={onToggle} className="mt-0.5" onClick={(e) => e.stopPropagation()} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {icon} {title}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

function ModeCard({ active, onSelect, icon, title, desc }: {
  active: boolean; onSelect: () => void; icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-left rounded-xl border p-4 transition",
        active ? "border-primary bg-primary/5 ring-1 ring-primary/30 shadow-sm" : "bg-card hover:bg-muted/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        {icon} {title}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{desc}</div>
    </button>
  );
}

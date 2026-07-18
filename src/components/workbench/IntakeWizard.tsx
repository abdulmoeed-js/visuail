import { useCallback, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FolderPlus, Workflow, LayoutGrid, Upload, FileText, Type as TypeIcon,
  Trash2, Plus, Loader2, ChevronRight, ChevronLeft, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractFileText, detectKind } from "@/lib/file-extract";
import { extractFromSource, type ArtifactKind } from "@/lib/extract";
import { mergeByKind } from "@/lib/merge";
import type { ArtifactModel } from "@/data/samples";

export interface ProjectResult {
  name: string;
  kinds: ArtifactKind[];
  sources: { label: string; text: string; origin: "paste" | "upload"; filename?: string }[];
  canvases: { kind: ArtifactKind; model: ArtifactModel }[];
}

type Step = 1 | 2 | 3;

interface SourceDraft {
  id: string;
  label: string;
  origin: "paste" | "upload";
  text: string;
  filename?: string;
  status: "idle" | "parsing" | "ready" | "error";
  error?: string;
}

let sid = 1;
const newSource = (index: number, origin: "paste" | "upload" = "paste"): SourceDraft => ({
  id: `S${sid++}`,
  label: `Source ${index + 1}`,
  origin,
  text: "",
  status: origin === "paste" ? "ready" : "idle",
});

interface Props {
  onComplete: (result: ProjectResult) => void;
}

export function IntakeWizard({ onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [name, setName] = useState("");
  const [kinds, setKinds] = useState<ArtifactKind[]>(["process"]);

  // Step 2
  const [sources, setSources] = useState<SourceDraft[]>([newSource(0)]);
  const [generating, setGenerating] = useState(false);

  const reset = () => {
    setStep(1); setName(""); setKinds(["process"]);
    setSources([newSource(0)]);
    setGenerating(false);
  };

  const toggleKind = (k: ArtifactKind) =>
    setKinds(cur => cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);

  const updateSource = (id: string, patch: Partial<SourceDraft>) =>
    setSources(cur => cur.map(s => s.id === id ? { ...s, ...patch } : s));

  const removeSource = (id: string) =>
    setSources(cur => cur.length === 1 ? cur : cur.filter(s => s.id !== id));

  const addSource = (origin: "paste" | "upload") =>
    setSources(cur => [...cur, newSource(cur.length, origin)]);

  const handleFile = useCallback(async (id: string, file: File) => {
    if (detectKind(file) === "unsupported") {
      updateSource(id, { status: "error", error: "Only .pdf and .docx are supported.", filename: file.name });
      return;
    }
    updateSource(id, { status: "parsing", filename: file.name, label: file.name, error: undefined });
    try {
      const text = await extractFileText(file);
      if (!text || text.length < 20) {
        updateSource(id, { status: "error", error: "Couldn't extract readable text from this file." });
        return;
      }
      updateSource(id, { text, status: "ready" });
    } catch (e) {
      updateSource(id, { status: "error", error: (e as Error).message || "Failed to parse file." });
    }
  }, []);

  const canContinueStep1 = name.trim().length > 0 && kinds.length > 0;
  const readySources = sources.filter(s => s.status === "ready" && s.text.trim().length > 0);
  const canGenerate = readySources.length >= 1 && kinds.length >= 1 && !generating;

  const generate = async () => {
    setGenerating(true);
    // Small delay for the "extracting" feel — parity with existing UX.
    await new Promise(r => setTimeout(r, 700));

    const perSource = readySources.map((s, i) =>
      ({ label: s.label, results: extractFromSource({ label: s.label, text: s.text, index: i }, kinds) }));

    const canvases: { kind: ArtifactKind; model: ArtifactModel }[] = [];
    for (const kind of kinds) {
      const models: ArtifactModel[] = [];
      const labels: string[] = [];
      for (const { label, results } of perSource) {
        const hit = results.find(r => r.kind === kind);
        if (hit) { models.push(hit.model); labels.push(label); }
      }
      if (models.length === 0) continue;
      const merged = mergeByKind(models, labels);
      if (merged) canvases.push({ kind, model: merged });
    }

    if (canvases.length === 0) {
      setGenerating(false);
      // Fall back into step 2 with an error banner.
      alert(
        "Not enough structure in these sources to build the selected artifact(s). " +
        "Try longer or more detailed inputs — Visuail refuses when it isn't confident.",
      );
      return;
    }

    onComplete({
      name: name.trim(),
      kinds,
      sources: readySources.map(s => ({
        label: s.label, text: s.text, origin: s.origin, filename: s.filename,
      })),
      canvases,
    });
    setOpen(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="h-8 gap-1.5">
          <FolderPlus className="size-3.5" /> New project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="size-4 text-primary" />
            New project
            <span className="ml-auto text-[10px] font-mono-tight uppercase tracking-widest text-muted-foreground">
              Step {step} of 3
            </span>
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "Name the project and pick which artifacts to build."}
            {step === 2 && "Add one or more sources — pasted transcripts or uploaded PDF/DOCX files. Nothing leaves your browser."}
            {step === 3 && "Reviewing…"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-mono-tight uppercase tracking-widest text-muted-foreground">
                Project / product name
              </label>
              <Input
                autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Acme Bank — onboarding overhaul"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono-tight uppercase tracking-widest text-muted-foreground">
                Artifacts to generate <span className="text-muted-foreground/70 normal-case">(pick one or both)</span>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <KindCard
                  active={kinds.includes("process")} onToggle={() => toggleKind("process")}
                  icon={<Workflow className="size-4" />} title="Process map"
                  desc="Actors, steps, decisions, exceptions." />
                <KindCard
                  active={kinds.includes("bmc")} onToggle={() => toggleKind("bmc")}
                  icon={<LayoutGrid className="size-4" />} title="Business Model Canvas"
                  desc="9 classic blocks with confidence per item." />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button disabled={!canContinueStep1} onClick={() => setStep(2)}>
                Continue <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto pr-1">
            {sources.map((s, i) => (
              <SourceCard
                key={s.id}
                source={s}
                index={i}
                onChange={(p) => updateSource(s.id, p)}
                onRemove={sources.length > 1 ? () => removeSource(s.id) : undefined}
                onFile={(f) => handleFile(s.id, f)}
              />
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => addSource("paste")}>
                <Plus className="size-3.5" /> Add pasted source
              </Button>
              <Button variant="outline" size="sm" onClick={() => addSource("upload")}>
                <Upload className="size-3.5" /> Add uploaded file
              </Button>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="size-4" /> Back
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {readySources.length} source{readySources.length === 1 ? "" : "s"} ready
                </span>
                <Button disabled={!canGenerate} onClick={generate}>
                  {generating
                    ? <><Loader2 className="size-4 animate-spin" /> Generating…</>
                    : <><Sparkles className="size-4" /> Generate artifacts</>}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KindCard({
  active, onToggle, icon, title, desc,
}: { active: boolean; onToggle: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-left transition cursor-pointer",
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

function SourceCard({
  source, index, onChange, onRemove, onFile,
}: {
  source: SourceDraft; index: number;
  onChange: (p: Partial<SourceDraft>) => void;
  onRemove?: () => void;
  onFile: (f: File) => void;
}) {
  const words = source.text.trim() ? source.text.trim().split(/\s+/).length : 0;
  return (
    <div className={cn(
      "rounded-lg border bg-card p-3 space-y-2",
      source.status === "error" && "border-drift/60 bg-drift/5",
    )}>
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono-tight text-muted-foreground">
          #{index + 1}
        </span>
        {source.origin === "upload"
          ? <FileText className="size-3.5 text-muted-foreground" />
          : <TypeIcon className="size-3.5 text-muted-foreground" />}
        <Input
          value={source.label}
          onChange={e => onChange({ label: e.target.value })}
          className="h-7 flex-1 max-w-xs text-sm"
        />
        <span className="text-[10px] font-mono-tight text-muted-foreground">
          {source.text.length} chars · {words} words
        </span>
        {onRemove && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} title="Remove source">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {source.origin === "upload" ? (
        <div className="space-y-2">
          <label className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground",
            "hover:border-primary hover:bg-primary/5 transition",
            source.status === "parsing" && "opacity-70 pointer-events-none",
          )}>
            {source.status === "parsing"
              ? <><Loader2 className="size-4 animate-spin" /> Parsing {source.filename}…</>
              : source.status === "ready" && source.filename
                ? <><FileText className="size-4" /> {source.filename} — parsed</>
                : <><Upload className="size-4" /> Drop a .pdf or .docx, or click to choose</>}
            <input
              type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>
          {source.status === "error" && (
            <div className="text-[11px] text-drift">{source.error}</div>
          )}
          {source.status === "ready" && source.text && (
            <details className="rounded-md border bg-muted/40 p-2 text-[11px]">
              <summary className="cursor-pointer text-muted-foreground">Preview extracted text</summary>
              <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono-tight text-[11px] leading-relaxed text-foreground/90">
                {source.text.slice(0, 2000)}{source.text.length > 2000 ? "…" : ""}
              </div>
            </details>
          )}
        </div>
      ) : (
        <Textarea
          value={source.text}
          onChange={e => onChange({ text: e.target.value, status: "ready" })}
          placeholder="Paste this source's transcript here…"
          className="min-h-[140px] font-mono-tight text-xs leading-relaxed resize-y"
        />
      )}
    </div>
  );
}

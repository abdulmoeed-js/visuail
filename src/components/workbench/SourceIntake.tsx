// Standalone multi-source intake (paste + PDF/DOCX upload). Extracted from
// IntakeWizard so the new full-page /new flow and an in-canvas "Add source"
// dialog can share the same logic without dragging the whole modal wizard in.

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload, FileText, Type as TypeIcon, Trash2, Plus, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { extractFileText, detectKind } from "@/lib/file-extract";

export interface SourceDraft {
  id: string;
  label: string;
  origin: "paste" | "upload";
  text: string;
  filename?: string;
  status: "idle" | "parsing" | "ready" | "error";
  error?: string;
}

let sid = 1;
export const makeSource = (index: number, origin: "paste" | "upload" = "paste"): SourceDraft => ({
  id: `S${sid++}`,
  label: `Source ${index + 1}`,
  origin,
  text: "",
  status: origin === "paste" ? "ready" : "idle",
});

interface Props {
  sources: SourceDraft[];
  onChange: (next: SourceDraft[]) => void;
}

export function SourceIntake({ sources, onChange }: Props) {
  const updateSource = (id: string, patch: Partial<SourceDraft>) =>
    onChange(sources.map(s => s.id === id ? { ...s, ...patch } : s));
  const removeSource = (id: string) =>
    onChange(sources.length === 1 ? sources : sources.filter(s => s.id !== id));
  const addSource = (origin: "paste" | "upload") =>
    onChange([...sources, makeSource(sources.length, origin)]);

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
    // updateSource closes over stale sources; use ref via functional pattern instead
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  return (
    <div className="space-y-3">
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

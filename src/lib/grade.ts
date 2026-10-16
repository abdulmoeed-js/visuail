// How sure Visu is about an item, in words.
//
// Every surface that shows certainty (the chip on an item, the header bar,
// the legend, the board and dashboard counts, the PDF) asks this file, so the
// words and the rules stay the same everywhere. The percentage is kept as a
// detail inside `reason`, never shown on its own (DESIGN.md: "certainty is
// shown in words and colour, never colour alone"; no raw percentages on main
// screens).

import type { ArtifactModel, BaseItem } from "@/data/samples";
import { isRefinementId, isUserCreatedId } from "@/lib/item-origin";

/** Below this, an item was stated loosely or only implied. */
export const LOW_CONFIDENCE = 0.7;

/** Labels Re-check stamps on items; they are not independent sources, so they
 *  never count towards "Confirmed". Projects saved before this rule still
 *  carry them. */
const PSEUDO_SOURCES = new Set(["Current", "Re-checked source"]);

/** Older projects recorded a failed quote check only as this note. */
export const GROUNDING_NOTE = "Source quote could not be verified against the transcript.";

/** True when the item's quote was checked against the source and not found
 *  (or no quote was recorded). Asked separately from the grade, because a
 *  changed or disputed item can have a missing quote too. */
export function quoteMissing(item: BaseItem): boolean {
  return !!item.quoteUnverified || !!item.conflictNote?.includes(GROUNDING_NOTE);
}

/** Re-check reconciles the canvas ("Current") against a fresh read of the
 *  same source ("Re-checked source"). A disagreement between those two is
 *  the source having changed, not two sources disagreeing. */
const RECHECK_CONFLICT = /^Conflicting sources\s*[—–-]\s*Re-checked source:\s*(.+)$/i;

export type Grade = "confirmed" | "clear" | "unclear" | "changed" | "disagree";
export type Provenance = "added" | "refined" | "edited";
export type GradeTone = "confident" | "unresolved" | "drift" | "verified" | "muted";

export interface GradeInfo {
  grade: Grade;
  /** Set when a person (or an accepted refinement) made or changed the item. */
  provenance?: Provenance;
  /** 0-100, or null when no usable confidence was recorded. */
  pct: number | null;
  /** Independent sources that agree, pseudo-labels excluded. */
  sources: number;
  /** The word shown on the chip. */
  label: string;
  /** A shorter word for tight spots such as canvas node headers. */
  short: string;
  /** One plain sentence, with the percentage where there is one. */
  reason: string;
  tone: GradeTone;
}

export const GRADE_LABEL: Record<Grade, string> = {
  confirmed: "Confirmed",
  clear: "Stated clearly",
  unclear: "Unclear",
  changed: "Source changed",
  disagree: "Sources disagree",
};
const GRADE_SHORT: Record<Grade, string> = {
  confirmed: "Confirmed",
  clear: "Clear",
  unclear: "Unclear",
  changed: "Changed",
  disagree: "Disagree",
};
const PROVENANCE_LABEL: Record<Provenance, string> = {
  added: "Added by hand",
  refined: "From a refinement",
  edited: "Edited",
};
const PROVENANCE_SHORT: Record<Provenance, string> = {
  added: "Added",
  refined: "Refined",
  edited: "Edited",
};
const GRADE_TONE: Record<Grade, GradeTone> = {
  confirmed: "confident",
  clear: "confident",
  unclear: "unresolved",
  changed: "drift",
  disagree: "drift",
};

export function gradeOf(item: BaseItem): GradeInfo {
  const c = item.confidence;
  const valid = typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 1;
  const pct = valid ? Math.round(c * 100) : null;
  const sources = new Set((item.confirmedBySources ?? []).filter((s) => !PSEUDO_SOURCES.has(s))).size;
  const noQuote = quoteMissing(item);
  const pctText = pct === null ? "" : ` (${pct}% confidence)`;
  const make = (grade: Grade, reason: string, provenance?: Provenance): GradeInfo => ({
    grade, provenance, pct, sources, reason,
    label: provenance ? PROVENANCE_LABEL[provenance] : GRADE_LABEL[grade],
    short: provenance ? PROVENANCE_SHORT[provenance] : GRADE_SHORT[grade],
    tone: provenance === "edited" ? "verified" : provenance ? "muted" : GRADE_TONE[grade],
  });

  if (item.conflict) {
    const raw = (item.conflictNote ?? "").replace(GROUNDING_NOTE, "").trim();
    const recheck = raw.match(RECHECK_CONFLICT);
    if (recheck) return make("changed", `The source now says ${recheck[1].trim()}${pctText}.`);
    const note = raw.replace(/^Conflicting sources\s*[—–-]\s*/i, "").trim();
    return make("disagree", note ? `Sources disagree: ${note}${pctText}.` : `Sources disagree about this item${pctText}.`);
  }
  if (item.drift) return make("changed", `This changed in the source since the diagram was drawn${pctText}.`);
  if (item.userAdded) {
    if (isUserCreatedId(item.id)) return make("clear", "Added by hand, not taken from a source.", "added");
    if (isRefinementId(item.id)) return make("clear", "Created by an accepted refinement, not stated in a source.", "refined");
    return make("clear", "Edited after it was taken from the source.", "edited");
  }
  if (noQuote) {
    return make("unclear", item.snippet
      ? `The quote for this item wasn't found in the source${pctText}.`
      : `No source quote was recorded for this item${pctText}.`);
  }
  if (pct === null) return make("unclear", "No confidence was recorded for this item.");
  if (c < LOW_CONFIDENCE || item.unresolved) {
    return make("unclear", `Stated loosely or only implied in the source${pctText}.`);
  }
  if (sources >= 2) return make("confirmed", `Confirmed by ${sources} sources${pctText}.`);
  return make("clear", `Stated clearly in the source${pctText}.`);
}

/** The items Visu reads from a source, and so the ones that carry a grade:
 *  toolkit registers are always hand-made and are left out. */
export function gradedItems(model: ArtifactModel): BaseItem[] {
  if (model.kind === "process") {
    return [...model.actors, ...model.systems, ...model.steps, ...model.decisions, ...model.exceptions];
  }
  return model.blocks.flatMap((b) => b.items);
}

/** Segments of the grade bar, in the order they are drawn. Anything a person
 *  (or an accepted refinement) added or edited gets its own grey segment, so
 *  the bar's words match the item chips. */
export type Segment = "confirmed" | "clear" | "added" | "unclear" | "changed" | "disagree";
export const SEGMENT_ORDER: Segment[] = ["confirmed", "clear", "added", "unclear", "changed", "disagree"];
export const SEGMENT_LABEL: Record<Segment, string> = {
  confirmed: "confirmed",
  clear: "stated clearly",
  added: "added or edited",
  unclear: "unclear",
  changed: "changed in the source",
  disagree: "sources disagree",
};
export const SEGMENT_TONE: Record<Segment, GradeTone> = {
  confirmed: "confident",
  clear: "confident",
  added: "muted",
  unclear: "unresolved",
  changed: "drift",
  disagree: "drift",
};
/** For jsPDF, which cannot read CSS variables or oklch. */
export const TONE_HEX: Record<GradeTone, { fill: string; ink: string }> = {
  confident: { fill: "#007950", ink: "#00563C" },
  unresolved: { fill: "#A95C00", ink: "#653D05" },
  drift: { fill: "#D02B31", ink: "#8A0314" },
  verified: { fill: "#006E6F", ink: "#015353" },
  muted: { fill: "#8E8E93", ink: "#5B675D" },
};

export interface GradeSummary extends Record<Segment, number> {
  total: number;
  /** Unclear, changed and disagreeing items: the ones worth a look. */
  needsLook: number;
}

export function segmentOf(info: GradeInfo): Segment {
  if (info.provenance) return "added";
  return info.grade;
}

export function summarizeItems(items: BaseItem[]): GradeSummary {
  const s: GradeSummary = { total: 0, needsLook: 0, confirmed: 0, clear: 0, added: 0, unclear: 0, changed: 0, disagree: 0 };
  for (const item of items) {
    const seg = segmentOf(gradeOf(item));
    s[seg] += 1;
    s.total += 1;
  }
  s.needsLook = s.unclear + s.changed + s.disagree;
  return s;
}

export function summarizeGrades(model: ArtifactModel): GradeSummary {
  return summarizeItems(gradedItems(model));
}

export function addSummaries(list: GradeSummary[]): GradeSummary {
  const s = summarizeItems([]);
  for (const x of list) {
    for (const k of [...SEGMENT_ORDER, "total", "needsLook"] as const) s[k] += x[k];
  }
  return s;
}

/** "14 stated clearly · 3 unclear · 1 source changed", skipping empty segments. */
export function summaryWords(s: GradeSummary): string {
  if (s.total === 0) return "Nothing taken from a source yet";
  return SEGMENT_ORDER.filter((k) => s[k] > 0).map((k) => `${s[k]} ${SEGMENT_LABEL[k]}`).join(" · ");
}

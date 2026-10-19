import { cn } from "@/lib/utils";
import type { BaseItem } from "@/data/samples";
import { Check, AlertOctagon, GitCompareArrows } from "lucide-react";
import {
  gradeOf, SEGMENT_ORDER, SEGMENT_TONE, summaryWords,
  type GradeSummary, type GradeTone,
} from "@/lib/grade";

/** Chip colours by tone: a pale tint of the status colour, its ink for text. */
const CHIP_TONE: Record<GradeTone, string> = {
  confident: "bg-confident/10 text-confident-ink",
  unresolved: "bg-unresolved/15 text-unresolved-ink",
  drift: "bg-drift/10 text-drift-ink",
  verified: "bg-verified/10 text-verified-ink",
  muted: "bg-fill-3 text-foreground",
};
const DOT_TONE: Record<GradeTone, string> = {
  confident: "bg-confident",
  unresolved: "bg-unresolved",
  drift: "bg-drift",
  verified: "bg-verified",
  muted: "bg-muted-foreground",
};

/** How sure Visu is about one item, in a word and a colour. The percentage and
 *  the reason live in the tooltip and in what a screen reader hears, not on
 *  the chip. `compact` uses the short word, for canvas node headers. */
export function ConfidenceBadge({ item, compact = false }: { item: BaseItem; compact?: boolean }) {
  const g = gradeOf(item);
  const Icon = g.grade === "disagree" ? GitCompareArrows : g.grade === "changed" ? AlertOctagon : g.provenance || g.grade === "confirmed" ? Check : null;
  // On a diagram, "stated clearly" is the usual case: a dot says it without
  // a word on every shape. The chip is kept for what needs a look.
  if (compact && g.grade === "clear" && !g.provenance) {
    return (
      <span className="inline-flex size-4 shrink-0 items-center justify-center" title={`${g.label}: ${g.reason}`}>
        <span className={cn("size-2 rounded-full", DOT_TONE[g.tone])} aria-hidden />
        <span className="sr-only">{g.label}. {g.reason}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none",
        CHIP_TONE[g.tone],
      )}
      title={g.reason}
    >
      {Icon ? <Icon className="!size-3" aria-hidden /> : <span className={cn("size-1.5 rounded-full", DOT_TONE[g.tone])} aria-hidden />}
      {compact ? g.short : g.label}
      <span className="sr-only">. {g.reason}</span>
    </span>
  );
}

/** The share of each grade as a thin segmented bar, with the counts in words
 *  underneath (DESIGN.md 3.3). */
export function GradeBar({ summary, className }: { summary: GradeSummary; className?: string }) {
  const words = summaryWords(summary);
  return (
    <div className={cn("min-w-0", className)}>
      {summary.total > 0 && (
        <div className="flex h-1 gap-[3px]" role="img" aria-label={words}>
          {SEGMENT_ORDER.filter((k) => summary[k] > 0).map((k) => (
            <span
              key={k}
              className={cn("h-1 rounded-[2px]", DOT_TONE[SEGMENT_TONE[k]], k === "clear" && "opacity-70")}
              style={{ flexGrow: summary[k], flexBasis: 0 }}
            />
          ))}
        </div>
      )}
      <p className={cn("text-xs text-muted-foreground", summary.total > 0 && "mt-1.5")} aria-hidden={summary.total > 0}>
        {words}
      </p>
    </div>
  );
}

export function IdChip({ id, tone = "muted" }: { id: string; tone?: "muted" | "primary" }) {
  return (
    <span
      className={cn(
        "font-mono-tight text-[10px] px-1.5 py-0.5 rounded",
        tone === "primary"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {id}
    </span>
  );
}

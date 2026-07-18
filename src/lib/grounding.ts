// Source-grounding check: does an item's claimed source quote (`snippet`)
// actually appear in the source text it was extracted from? This is the
// guardrail that has to exist before real (LLM-based) extraction is ever
// switched on — a hallucinated quote is worse than no quote at all, so an
// item whose snippet can't be verified gets flagged unresolved rather than
// silently trusted.
//
// Matching is deliberately not exact-substring-only: real quotes are often
// lightly paraphrased or lightly compressed with "…" between two real
// fragments, so an exact match is tried first and a fuzzy word-overlap
// check is the fallback, not exact matching alone.

import type { ArtifactModel, BaseItem } from "@/data/samples";

const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "at", "for", "is", "are",
  "we", "i", "it", "that", "this", "if", "or", "and", "but", "so",
]);

const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

function tokenOverlapRatio(fragment: string, normalizedSource: string): number {
  const words = norm(fragment).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));
  if (words.length === 0) return 1;
  const hits = words.filter((w) => normalizedSource.includes(w)).length;
  return hits / words.length;
}

/** True if `snippet` (or every "…"-separated fragment of it) is really present in `sourceText`. */
export function isGrounded(snippet: string | undefined, sourceText: string): boolean {
  if (!snippet) return true; // no traceability claim made, nothing to verify
  const source = norm(sourceText);
  const fragments = snippet.split(/…|\.\.\./).map((f) => f.trim()).filter(Boolean);
  if (fragments.length === 0) return true;
  return fragments.every((f) => source.includes(norm(f)) || tokenOverlapRatio(f, source) >= 0.8);
}

function flagItem<T extends BaseItem>(item: T, sourceText: string): T {
  if (item.snippet && !isGrounded(item.snippet, sourceText)) {
    return {
      ...item,
      unresolved: true,
      conflictNote: [item.conflictNote, "Source quote could not be verified against the transcript."]
        .filter(Boolean)
        .join(" "),
    };
  }
  return item;
}

/** Re-check every item's snippet against the real source text and flag any that don't hold up. */
export function verifyGrounding(model: ArtifactModel, sourceText: string): ArtifactModel {
  if (model.kind === "process") {
    return {
      ...model,
      actors: model.actors.map((i) => flagItem(i, sourceText)),
      steps: model.steps.map((i) => flagItem(i, sourceText)),
      decisions: model.decisions.map((i) => flagItem(i, sourceText)),
      exceptions: model.exceptions.map((i) => flagItem(i, sourceText)),
      systems: model.systems.map((i) => flagItem(i, sourceText)),
    };
  }
  return {
    ...model,
    blocks: model.blocks.map((b) => ({ ...b, items: b.items.map((i) => flagItem(i, sourceText)) })),
  };
}

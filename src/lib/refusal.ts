// Generalized "refuse when unsure" check. Previously this was hardcoded to
// one sample id ("thin"), which meant the safety behavior only ever fired
// for one canned demo case rather than reacting to what was actually
// extracted. Thresholds below are calibrated against the two real working
// samples (avg confidence ~0.83, ~17% of items below 0.7) with real margin,
// so legitimate content won't false-positive, but a genuinely weak
// extraction — the case this exists for — still gets caught.
//
// "Unclear" is the same grade the item chips show (grade.ts): stated loosely,
// or a quote the source doesn't contain, or no usable confidence. Run the
// quote check (verifyGrounding) before this, so failed quotes count.

import { stats, type ArtifactModel } from "@/data/samples";
import { summarizeGrades } from "@/lib/grade";

export interface RefusalCheck {
  refuse: boolean;
  reason?: string;
}

const MIN_ITEMS = 3;
const MIN_AVG_CONFIDENCE = 0.5;
const MAX_UNCLEAR_RATIO = 0.6;

const TRY_AGAIN = "Add a longer or more detailed source, then try again.";

const NO_STRUCTURE_REASON =
  "There isn't enough here to draw safely: too few people, steps or systems were found. " + TRY_AGAIN;

export function checkRefusal(model: ArtifactModel | null): RefusalCheck {
  if (!model) return { refuse: true, reason: NO_STRUCTURE_REASON };

  const { total, unclear } = summarizeGrades(model);

  if (total < MIN_ITEMS) return { refuse: true, reason: NO_STRUCTURE_REASON };

  if (stats(model).avg < MIN_AVG_CONFIDENCE) {
    return {
      refuse: true,
      reason:
        `The ${total} items found are, on the whole, only loosely stated in the source, ` +
        `so nothing was drawn rather than guessed. ${TRY_AGAIN}`,
    };
  }

  if (unclear / total > MAX_UNCLEAR_RATIO) {
    return {
      refuse: true,
      reason:
        `${unclear} of the ${total} items found are unclear in the source, ` +
        `so nothing was drawn rather than guessed. ${TRY_AGAIN}`,
    };
  }

  return { refuse: false };
}

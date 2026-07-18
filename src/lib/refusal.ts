// Generalized "refuse when unsure" check. Previously this was hardcoded to
// one sample id ("thin"), which meant the safety behavior only ever fired
// for one canned demo case rather than reacting to what was actually
// extracted. Thresholds below are calibrated against the two real working
// samples (avg confidence ~0.83, ~17% of items below 0.7) with real margin,
// so legitimate content won't false-positive, but a genuinely weak
// extraction — the case this exists for — still gets caught.

import { stats, type ArtifactModel } from "@/data/samples";

export interface RefusalCheck {
  refuse: boolean;
  reason?: string;
}

const MIN_ITEMS = 3;
const MIN_AVG_CONFIDENCE = 0.5;
const MAX_UNRESOLVED_RATIO = 0.6;

const NO_STRUCTURE_REASON =
  "This input doesn't contain enough structure — actors, steps, or system references — " +
  "to build a safe artifact. A blank canvas beats a confidently wrong diagram.";

export function checkRefusal(model: ArtifactModel | null): RefusalCheck {
  if (!model) return { refuse: true, reason: NO_STRUCTURE_REASON };

  const { count, avg, unresolved } = stats(model);

  if (count < MIN_ITEMS) return { refuse: true, reason: NO_STRUCTURE_REASON };

  if (avg < MIN_AVG_CONFIDENCE) {
    return {
      refuse: true,
      reason:
        `Average confidence across the ${count} extracted items is ${Math.round(avg * 100)}% — ` +
        `below what this demo is willing to present as reliable. Try a longer or more detailed source.`,
    };
  }

  if (count > 0 && unresolved / count > MAX_UNRESOLVED_RATIO) {
    return {
      refuse: true,
      reason:
        `${unresolved} of ${count} items are low-confidence — more than this demo is willing to ` +
        `present as reliable. A blank canvas beats a confidently wrong diagram.`,
    };
  }

  return { refuse: false };
}

// Flags vague wording and missing measurable criteria in requirement text,
// per the "unambiguous / verifiable" rules from the IEEE-830-style
// requirements-quality checklist reviewed for the Quality Layer corpus.
// Pure text analysis -- no state, no stored fields, nothing to migrate.

const VAGUE_TERMS = [
  "usually", "generally", "good", "well", "some", "several", "appropriate",
  "as needed", "as appropriate", "reasonable", "adequate", "sufficient",
  "user-friendly", "efficient", "fast", "quickly", "easy", "simple",
  "etc", "and so on", "if necessary", "if possible", "may", "might",
] as const;

export interface RequirementQuality {
  vagueTerms: { word: string; index: number }[];
  hasMeasurableCriterion: boolean;
}

export function analyzeRequirementText(text: string): RequirementQuality {
  const lower = text.toLowerCase();
  const vagueTerms = VAGUE_TERMS
    .map((word) => ({ word, index: lower.indexOf(word) }))
    .filter((m) => m.index !== -1);
  const hasMeasurableCriterion = /\d/.test(text) || /%/.test(text);
  return { vagueTerms, hasMeasurableCriterion };
}

/** True when the requirement is worth flagging. Gated on vague wording only --
 *  "missing measurable criterion" is real signal for non-functional
 *  requirements (which should read like "responds within 2 seconds"), but
 *  most process-step-derived functional requirements never carry a number
 *  and flagging that would just be noise. `hasMeasurableCriterion` is still
 *  returned above for callers (e.g. an NFR editor) that want it. */
export function needsQualityFlag(q: RequirementQuality): boolean {
  return q.vagueTerms.length > 0;
}

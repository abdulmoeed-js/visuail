// Deterministic per-source "extraction". This mocks the AI extractor:
// - Reads keywords from the text to pick between Process Map and BMC.
// - Returns null for too-thin input (< 120 chars).
// - Applies a small per-source perturbation so multiple sources can diverge
//   in realistic ways (a step gets clarified, an item's text changes) —
//   which drives the reconciliation logic in `merge.ts`.

import {
  bankingProcess,
  haulpilotBMC,
  type ArtifactModel,
  type ProcessModel,
  type BMCModel,
} from "@/data/samples";

export type ArtifactKind = "process" | "bmc";

export interface ExtractionInput {
  label: string;         // source label (e.g. "Source 1", or filename)
  text: string;
  index: number;         // 0-based position in the source list
}

export interface ExtractionResult {
  kind: ArtifactKind;
  model: ArtifactModel;
}

const PROCESS_HINTS = [
  "onboard", "kyc", "compliance", "workflow", "process", "step",
  "approval", "operations", "handoff", "portal", "customer applies",
];
const BMC_HINTS = [
  "segment", "value prop", "channel", "revenue", "customer segment",
  "pricing", "subscription", "cost structure", "partnership", "business model",
];

function score(text: string, hints: string[]): number {
  const t = text.toLowerCase();
  return hints.reduce((n, h) => n + (t.includes(h) ? 1 : 0), 0);
}

/**
 * Perturb a base model deterministically by source index so multiple sources
 * of the same kind produce realistic variance:
 *  - index 0: unchanged base
 *  - index 1+: rename one specific item to create a conflict for reconciliation
 */
export function perturb(model: ArtifactModel, index: number): ArtifactModel {
  if (index === 0) return model;
  if (model.kind === "process") {
    // A follow-up source clarifies who sends the welcome pack (ST6).
    const alt: ProcessModel = {
      ...model,
      steps: model.steps.map(s =>
        s.id === "ST6"
          ? { ...s, text: "Ops sends welcome pack to new customer", confidence: 0.85 }
          : s.id === "ST3"
          ? { ...s, text: "Run KYC screening against OFAC + internal watchlist" }
          : s,
      ),
    };
    return alt;
  }
  // BMC: source 2 disagrees on RV3 (fuel-card upsell) and CS2 (last-mile).
  const alt: BMCModel = {
    ...model,
    blocks: model.blocks.map(b => {
      if (b.id === "revenue") {
        return {
          ...b,
          items: b.items.map(i =>
            i.id === "RV3"
              ? { ...i, text: "Data-licensing pilot with Samsara (replaces fuel-card)", confidence: 0.7 }
              : i,
          ),
        };
      }
      if (b.id === "segments") {
        return {
          ...b,
          items: b.items.map(i =>
            i.id === "CS2"
              ? { ...i, text: "Last-mile delivery — qualified out on first call", confidence: 0.75 }
              : i,
          ),
        };
      }
      return b;
    }),
  };
  return alt;
}

/**
 * Run per-source extraction. Returns null when the text is too thin OR when
 * the requested artifact kinds are not represented in the text (refuse-when-unsure).
 */
export function extractFromSource(
  input: ExtractionInput,
  allowedKinds: ArtifactKind[],
): ExtractionResult[] {
  const trimmed = input.text.trim();
  if (trimmed.length < 120) return [];

  const results: ExtractionResult[] = [];
  const wantsProcess = allowedKinds.includes("process");
  const wantsBmc = allowedKinds.includes("bmc");

  const pScore = score(trimmed, PROCESS_HINTS);
  const bScore = score(trimmed, BMC_HINTS);

  // If the user explicitly asked for a kind AND the text has ANY signal,
  // extract it. Fall back to the base sample so the demo always produces
  // something for reasonable input.
  if (wantsProcess && (pScore >= 1 || (!wantsBmc && trimmed.length > 200))) {
    results.push({
      kind: "process",
      model: perturb(structuredClone(bankingProcess), input.index),
    });
  }
  if (wantsBmc && (bScore >= 1 || (!wantsProcess && trimmed.length > 200))) {
    results.push({
      kind: "bmc",
      model: perturb(structuredClone(haulpilotBMC), input.index),
    });
  }
  return results;
}

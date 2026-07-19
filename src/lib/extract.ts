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
import { supabase } from "@/integrations/supabase/client";
import { verifyGrounding } from "@/lib/grounding";

export type ArtifactKind = "process" | "bmc";

// extract-artifact is deployed (confirmed ACTIVE via Supabase) and the
// ANTHROPIC_API_KEY secret has been set. Real, Claude-backed extraction is
// now live. Flip back to false to fall back to the deterministic mock.
export const REAL_EXTRACTION_ENABLED = true;

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
 * Deterministic mock extraction. Returns [] when the text is too thin OR when
 * the requested artifact kinds are not represented in the text (refuse-when-unsure).
 */
export function extractFromSourceMock(
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

/**
 * Prefix every item id (and every field that references an item id) with a
 * per-source tag. Independent extraction calls have no shared id namespace,
 * so without this, two unrelated items from different sources that happen to
 * both land on e.g. "ST1" would be silently treated as the same item by
 * merge.ts's id-based reconciliation — a false "confirmed by both sources"
 * merge is worse than no merge at all. Real cross-source matching (comparing
 * item *content*, not id) is a separate, not-yet-built feature — see the
 * dashboard follow-up note.
 */
function prefixIds(model: ArtifactModel, index: number): ArtifactModel {
  const tag = (id: string) => `s${index}-${id}`;
  if (model.kind === "process") {
    return {
      ...model,
      actors: model.actors.map(a => ({ ...a, id: tag(a.id) })),
      systems: model.systems.map(s => ({ ...s, id: tag(s.id) })),
      steps: model.steps.map(s => ({
        ...s,
        id: tag(s.id),
        actorId: tag(s.actorId),
        systemId: s.systemId ? tag(s.systemId) : s.systemId,
      })),
      decisions: model.decisions.map(d => ({
        ...d,
        id: tag(d.id),
        afterStepId: tag(d.afterStepId),
        yes: tag(d.yes),
        no: tag(d.no),
      })),
      exceptions: model.exceptions.map(e => ({
        ...e,
        id: tag(e.id),
        relatedStepId: e.relatedStepId ? tag(e.relatedStepId) : e.relatedStepId,
      })),
    };
  }
  return {
    ...model,
    blocks: model.blocks.map(b => ({ ...b, items: b.items.map(i => ({ ...i, id: tag(i.id) })) })),
  };
}

interface EdgeFunctionResult { kind: ArtifactKind; model: ArtifactModel }
interface EdgeFunctionResponse { results?: EdgeFunctionResult[]; error?: string }

/** Real, Claude-backed extraction for one source. Throws on failure — callers decide how to surface that. */
export async function extractFromSourceReal(
  input: ExtractionInput,
  allowedKinds: ArtifactKind[],
): Promise<ExtractionResult[]> {
  const trimmed = input.text.trim();
  if (trimmed.length < 40) return [];

  const { data, error } = await supabase.functions.invoke<EdgeFunctionResponse>("extract-artifact", {
    body: { text: trimmed, allowedKinds },
  });
  if (error) throw new Error(error.message || "Extraction failed. Try again.");
  if (data?.error) throw new Error(data.error);

  return (data?.results ?? []).map(({ kind, model }) => ({
    kind,
    model: verifyGrounding(prefixIds(model, input.index), trimmed),
  }));
}

/** Single entry point every call site should use — dispatches to real or mock extraction. */
export async function extractFromSource(
  input: ExtractionInput,
  allowedKinds: ArtifactKind[],
): Promise<ExtractionResult[]> {
  if (!REAL_EXTRACTION_ENABLED) return extractFromSourceMock(input, allowedKinds);
  return extractFromSourceReal(input, allowedKinds);
}

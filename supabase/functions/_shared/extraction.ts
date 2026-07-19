// Shared Claude extraction call, used by both extract-artifact (interactive,
// per-request) and scheduled-drift-scan (background, per-project) so the
// two paths can't quietly drift apart from each other -- ironic bug to have
// in the code that detects drift.

export const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
export const MAX_TEXT_CHARS = 20_000;
export const MIN_TEXT_CHARS = 40;

const baseItem = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: {
    id: { type: "string", description: "Short stable id unique within this model, e.g. AC1, ST1, CS1." },
    text: { type: "string" },
    confidence: {
      type: "number",
      description:
        "0 to 1. Lower this whenever the speaker hedges (\"I think\", \"not sure\", \"maybe\", contradicts themselves) " +
        "or the detail is inferred rather than directly stated. Confident, explicitly stated facts: 0.85-0.98. " +
        "Hedged or uncertain: 0.35-0.6.",
    },
    snippet: {
      type: "string",
      description:
        "A short, VERBATIM quote (<=25 words) copied EXACTLY from the source text that supports this item. " +
        "Never paraphrase this field. If you cannot find a real supporting quote, do not include this item at all.",
    },
    ...extra,
  },
  required: ["id", "text", "confidence", "snippet", ...Object.keys(extra)],
});

const PROCESS_SCHEMA = {
  type: ["object", "null"],
  description:
    "Process map model. Include only if requested AND the source describes an operational process/workflow " +
    "with actors doing things in sequence. Set to null otherwise.",
  properties: {
    title: { type: "string" },
    actors: { type: "array", items: baseItem() },
    systems: { type: "array", items: baseItem() },
    steps: {
      type: "array",
      items: baseItem({
        actorId: { type: "string", description: "id of the actor performing this step" },
        systemId: { type: "string", description: "id of the system used, if any (omit if none)" },
      }),
    },
    decisions: {
      type: "array",
      items: baseItem({
        afterStepId: { type: "string" },
        yes: { type: "string", description: "id of the step/decision taken on yes" },
        no: { type: "string", description: "id of the step/decision taken on no" },
      }),
    },
    exceptions: {
      type: "array",
      items: baseItem({ relatedStepId: { type: "string" } }),
    },
  },
  required: ["title", "actors", "systems", "steps", "decisions", "exceptions"],
};

const BMC_BLOCK_IDS = [
  "segments", "value", "channels", "relationships", "revenue",
  "resources", "activities", "partnerships", "costs",
];

const BMC_SCHEMA = {
  type: ["object", "null"],
  description:
    "Business Model Canvas. Include only if requested AND the source describes a business model " +
    "(segments, value prop, channels, revenue, costs, etc). Set to null otherwise.",
  properties: {
    title: { type: "string" },
    blocks: {
      type: "array",
      description: "One entry per BMC block that has real content in the source. Omit blocks with nothing to say.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: BMC_BLOCK_IDS },
          title: { type: "string" },
          items: { type: "array", items: baseItem() },
        },
        required: ["id", "title", "items"],
      },
    },
  },
  required: ["title", "blocks"],
};

const TOOL = {
  name: "submit_extraction",
  description: "Submit the extracted artifact model(s) for this source text.",
  input_schema: {
    type: "object",
    properties: { process: PROCESS_SCHEMA, bmc: BMC_SCHEMA },
    required: ["process", "bmc"],
  },
};

export function systemPrompt(allowedKinds: string[]): string {
  return (
    "You extract structured artifacts from business-analyst discovery transcripts. " +
    `The caller wants: ${allowedKinds.join(", ")}. Only populate the kinds that were requested; set the rest to null.\n\n` +
    "Rules:\n" +
    "- Every item needs a verbatim snippet quoted from the source. If you can't quote it, don't include it.\n" +
    "- Reflect real uncertainty in confidence scores — don't invent false precision.\n" +
    "- If the source doesn't actually support a requested kind (e.g. asked for a process map but the " +
    "transcript is a sales pitch with no workflow), set that kind to null rather than forcing a weak structure.\n" +
    "- Use short, stable, human-readable ids (AC1, ST1, CS1, ...), unique within each model.\n" +
    "- CRITICAL — do not silently absorb unresolved branches: if the source IMPLIES a decision's failure/no-path, " +
    "an exception, or a step exists, but never explicitly states its outcome or how it's actually handled, you " +
    "MUST still create a formal node for it (a decision, step, or exception item) with low confidence (0.3-0.5) " +
    "and a snippet quoting the ambiguous language — never fold it silently into a sibling item's text or drop it " +
    "entirely. A missing branch that should have been flagged unresolved is a worse failure than a low-confidence " +
    "guess, because it defeats the refuse-when-unsure trust mechanism downstream.\n" +
    "- Do not resolve a genuinely ambiguous reference (e.g. two names for what might be the same role, an " +
    "unnamed system, an undefined threshold) with false confidence. If the source itself is uncertain, your " +
    "confidence score must say so — confidently picking one interpretation is worse than flagging the ambiguity.\n" +
    "- Call submit_extraction exactly once with your full answer."
  );
}

export interface ExtractionResult { kind: "process" | "bmc"; model: Record<string, unknown> }

/** Calls Claude for one source's text, returns the requested kinds it could
 *  ground in the text. Throws on any upstream failure -- callers decide how
 *  to handle that (interactive: surface an error; scheduled: skip and log). */
export async function callAnthropicExtraction(
  text: string,
  allowedKinds: string[],
  apiKey: string,
): Promise<ExtractionResult[]> {
  const clipped = text.trim().slice(0, MAX_TEXT_CHARS);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system: systemPrompt(allowedKinds),
      messages: [{ role: "user", content: `Source transcript:\n\n${clipped}` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "submit_extraction" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse) throw new Error("Extraction produced no result.");

  const input = toolUse.input as { process?: Record<string, unknown>; bmc?: Record<string, unknown> };
  const results: ExtractionResult[] = [];
  if (allowedKinds.includes("process") && input.process) {
    results.push({ kind: "process", model: { kind: "process", ...input.process } });
  }
  if (allowedKinds.includes("bmc") && input.bmc) {
    results.push({ kind: "bmc", model: { kind: "bmc", ...input.bmc } });
  }
  return results;
}

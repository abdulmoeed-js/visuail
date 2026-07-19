// Real extraction: calls Claude (Anthropic Messages API) server-side to turn
// a source transcript into a typed ProcessModel / BMCModel, matching the
// exact shape src/data/samples.ts expects. Runs behind Supabase Auth (the
// caller's JWT is required) and a per-user hourly rate limit, since every
// call spends real API budget.
//
// The model is instructed to attach a verbatim source `snippet` to every
// item and to omit anything it can't ground in the text — the client then
// re-verifies those snippets independently (src/lib/grounding.ts) before
// trusting anything this function returns. This function does not decide
// what's safe to show; it only proposes, with citations.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TEXT_CHARS = 20_000;
const MIN_TEXT_CHARS = 40;
const RATE_LIMIT_PER_HOUR = 30;

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

function systemPrompt(allowedKinds: string[]): string {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Sign in required." }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Sign in required." }, 401);
    }
    const userId = userData.user.id;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("extraction_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", oneHourAgo);
    if (countErr) return json({ error: "Couldn't check rate limit. Try again." }, 500);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `You've hit the extraction limit (${RATE_LIMIT_PER_HOUR}/hour). Try again in a bit.` },
        429,
      );
    }

    const body = await req.json().catch(() => null);
    const text: unknown = body?.text;
    const allowedKinds: unknown = body?.allowedKinds;
    if (typeof text !== "string" || !Array.isArray(allowedKinds) || allowedKinds.length === 0) {
      return json({ error: "Missing text or allowedKinds." }, 400);
    }
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT_CHARS) {
      return json({ results: [] });
    }
    const clipped = trimmed.slice(0, MAX_TEXT_CHARS);
    const kinds = allowedKinds.filter((k) => k === "process" || k === "bmc") as string[];
    if (kinds.length === 0) return json({ error: "No valid artifact kinds requested." }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Extraction isn't configured yet (missing API key)." }, 500);

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8000,
        system: systemPrompt(kinds),
        messages: [{ role: "user", content: `Source transcript:\n\n${clipped}` }],
        tools: [TOOL],
        tool_choice: { type: "tool", name: "submit_extraction" },
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text().catch(() => "");
      console.error("[extract-artifact] Anthropic error", anthropicRes.status, detail);
      return json({ error: "Extraction failed upstream. Try again." }, 502);
    }

    const data = await anthropicRes.json();
    const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse) return json({ error: "Extraction produced no result. Try again." }, 502);

    // Logged only once the call actually succeeded and cost money.
    await supabase.from("extraction_log").insert({ user_id: userId });

    const input = toolUse.input as { process?: unknown; bmc?: unknown };
    const results: { kind: "process" | "bmc"; model: unknown }[] = [];
    if (kinds.includes("process") && input.process) {
      results.push({ kind: "process", model: { kind: "process", ...(input.process as object) } });
    }
    if (kinds.includes("bmc") && input.bmc) {
      results.push({ kind: "bmc", model: { kind: "bmc", ...(input.bmc as object) } });
    }
    return json({ results });
  } catch (e) {
    console.error("[extract-artifact] unexpected error", e);
    return json({ error: "Unexpected error during extraction." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

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
//
// The actual Claude call lives in ../_shared/extraction.ts, shared with
// scheduled-drift-scan so the interactive and background paths can't drift
// apart from each other.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callAnthropicExtraction, MIN_TEXT_CHARS } from "../_shared/extraction.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_PER_HOUR = 30;

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
    const kinds = allowedKinds.filter((k) => k === "process" || k === "bmc") as string[];
    if (kinds.length === 0) return json({ error: "No valid artifact kinds requested." }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Extraction isn't configured yet (missing API key)." }, 500);

    let results;
    try {
      results = await callAnthropicExtraction(trimmed, kinds, apiKey);
    } catch (e) {
      console.error("[extract-artifact] Anthropic error", e);
      return json({ error: "Extraction failed upstream. Try again." }, 502);
    }

    // Logged only once the call actually succeeded and cost money.
    await supabase.from("extraction_log").insert({ user_id: userId });

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

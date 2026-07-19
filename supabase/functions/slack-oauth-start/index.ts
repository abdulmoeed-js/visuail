// Step 1 of the Slack OAuth flow: verifies the caller is signed in and is
// the owner of the org they're connecting Slack to, mints a single-use
// state token, and returns the Slack authorize URL for the client to
// redirect to. Uses the incoming-webhook scope, so Slack's own consent
// screen asks the installing user which channel to post to -- no separate
// channel-picker UI needed in Visuail.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in required." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sign in required." }, 401);

    const body = await req.json().catch(() => null);
    const orgId: unknown = body?.orgId;
    const redirectUri: unknown = body?.redirectUri;
    if (typeof orgId !== "string" || typeof redirectUri !== "string") {
      return json({ error: "Missing orgId or redirectUri." }, 400);
    }

    const { data: isOwner } = await supabase.rpc("is_org_owner", { check_org_id: orgId });
    if (!isOwner) return json({ error: "Only the workspace owner can connect Slack." }, 403);

    const clientId = Deno.env.get("SLACK_CLIENT_ID");
    if (!clientId) return json({ error: "Slack integration isn't configured yet." }, 500);

    const { data: stateRow, error: stateErr } = await supabase
      .from("slack_oauth_state")
      .insert({ org_id: orgId, user_id: userData.user.id })
      .select("state")
      .single();
    if (stateErr) return json({ error: "Couldn't start the Slack connection. Try again." }, 500);

    const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("scope", "incoming-webhook");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", (stateRow as { state: string }).state);

    return json({ url: authorizeUrl.toString() });
  } catch (e) {
    console.error("[slack-oauth-start] unexpected error", e);
    return json({ error: "Unexpected error." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

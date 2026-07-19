// Step 2: Slack redirects the browser here with ?code&state after the user
// approves the install. No user JWT is present (Slack doesn't forward one),
// so the state token minted by slack-oauth-start is the entire trust
// boundary -- it must exist, be unexpired, and gets deleted immediately
// (single-use) before the code exchange even happens.

import { createClient } from "jsr:@supabase/supabase-js@2";

const STATE_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://id-preview--af93f212-53f2-471a-b865-406fc0935f89.lovable.app";

  const fail = (reason: string) =>
    Response.redirect(`${appOrigin}/dashboard?slack_error=${encodeURIComponent(reason)}`, 302);

  if (!code || !state) return fail("missing_params");

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: stateRow, error: stateErr } = await supabase
    .from("slack_oauth_state")
    .select("org_id, user_id, created_at")
    .eq("state", state)
    .single();
  if (stateErr || !stateRow) return fail("invalid_state");

  // Single-use, regardless of what happens next.
  await supabase.from("slack_oauth_state").delete().eq("state", state);

  const age = Date.now() - new Date(stateRow.created_at).getTime();
  if (age > STATE_TTL_MS) return fail("expired_state");

  const clientId = Deno.env.get("SLACK_CLIENT_ID");
  const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");
  if (!clientId || !clientSecret) return fail("not_configured");

  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/slack-oauth-callback`;
  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.ok) {
    console.error("[slack-oauth-callback] Slack token exchange failed", tokenData);
    return fail("slack_exchange_failed");
  }

  const webhook = tokenData.incoming_webhook;
  if (!webhook?.url) return fail("no_webhook_in_response");

  const { error: upsertErr } = await supabase.from("org_slack_integration").upsert({
    org_id: stateRow.org_id,
    access_token: tokenData.access_token,
    slack_team_name: tokenData.team?.name ?? "Slack workspace",
    channel_id: webhook.channel_id,
    channel_name: webhook.channel,
    webhook_url: webhook.url,
    installed_by: stateRow.user_id,
  });
  if (upsertErr) {
    console.error("[slack-oauth-callback] upsert failed", upsertErr);
    return fail("save_failed");
  }

  return Response.redirect(`${appOrigin}/dashboard?slack_connected=1`, 302);
});

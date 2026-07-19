// The only thing allowed to write organizations.tier or subscriptions from
// here on. LemonSqueezy calls this directly with no user auth, so the HMAC
// signature (X-Signature, verified against LEMONSQUEEZY_WEBHOOK_SECRET) is
// the entire trust boundary -- same pattern as the Slack OAuth state-token
// check, just HMAC instead of a single-use token. verify_jwt is off because
// there's no Supabase user session involved in this request at all.

import { createClient } from "jsr:@supabase/supabase-js@2";

type SubStatus = "active" | "past_due" | "cancelled" | "expired" | "paused";

const RELEVANT_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "subscription_payment_success",
  "subscription_payment_failed",
]);

function mapStatus(lsStatus: string): SubStatus {
  switch (lsStatus) {
    case "active":
    case "on_trial":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    default:
      return "past_due";
  }
}

async function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const digestHex = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(digestHex, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function tierForVariant(variantId: unknown): "pro" | "team" | null {
  const id = String(variantId);
  if (id === Deno.env.get("LEMONSQUEEZY_VARIANT_ID_PRO")) return "pro";
  if (id === Deno.env.get("LEMONSQUEEZY_VARIANT_ID_TEAM")) return "team";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET");
  if (!secret) {
    console.error("[lemonsqueezy-webhook] LEMONSQUEEZY_WEBHOOK_SECRET not set");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature") ?? req.headers.get("x-signature");
  const valid = await verifySignature(rawBody, signature, secret).catch(() => false);
  if (!valid) {
    console.error("[lemonsqueezy-webhook] invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    meta?: { event_name?: string; custom_data?: { org_id?: string } };
    data?: { id?: string; attributes?: Record<string, unknown> };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventName = payload.meta?.event_name;
  if (!eventName || !RELEVANT_EVENTS.has(eventName)) {
    return new Response(JSON.stringify({ ignored: true }), { headers: { "content-type": "application/json" } });
  }

  const attrs = payload.data?.attributes ?? {};
  const providerSubscriptionId = payload.data?.id;
  if (!providerSubscriptionId) return new Response("Missing subscription id", { status: 400 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let orgId = payload.meta?.custom_data?.org_id;
  if (!orgId) {
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("org_id")
      .eq("provider", "lemonsqueezy")
      .eq("provider_subscription_id", providerSubscriptionId)
      .maybeSingle();
    orgId = existing?.org_id;
  }
  if (!orgId) {
    console.error("[lemonsqueezy-webhook] no org_id resolvable for subscription", providerSubscriptionId);
    return new Response(JSON.stringify({ error: "org not resolvable" }), { status: 200 });
  }

  const status = mapStatus(String(attrs.status ?? ""));
  const tier = tierForVariant(attrs.variant_id) ?? "pro";

  const { error: upsertErr } = await supabase.from("subscriptions").upsert(
    {
      org_id: orgId,
      provider: "lemonsqueezy",
      provider_subscription_id: providerSubscriptionId,
      provider_customer_id: attrs.customer_id != null ? String(attrs.customer_id) : null,
      status,
      tier,
      current_period_end: attrs.renews_at ?? attrs.ends_at ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,provider_subscription_id" },
  );
  if (upsertErr) {
    console.error("[lemonsqueezy-webhook] subscriptions upsert failed", upsertErr);
    return new Response("DB error", { status: 500 });
  }

  // Only flip the org's live tier on the outcomes that should actually
  // change access: a real active subscription grants it, and cancellation
  // or expiry revokes it. past_due/paused/payment_failed keep today's tier
  // in place (grace period) and surface as a banner instead -- see
  // Payments Slice 6. This mirrors the spec's explicit choice not to punish
  // a user for one failed renewal attempt.
  if (status === "active") {
    await supabase.from("organizations").update({ tier, updated_at: new Date().toISOString() }).eq("id", orgId);
  } else if (status === "cancelled" || status === "expired") {
    await supabase.from("organizations").update({ tier: "free", updated_at: new Date().toISOString() }).eq("id", orgId);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
});

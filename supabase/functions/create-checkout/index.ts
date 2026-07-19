// Creates a real LemonSqueezy hosted-checkout URL for an org to upgrade to
// Pro or Team. Visuail never touches card data -- the client redirects the
// user straight to the URL this returns, and LemonSqueezy hosts the actual
// payment form. Tier activation itself happens later, out of band, when
// lemonsqueezy-webhook receives the resulting subscription_created event.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VARIANT_ENV_BY_TIER: Record<string, string> = {
  pro: "LEMONSQUEEZY_VARIANT_ID_PRO",
  team: "LEMONSQUEEZY_VARIANT_ID_TEAM",
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
    const tier: unknown = body?.tier;
    if (typeof orgId !== "string" || (tier !== "pro" && tier !== "team")) {
      return json({ error: "Missing orgId or invalid tier." }, 400);
    }

    const { data: isOwner } = await supabase.rpc("is_org_owner", { check_org_id: orgId });
    if (!isOwner) return json({ error: "Only the workspace owner can upgrade the plan." }, 403);

    const apiKey = Deno.env.get("LEMONSQUEEZY_API_KEY");
    const storeId = Deno.env.get("LEMONSQUEEZY_STORE_ID");
    const variantId = Deno.env.get(VARIANT_ENV_BY_TIER[tier]);
    if (!apiKey || !storeId || !variantId) {
      return json({ error: "Payments aren't configured yet. Try again shortly." }, 500);
    }

    const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://id-preview--af93f212-53f2-471a-b865-406fc0935f89.lovable.app";

    const lsRes = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              email: userData.user.email,
              custom: { org_id: orgId },
            },
            product_options: {
              redirect_url: `${appOrigin}/dashboard?checkout=success`,
            },
          },
          relationships: {
            store: { data: { type: "stores", id: storeId } },
            variant: { data: { type: "variants", id: variantId } },
          },
        },
      }),
    });

    if (!lsRes.ok) {
      const errBody = await lsRes.text();
      console.error("[create-checkout] LemonSqueezy error", lsRes.status, errBody);
      return json({ error: "Couldn't start checkout. Try again." }, 502);
    }

    const lsData = await lsRes.json();
    const url = lsData?.data?.attributes?.url;
    if (typeof url !== "string") {
      console.error("[create-checkout] unexpected LemonSqueezy response shape", lsData);
      return json({ error: "Couldn't start checkout. Try again." }, 502);
    }

    return json({ url });
  } catch (e) {
    console.error("[create-checkout] unexpected error", e);
    return json({ error: "Unexpected error." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

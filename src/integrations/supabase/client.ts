import { createClient } from "@supabase/supabase-js";

// Project URL follows Supabase's fixed, documented scheme
// (https://<project-ref>.supabase.co) — safe to keep in source, same as any
// public API endpoint. The publishable/anon key is deliberately client-safe
// too (that's what "publishable" means), but it lives in a Lovable secret
// rather than source so it can be rotated without a code change.
const SUPABASE_URL = "https://osnpexjxxwwvsjfegmga.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!SUPABASE_PUBLISHABLE_KEY && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] VITE_SUPABASE_PUBLISHABLE_KEY is not set — check the secret name " +
      "in Lovable's project settings matches exactly.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY ?? "");

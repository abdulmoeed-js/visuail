import { createClient } from "@supabase/supabase-js";

// Both values are deliberately client-safe: the URL is a public endpoint,
// and a publishable key (sb_publishable_ prefix) is designed to ship in the
// browser bundle — row-level security on the database is what protects the
// data, not key secrecy. Rotating the key in the Supabase dashboard just
// means updating this constant.
const SUPABASE_URL = "https://xlatbdyusxcjmwqzngpa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9fWlwSSeyVv2Zm2pCKrItQ_zGCfiUhR";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

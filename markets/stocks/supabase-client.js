import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";

const SUPABASE_URL = "https://atvbjibhunvzpmfagagm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kdTDQxlrYkry8mK4Ptlc9w_6oZJEYRQ";

if (!SUPABASE_URL.startsWith("https://") || !SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
  throw new Error("ZENURA Supabase public client configuration is invalid.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce"
  },
  global: {
    headers: { "X-Client-Info": "zenura-ignite-market-web" }
  }
});

if (typeof window !== "undefined") window.ZENURA_SUPABASE = supabase;

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // During build, env vars may not be available
    if (typeof window === "undefined" && process.env.NODE_ENV !== "development") {
      // Return placeholder for build-time
      return "";
    }
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getSupabaseClient(): SupabaseClient {
  if (_supabase) {
    return _supabase;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // During build, use placeholder values
  if (!url || !key) {
    _supabase = createClient("https://placeholder.supabase.co", "placeholder-key");
    return _supabase;
  }

  _supabase = createClient(url, key);
  return _supabase;
}

export const supabase = getSupabaseClient();





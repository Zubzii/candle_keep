import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabaseServer: SupabaseClient | null = null;

/**
 * Server-side Supabase client using service role key.
 * Use this in API routes and server components only.
 * 
 * The service role key bypasses RLS, so use with caution.
 * 
 * Lazy-loaded to avoid build-time errors when env vars aren't set.
 */
export function getServerSupabase(): SupabaseClient {
  if (_supabaseServer) {
    return _supabaseServer;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "These are required for server-side operations."
    );
  }

  _supabaseServer = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _supabaseServer;
}

// Export as default for convenience, but prefer getServerSupabase() for clarity
export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return getServerSupabase()[prop as keyof SupabaseClient];
  },
});


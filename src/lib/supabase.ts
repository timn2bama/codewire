import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client. Optional by design: when the env vars are absent (e.g. local
 * dev without a project, or a pure-offline build), `supabase` is null and the app
 * runs in free, on-device-only mode. Cloud features check `isCloudConfigured`.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isCloudConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

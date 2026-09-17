import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

declare global {
  interface Window {
    __AP_SUPABASE__?: { url?: string; anonKey?: string };
  }
}

let browserClient: SupabaseClient | null = null;

function resolveBrowserConfig(): { url: string; key: string } | null {
  // 1) Build-time / NEXT_PUBLIC_* (optional)
  const fromEnvUrl = getSupabaseUrl();
  const fromEnvKey = getSupabaseAnonKey();
  if (fromEnvUrl && fromEnvKey) return { url: fromEnvUrl, key: fromEnvKey };

  // 2) Server-injected runtime config (private SUPABASE_* on Vercel, no NEXT_PUBLIC_ prefix)
  if (typeof window !== "undefined" && window.__AP_SUPABASE__) {
    const url = window.__AP_SUPABASE__.url?.trim();
    const key = window.__AP_SUPABASE__.anonKey?.trim();
    if (url && key) return { url, key };
  }
  return null;
}

/**
 * Browser Supabase client.
 * Supports private server env (SUPABASE_URL + SUPABASE_ANON_KEY) via layout injection,
 * or classic NEXT_PUBLIC_* vars.
 */
export function createClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const cfg = resolveBrowserConfig();
  if (!cfg) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_* equivalents)."
    );
  }
  browserClient = createBrowserClient(cfg.url, cfg.key);
  return browserClient;
}

/** @deprecated Prefer createClient() after layout injection. */
export async function createClientAsync(): Promise<SupabaseClient> {
  return createClient();
}

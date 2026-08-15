import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel (must be the JWT anon key, not the publishable sb_ key)."
    );
  }

  // Guard against wrong key type pasted into Vercel
  if (key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) {
    throw new Error(
      "Wrong Supabase key. Use the legacy JWT anon key (starts with eyJ...), not the new publishable key."
    );
  }

  return createBrowserClient(url, key);
}

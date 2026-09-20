import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

/** Service-role client — no Next.js / @supabase/ssr (safe for worker). */
export { createServiceClient } from "@/lib/supabase/service";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/**
 * User-scoped App Router client.
 * Dynamically imports @supabase/ssr + next/headers so Node workers that only
 * re-export createServiceClient never resolve those packages at load time.
 */
export async function createClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or publishable key)."
    );
  }

  const [{ createServerClient }, { cookies }] = await Promise.all([
    import("@supabase/ssr"),
    import("next/headers"),
  ]);

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component — middleware refreshes sessions.
        }
      },
    },
  });
}

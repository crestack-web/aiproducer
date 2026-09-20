import { createServerClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

export { createServiceClient } from "@/lib/supabase/service";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

/**
 * User-scoped server client (App Router). Uses next/headers only when called.
 */
export async function createClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or publishable key)."
    );
  }

  const { cookies } = await import("next/headers");
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
          // Called from a Server Component — middleware handles refresh.
        }
      },
    },
  });
}

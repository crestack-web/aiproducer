/**
 * Resolve Supabase env across classic names and Vercel Supabase integration mappings.
 *
 * Integration often provides (server):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY
 * next.config maps URL + anon into NEXT_PUBLIC_* at build for the browser.
 */

function firstDefined(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) return t;
  }
  return undefined;
}

export function getSupabaseUrl(): string | undefined {
  return firstDefined(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL
  );
}

/** Browser / user-scoped key (anon or publishable). Prefer JWT eyJ… when present. */
export function getSupabaseAnonKey(): string | undefined {
  const candidates = [
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  const jwt = candidates.find((k) => k.startsWith("eyJ"));
  if (jwt) return jwt;
  return candidates[0] || undefined;
}

/** Service role — never expose to the browser. */
export function getSupabaseServiceRoleKey(): string | undefined {
  return firstDefined(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY
  );
}

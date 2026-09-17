/**
 * Resolve Supabase env vars across legacy names and Vercel Supabase integration mappings.
 * Prefer JWT-style anon keys (eyJ...) for SSR when both anon + publishable exist.
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

/** Browser / user-scoped key (anon or publishable). */
export function getSupabaseAnonKey(): string | undefined {
  const candidates = [
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  // Prefer legacy JWT anon key when present
  const jwt = candidates.find((k) => k.startsWith("eyJ"));
  if (jwt) return jwt;

  return candidates[0] || undefined;
}

/** Service role / secret — never expose to the browser. */
export function getSupabaseServiceRoleKey(): string | undefined {
  return firstDefined(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY
  );
}

/**
 * Resolve Supabase env across classic names and Vercel Supabase integration mappings.
 *
 * Prefer legacy JWT keys (eyJ...) when present — most reliable with @supabase/ssr.
 * New publishable/secret keys (sb_publishable_ / sb_secret_) are used as fallback.
 */

function firstDefined(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) return t;
  }
  return undefined;
}

function preferJwt(candidates: string[]): string | undefined {
  const jwt = candidates.find((k) => k.startsWith("eyJ"));
  if (jwt) return jwt;
  return candidates[0];
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
  return preferJwt(candidates);
}

/**
 * Service role for admin APIs (generateLink, etc.).
 * Prefer classic service_role JWT; fall back to SUPABASE_SECRET_KEY.
 */
export function getSupabaseServiceRoleKey(): string | undefined {
  const candidates = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SECRET_KEY,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  return preferJwt(candidates) || candidates[0];
}

/** Safe diagnostics — never returns secret values. */
export function getSupabaseEnvDiagnostics() {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  const service = getSupabaseServiceRoleKey();
  const prefix = (k?: string) => {
    if (!k) return null;
    if (k.startsWith("eyJ")) return "jwt";
    if (k.startsWith("sb_publishable_")) return "sb_publishable";
    if (k.startsWith("sb_secret_")) return "sb_secret";
    return "other";
  };
  return {
    has_url: Boolean(url),
    url_host: url ? (() => { try { return new URL(url).host; } catch { return "invalid_url"; } })() : null,
    anon_key_kind: prefix(anon),
    service_key_kind: prefix(service),
    has_resend: Boolean(process.env.RESEND_API_KEY?.trim()),
    has_resend_from: Boolean(
      process.env.RESEND_FROM_EMAIL?.trim() || process.env.EMAIL_FROM?.trim()
    ),
  };
}

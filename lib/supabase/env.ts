/**
 * Resolve Supabase credentials across:
 * - Classic NEXT_PUBLIC_* / SUPABASE_SERVICE_ROLE_KEY
 * - Vercel Supabase integration (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY, …)
 * - Newer publishable/secret key names (sb_publishable_ / sb_secret_)
 *
 * Prefer JWT (eyJ…) when multiple values exist — most reliable with @supabase/ssr.
 */

function trim(v: string | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

function first(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) {
    const t = trim(v);
    if (t) return t;
  }
  return undefined;
}

function preferJwt(candidates: string[]): string | undefined {
  const list = candidates.map(trim).filter(Boolean);
  const jwt = list.find((k) => k.startsWith("eyJ"));
  if (jwt) return jwt;
  // Prefer classic-looking long keys over empty
  return list[0];
}

/** Project URL */
export function getSupabaseUrl(): string | undefined {
  return first(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL,
    // Occasional integration aliases
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL,
    process.env.SUPABASE_PROJECT_URL
  );
}

/**
 * Anon / publishable key for browser + user-scoped server clients.
 * Order: explicit NEXT_PUBLIC anon → integration anon → publishable variants.
 */
export function getSupabaseAnonKey(): string | undefined {
  return preferJwt([
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    process.env.SUPABASE_ANON_KEY || "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
    // Some integrations only set non-prefixed publishable
    process.env.NEXT_PUBLIC_SUPABASE_KEY || "",
    process.env.SUPABASE_KEY || "",
  ]);
}

/**
 * Service role / secret for admin APIs (generateLink, storage service, jobs).
 * Prefer service_role JWT; fall back to SUPABASE_SECRET_KEY (sb_secret_ or JWT).
 */
export function getSupabaseServiceRoleKey(): string | undefined {
  return preferJwt([
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    process.env.SUPABASE_SECRET_KEY || "",
    process.env.SUPABASE_SERVICE_KEY || "",
  ]);
}

/** Safe diagnostics — never returns secret values. */
export function getSupabaseEnvDiagnostics() {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  const service = getSupabaseServiceRoleKey();
  const kind = (k?: string) => {
    if (!k) return null;
    if (k.startsWith("eyJ")) return "jwt";
    if (k.startsWith("sb_publishable_")) return "sb_publishable";
    if (k.startsWith("sb_secret_")) return "sb_secret";
    return "other";
  };
  let url_host: string | null = null;
  if (url) {
    try {
      url_host = new URL(url).host;
    } catch {
      url_host = "invalid_url";
    }
  }
  return {
    has_url: Boolean(url),
    url_host,
    anon_key_kind: kind(anon),
    service_key_kind: kind(service),
    // Which name families are present (boolean only)
    present: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(trim(process.env.NEXT_PUBLIC_SUPABASE_URL)),
      SUPABASE_URL: Boolean(trim(process.env.SUPABASE_URL)),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(trim(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
      SUPABASE_ANON_KEY: Boolean(trim(process.env.SUPABASE_ANON_KEY)),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(
        trim(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
      ),
      SUPABASE_PUBLISHABLE_KEY: Boolean(trim(process.env.SUPABASE_PUBLISHABLE_KEY)),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(trim(process.env.SUPABASE_SERVICE_ROLE_KEY)),
      SUPABASE_SECRET_KEY: Boolean(trim(process.env.SUPABASE_SECRET_KEY)),
    },
    has_resend: Boolean(trim(process.env.RESEND_API_KEY)),
    has_resend_from: Boolean(
      trim(process.env.RESEND_FROM_EMAIL) || trim(process.env.EMAIL_FROM)
    ),
  };
}

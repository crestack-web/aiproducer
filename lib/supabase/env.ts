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
  // Private server names first (Vercel: no NEXT_PUBLIC_ prefix → no "public" warning)
  return first(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PROJECT_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL
  );
}

/**
 * Anon / publishable key for browser + user-scoped server clients.
 * Private integration names first (SUPABASE_ANON_KEY, …), then NEXT_PUBLIC_* fallbacks.
 */
export function getSupabaseAnonKey(): string | undefined {
  return preferJwt([
    process.env.SUPABASE_ANON_KEY || "",
    process.env.SUPABASE_PUBLISHABLE_KEY || "",
    process.env.SUPABASE_KEY || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    process.env.NEXT_PUBLIC_SUPABASE_KEY || "",
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


/** Decode JWT payload role without verifying signature (diagnostics only). */
export function decodeSupabaseJwtRole(key: string | undefined): string | null {
  if (!key || !key.startsWith("eyJ")) return null;
  try {
    const parts = key.split(".");
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { role?: string };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Worker-safe key diagnostics — never logs full secrets.
 * Detects accidental anon/publishable key in SERVICE_ROLE slot.
 */
export function getServiceRoleKeyDiagnostics() {
  const raw =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() ||
    (process.env.SUPABASE_SECRET_KEY || "").trim() ||
    (process.env.SUPABASE_SERVICE_KEY || "").trim() ||
    "";
  const source = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    ? "SUPABASE_SERVICE_ROLE_KEY"
    : process.env.SUPABASE_SECRET_KEY?.trim()
      ? "SUPABASE_SECRET_KEY"
      : process.env.SUPABASE_SERVICE_KEY?.trim()
        ? "SUPABASE_SERVICE_KEY"
        : "none";
  const role = decodeSupabaseJwtRole(raw);
  const prefix = raw ? raw.slice(0, 8) : null;
  const kind = !raw
    ? null
    : raw.startsWith("eyJ")
      ? "jwt"
      : raw.startsWith("sb_secret_")
        ? "sb_secret"
        : raw.startsWith("sb_publishable_")
          ? "sb_publishable"
          : "other";
  const looksWrong =
    role === "anon" ||
    role === "authenticated" ||
    kind === "sb_publishable" ||
    (kind === "jwt" && role !== null && role !== "service_role");
  return {
    source,
    key_prefix: prefix,
    key_kind: kind,
    jwt_role: role,
    /** true if this key will NOT bypass RLS / cannot claim jobs */
    looks_like_non_service_role: looksWrong,
    key_length: raw.length || 0,
  };
}

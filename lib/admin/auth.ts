/**
 * Simple admin gate — allowlist of emails via ADMIN_EMAILS env
 * (comma-separated). Optional: profiles.role = "admin" or metadata.is_admin.
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function requireAdmin(): Promise<
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const email = user.email.trim().toLowerCase();
  const allow = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allow.includes(email)) {
    return { ok: true, userId: user.id, email };
  }

  // Profile role fallback
  try {
    const service = createServiceClient();
    const { data: profile } = await service
      .from("profiles")
      .select("role, metadata")
      .eq("id", user.id)
      .maybeSingle();
    const role = String((profile as { role?: string } | null)?.role || "").toLowerCase();
    const meta = ((profile as { metadata?: Record<string, unknown> } | null)?.metadata ||
      {}) as Record<string, unknown>;
    if (role === "admin" || meta.is_admin === true) {
      return { ok: true, userId: user.id, email };
    }
  } catch {
    /* ignore */
  }

  return { ok: false, status: 403, error: "Admin access required" };
}

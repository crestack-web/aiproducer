/**
 * Commercial access — download / license unlock.
 * Preview & in-app listening stay free; export needs plan, paid session, or allowlisted account.
 */
import { createServiceClient } from "@/lib/supabase/service";

export type CommercialAccess = {
  ok: boolean;
  reason?: "login" | "payment_required";
  source?: "project_unlock" | "subscription" | "admin" | "allowlist";
  message?: string;
};

/** Always-free download accounts (owner / internal). Comma-separated env AP_FREE_DOWNLOAD_EMAILS extends this. */
const BUILTIN_FREE_DOWNLOAD_EMAILS = ["crestack@gmail.com"];

function freeDownloadEmails(): Set<string> {
  const set = new Set(BUILTIN_FREE_DOWNLOAD_EMAILS.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const extra = (process.env.AP_FREE_DOWNLOAD_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  for (const e of extra) set.add(e);
  return set;
}

async function resolveUserEmail(userId: string): Promise<string | null> {
  const service = createServiceClient();
  try {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (!error && data?.user?.email) return String(data.user.email).trim().toLowerCase();
  } catch {
    /* ignore */
  }
  try {
    const { data: profile } = await service
      .from("profiles")
      .select("email, metadata")
      .eq("id", userId)
      .maybeSingle();
    if (profile && typeof (profile as { email?: string }).email === "string") {
      return String((profile as { email: string }).email).trim().toLowerCase();
    }
    const meta = ((profile as { metadata?: Record<string, unknown> } | null)?.metadata ||
      {}) as Record<string, unknown>;
    if (typeof meta.email === "string") return String(meta.email).trim().toLowerCase();
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Full commercial license path: allowlisted email, paid session on this project, or active Creator/Pro.
 */
export async function assertCommercialDownloadAccess(
  userId: string,
  projectId: string,
  opts?: { email?: string | null }
): Promise<CommercialAccess> {
  const service = createServiceClient();

  const email =
    (opts?.email && String(opts.email).trim().toLowerCase()) ||
    (await resolveUserEmail(userId));
  if (email && freeDownloadEmails().has(email)) {
    return { ok: true, source: "allowlist" };
  }

  const { data: project } = await service
    .from("projects")
    .select("id, user_id, metadata")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.user_id !== userId) {
    return { ok: false, reason: "login", message: "Project not found." };
  }

  const meta = (project.metadata || {}) as Record<string, unknown>;
  if (meta.download_unlocked === true || meta.session_paid === true) {
    return { ok: true, source: "project_unlock" };
  }

  // Profile-level subscription (Creator / Pro)
  const { data: profile } = await service
    .from("profiles")
    .select("id, metadata")
    .eq("id", userId)
    .maybeSingle();

  const pMeta = ((profile as { metadata?: Record<string, unknown> } | null)?.metadata ||
    {}) as Record<string, unknown>;
  const plan = String(pMeta.subscription_plan || pMeta.plan || "").toLowerCase();

  if (plan === "creator" || plan === "pro") {
    const expires = pMeta.subscription_expires_at
      ? Date.parse(String(pMeta.subscription_expires_at))
      : null;
    if (!expires || Number.isNaN(expires) || expires > Date.now()) {
      return { ok: true, source: "subscription" };
    }
  }

  // Any other project unlocked with subscription_plan for this user (legacy)
  const { data: subProjects } = await service
    .from("projects")
    .select("id, metadata")
    .eq("user_id", userId)
    .limit(40);

  for (const row of subProjects || []) {
    const m = (row.metadata || {}) as Record<string, unknown>;
    const sp = String(m.subscription_plan || "").toLowerCase();
    if (sp === "creator" || sp === "pro") {
      return { ok: true, source: "subscription" };
    }
  }

  return {
    ok: false,
    reason: "payment_required",
    message:
      "Unlock this song to download — pay for this session or subscribe to Creator / Pro.",
  };
}

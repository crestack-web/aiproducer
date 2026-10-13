import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApSessionRole } from "./types";
import { roleCan, type RolePermKey } from "./types";

export async function getProjectOwnerId(
  supabase: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .maybeSingle();
  return (data?.user_id as string) || null;
}

/** Membership for active session (left_at is null). Uses service client when needed for cross-user. */
export async function getMemberRole(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<ApSessionRole | null> {
  const { data } = await supabase
    .from("ap_session_members")
    .select("role, left_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.left_at) return null;
  return data.role as ApSessionRole;
}

export async function assertSessionPerm(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  perm: RolePermKey
): Promise<{ ok: true; role: ApSessionRole } | { ok: false; status: number; error: string }> {
  const role = await getMemberRole(supabase, sessionId, userId);
  if (!role) {
    return { ok: false, status: 403, error: "Not a session member" };
  }
  if (!roleCan(role, perm)) {
    return { ok: false, status: 403, error: `Role '${role}' cannot ${perm}` };
  }
  return { ok: true, role };
}

export function randomInviteToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

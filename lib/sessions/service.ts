import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApSession, ApSessionInvite, ApSessionMember, ApSessionRole } from "./types";
import { getProjectOwnerId, randomInviteToken, assertSessionPerm, getMemberRole } from "./access";
import { createServiceClient } from "@/lib/supabase/service";

/** Prefer service role for membership writes (RLS has no INSERT on ap_session_members). */
function adminClient(fallback: SupabaseClient): SupabaseClient {
  try {
    return createServiceClient();
  } catch (e) {
    console.warn("sessions: service role unavailable, falling back to user client", e);
    return fallback;
  }
}

/** Ensure user is an active member; insert/upsert via service role when needed. */
async function ensureMember(
  userClient: SupabaseClient,
  sessionId: string,
  userId: string,
  role: ApSessionRole
): Promise<{ ok: true } | { error: string; status: number }> {
  const existing = await getMemberRole(userClient, sessionId, userId);
  if (existing) return { ok: true };

  const db = adminClient(userClient);
  const { data: row } = await db
    .from("ap_session_members")
    .select("id, left_at, role")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (row && !row.left_at) return { ok: true };

  if (row && row.left_at) {
    const { error } = await db
      .from("ap_session_members")
      .update({ left_at: null, role, joined_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      console.error("ensureMember rejoin", error);
      return { error: "Could not restore session membership", status: 500 };
    }
    return { ok: true };
  }

  const { error } = await db.from("ap_session_members").insert({
    session_id: sessionId,
    user_id: userId,
    role,
  });
  if (error) {
    // unique violation → already a member
    if (String(error.code) === "23505" || /duplicate/i.test(error.message || "")) {
      return { ok: true };
    }
    console.error("ensureMember insert", error);
    return { error: "Could not add session membership", status: 500 };
  }
  return { ok: true };
}

export async function createApSession(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    userId: string;
    name?: string;
  }
): Promise<{ session: ApSession } | { error: string; status: number }> {
  const ownerId = await getProjectOwnerId(supabase, opts.projectId);
  if (!ownerId) return { error: "Project not found", status: 404 };
  if (ownerId !== opts.userId) {
    return { error: "Only the project owner can create an AP Session", status: 403 };
  }

  // Reuse active session for this project if one exists
  const { data: existing } = await supabase
    .from("ap_sessions")
    .select("*")
    .eq("project_id", opts.projectId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const mem = await ensureMember(supabase, existing.id as string, opts.userId, "owner");
    if ("error" in mem) return mem;
    return { session: existing as ApSession };
  }

  const name = (opts.name || "AP Session").trim().slice(0, 80) || "AP Session";
  const { data: session, error } = await supabase
    .from("ap_sessions")
    .insert({
      project_id: opts.projectId,
      created_by: opts.userId,
      name,
      status: "active",
    })
    .select("*")
    .single();

  if (error || !session) {
    console.error("createApSession", error);
    return { error: "Could not create session", status: 500 };
  }

  const mem = await ensureMember(supabase, session.id as string, opts.userId, "owner");
  if ("error" in mem) {
    console.error("createApSession member", mem);
    // Session exists but membership failed — still return session; invite path will retry ensureMember
  }

  const db = adminClient(supabase);
  await db.from("ap_session_events").insert({
    session_id: session.id,
    actor_id: opts.userId,
    event_type: "session_created",
    payload: { name },
  });

  return { session: session as ApSession };
}

export async function createInvite(
  supabase: SupabaseClient,
  opts: {
    sessionId: string;
    userId: string;
    role: ApSessionRole;
    expiresInHours?: number;
    maxUses?: number;
    invitedEmail?: string;
  }
): Promise<{ invite: ApSessionInvite; joinPath: string } | { error: string; status: number }> {
  if (opts.role === "owner") {
    return { error: "Cannot invite as owner", status: 400 };
  }

  // Load session — allow project owner / session creator even if membership row was missing (RLS gap)
  const { data: session } = await supabase
    .from("ap_sessions")
    .select("id, created_by, project_id, status")
    .eq("id", opts.sessionId)
    .maybeSingle();

  if (!session) {
    return { error: "Session not found", status: 404 };
  }
  if (session.status === "ended") {
    return { error: "Session has ended", status: 400 };
  }

  const ownerId = session.project_id
    ? await getProjectOwnerId(supabase, session.project_id as string)
    : null;
  const isCreator = session.created_by === opts.userId;
  const isProjectOwner = ownerId === opts.userId;

  let perm = await assertSessionPerm(supabase, opts.sessionId, opts.userId, "invite");
  if (!perm.ok) {
    if (isCreator || isProjectOwner) {
      const mem = await ensureMember(supabase, opts.sessionId, opts.userId, "owner");
      if ("error" in mem) return mem;
      perm = await assertSessionPerm(supabase, opts.sessionId, opts.userId, "invite");
    }
  }
  if (!perm.ok) {
    return { error: perm.error, status: perm.status };
  }

  const token = randomInviteToken();
  const expiresAt =
    opts.expiresInHours && opts.expiresInHours > 0
      ? new Date(Date.now() + opts.expiresInHours * 3600_000).toISOString()
      : null;

  // Insert invite with service role so missing membership RLS edge cases don't block creators.
  // Some production DBs were created before max_uses/use_count existed — try full row, then core columns.
  const db = adminClient(supabase);
  const baseRow: Record<string, unknown> = {
    session_id: opts.sessionId,
    token,
    role: opts.role,
    created_by: opts.userId,
    expires_at: expiresAt,
    invited_email: opts.invitedEmail || null,
  };
  const fullRow = {
    ...baseRow,
    max_uses: opts.maxUses ?? 20,
    use_count: 0,
  };

  let data: Record<string, unknown> | null = null;
  let error: { message?: string; code?: string } | null = null;

  {
    const res = await db.from("ap_session_invites").insert(fullRow).select("*").single();
    data = res.data as Record<string, unknown> | null;
    error = res.error;
  }

  if (error && /max_uses|use_count|schema cache/i.test(error.message || "")) {
    console.warn("createInvite: retrying without max_uses/use_count", error.message);
    const res = await db.from("ap_session_invites").insert(baseRow).select("*").single();
    data = res.data as Record<string, unknown> | null;
    error = res.error;
  }

  if (error || !data) {
    console.error("createInvite", error);
    return {
      error: error?.message ? `Could not create invite: ${error.message}` : "Could not create invite",
      status: 500,
    };
  }

  await db.from("ap_session_events").insert({
    session_id: opts.sessionId,
    actor_id: opts.userId,
    event_type: "invite_created",
    payload: { role: opts.role, invite_id: data.id },
  });

  return {
    invite: data as ApSessionInvite,
    joinPath: `/app/sessions/join?token=${token}`,
  };
}

export async function acceptInvite(
  service: SupabaseClient,
  opts: { token: string; userId: string }
): Promise<
  | { sessionId: string; projectId: string; role: ApSessionRole }
  | { error: string; status: number }
> {
  const { data: invite } = await service
    .from("ap_session_invites")
    .select("*")
    .eq("token", opts.token)
    .maybeSingle();

  if (!invite) return { error: "Invalid invite", status: 404 };
  if (invite.revoked_at) return { error: "Invite revoked", status: 410 };
  if (invite.expires_at && new Date(invite.expires_at as string).getTime() < Date.now()) {
    return { error: "Invite expired", status: 410 };
  }
  const maxUses =
    typeof invite.max_uses === "number" && Number.isFinite(invite.max_uses)
      ? (invite.max_uses as number)
      : 20;
  const useCount =
    typeof invite.use_count === "number" && Number.isFinite(invite.use_count)
      ? (invite.use_count as number)
      : 0;
  if (invite.max_uses != null && useCount >= maxUses) {
    return { error: "Invite has no uses left", status: 410 };
  }

  const { data: session } = await service
    .from("ap_sessions")
    .select("id, project_id, status")
    .eq("id", invite.session_id)
    .maybeSingle();
  if (!session) return { error: "Session not found", status: 404 };
  if (session.status === "ended") return { error: "Session has ended", status: 400 };

  const role = (invite.role as ApSessionRole) || "artist";
  if (role === "owner") return { error: "Invalid invite role", status: 400 };

  // Upsert membership
  const { data: existing } = await service
    .from("ap_session_members")
    .select("id, left_at")
    .eq("session_id", session.id)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (existing?.left_at) {
    await service
      .from("ap_session_members")
      .update({
        left_at: null,
        role,
        joined_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else if (!existing) {
    const { error: memErr } = await service.from("ap_session_members").insert({
      session_id: session.id,
      user_id: opts.userId,
      role,
    });
    if (memErr && String(memErr.code) !== "23505") {
      console.error("acceptInvite member", memErr);
      return { error: "Could not join session", status: 500 };
    }
  }

  {
    const upd: Record<string, unknown> = {
      accepted_by: opts.userId,
      accepted_at: new Date().toISOString(),
    };
    if (invite.use_count != null || invite.max_uses != null) {
      upd.use_count = useCount + 1;
    }
    const { error: updErr } = await service
      .from("ap_session_invites")
      .update(upd)
      .eq("id", invite.id);
    if (updErr && /use_count|schema cache/i.test(updErr.message || "")) {
      await service
        .from("ap_session_invites")
        .update({
          accepted_by: opts.userId,
          accepted_at: new Date().toISOString(),
        })
        .eq("id", invite.id);
    }
  }

  await service.from("ap_session_events").insert({
    session_id: session.id,
    actor_id: opts.userId,
    event_type: "invite_accepted",
    payload: { invite_id: invite.id, role },
  });

  return {
    sessionId: session.id as string,
    projectId: session.project_id as string,
    role,
  };
}

export async function listMembers(
  supabase: SupabaseClient,
  sessionId: string
): Promise<Array<ApSessionMember & { display_name?: string | null; avatar_url?: string | null }>> {
  const { data: members } = await supabase
    .from("ap_session_members")
    .select("id, session_id, user_id, role, last_seen_at, is_recording, is_playing, joined_at, left_at")
    .eq("session_id", sessionId)
    .is("left_at", null);

  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);

  const byId = new Map((profiles || []).map((p) => [p.id as string, p]));
  return members.map((m) => {
    const p = byId.get(m.user_id as string);
    return {
      ...(m as ApSessionMember),
      display_name: (p?.display_name as string) || null,
      avatar_url: (p?.avatar_url as string) || null,
    };
  });
}

export async function endSession(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const { data: session } = await supabase
    .from("ap_sessions")
    .select("id, created_by")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { error: "Not found", status: 404 };
  if (session.created_by !== userId) {
    return { error: "Only the session owner can end the session", status: 403 };
  }
  await supabase
    .from("ap_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  const db = adminClient(supabase);
  await db.from("ap_session_events").insert({
    session_id: sessionId,
    actor_id: userId,
    event_type: "session_ended",
    payload: {},
  });
  return { ok: true };
}

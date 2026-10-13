import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertSessionPerm, getMemberRole } from "@/lib/sessions/access";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Contribution metadata only — audio bytes still go through existing
 * recording upload / R2 paths. This registers a reviewable take for the session.
 */
const CreateSchema = z.object({
  audioPath: z.string().min(1).max(512).optional(),
  storageKey: z.string().min(1).max(512).optional(),
  recordingTaskId: z.string().uuid().optional(),
  durationMs: z.number().min(0).max(60 * 60 * 1000).optional(),
  intendedPart: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
  takeNumber: z.number().int().min(1).max(999).optional(),
});

/** GET — list contributions for session */
export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const role = await getMemberRole(supabase, sessionId, user.id);
  if (!role) {
    return NextResponse.json({ error: "Not a session member" }, { status: 403 });
  }

  const { data, error: qErr } = await supabase
    .from("ap_session_contributions")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  return NextResponse.json({ contributions: data || [] });
}

/** POST — register a contribution (does not overwrite lead vocal) */
export async function POST(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const perm = await assertSessionPerm(supabase, sessionId, user.id, "record");
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const audioPath = parsed.data.audioPath || parsed.data.storageKey;
  if (!audioPath && !parsed.data.recordingTaskId) {
    return NextResponse.json(
      { error: "Provide audioPath or recordingTaskId" },
      { status: 400 }
    );
  }

  const { data: session } = await supabase
    .from("ap_sessions")
    .select("project_id, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.status === "ended") {
    return NextResponse.json({ error: "Session not available" }, { status: 410 });
  }

  const { data, error: insErr } = await supabase
    .from("ap_session_contributions")
    .insert({
      session_id: sessionId,
      project_id: session.project_id,
      contributor_id: user.id,
      audio_path: audioPath || null,
      recording_task_id: parsed.data.recordingTaskId || null,
      duration_ms: parsed.data.durationMs ?? null,
      intended_part: parsed.data.intendedPart || null,
      notes: parsed.data.notes || null,
      take_number: parsed.data.takeNumber ?? 1,
      status: "ready",
    })
    .select("*")
    .single();

  if (insErr) {
    console.error("contribution insert", insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await supabase.from("ap_session_events").insert({
    session_id: sessionId,
    actor_id: user.id,
    event_type: "contribution_submitted",
    payload: { contribution_id: data.id },
  });

  await supabase.from("ap_session_messages").insert({
    session_id: sessionId,
    user_id: null,
    kind: "system",
    body: "A new vocal take was submitted for review",
  });

  return NextResponse.json({ contribution: data });
}

const ReviewSchema = z.object({
  contributionId: z.string().uuid(),
  status: z.enum(["approved", "rejected", "ready"]),
  notes: z.string().max(500).optional(),
});

/** PATCH — review contribution (producer / owner) */
export async function PATCH(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await ctx.params;
  const perm = await assertSessionPerm(supabase, sessionId, user.id, "reviewContributions");
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error: uErr } = await supabase
    .from("ap_session_contributions")
    .update({
      status: parsed.data.status,
      review_notes: parsed.data.notes || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.contributionId)
    .eq("session_id", sessionId)
    .select("*")
    .single();

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  await supabase.from("ap_session_events").insert({
    session_id: sessionId,
    actor_id: user.id,
    event_type: "contribution_reviewed",
    payload: { contribution_id: data.id, status: parsed.data.status },
  });

  return NextResponse.json({ contribution: data });
}

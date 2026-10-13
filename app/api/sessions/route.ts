import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createApSession } from "@/lib/sessions/service";

const CreateSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
});

/** POST — create (or return existing active) AP Session for a project. Owner only. */
export async function POST(req: Request) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const result = await createApSession(supabase, {
    projectId: parsed.data.projectId,
    userId: user.id,
    name: parsed.data.name,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ session: result.session });
}

/** GET ?projectId= — list active sessions for a project the user owns or is a member of */
export async function GET(req: Request) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const { data: owned } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Sessions on this project visible to owner or any member
  const { data: sessions, error: qErr } = await supabase
    .from("ap_sessions")
    .select("id, project_id, created_by, name, status, transport, created_at, updated_at, ended_at")
    .eq("project_id", projectId)
    .neq("status", "ended")
    .order("created_at", { ascending: false });

  if (qErr) {
    console.error("GET sessions", qErr);
    return NextResponse.json(
      { error: "Could not load sessions", detail: qErr.message },
      { status: 500 }
    );
  }

  // Filter: owner sees all; others only those they belong to
  if (owned) {
    return NextResponse.json({ sessions: sessions || [] });
  }

  const ids = (sessions || []).map((s) => s.id);
  if (!ids.length) return NextResponse.json({ sessions: [] });

  const { data: memberships } = await supabase
    .from("ap_session_members")
    .select("session_id")
    .eq("user_id", user.id)
    .is("left_at", null)
    .in("session_id", ids);

  const allowed = new Set((memberships || []).map((m) => m.session_id));
  return NextResponse.json({
    sessions: (sessions || []).filter((s) => allowed.has(s.id)),
  });
}

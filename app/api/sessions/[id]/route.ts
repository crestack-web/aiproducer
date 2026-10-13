import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getMemberRole } from "@/lib/sessions/access";
import { endSession, listMembers } from "@/lib/sessions/service";

type Ctx = { params: Promise<{ id: string }> };

/** GET — session detail + members (members only) */
export async function GET(_req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const role = await getMemberRole(supabase, id, user.id);

  const { data: session, error: sErr } = await supabase
    .from("ap_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Project owner can view even before member row races settle
  const { data: project } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", session.project_id)
    .maybeSingle();

  if (!role && project?.user_id !== user.id) {
    return NextResponse.json({ error: "Not a session member" }, { status: 403 });
  }

  const members = await listMembers(supabase, id);
  return NextResponse.json({
    session,
    members,
    myRole: role || (project?.user_id === user.id ? "owner" : null),
  });
}

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "paused", "ended"]).optional(),
});

/** PATCH — rename / pause / end (owner) */
export async function PATCH(req: Request, ctx: Ctx) {
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.status === "ended") {
    const result = await endSession(supabase, id, user.id);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, status: "ended" });
  }

  const role = await getMemberRole(supabase, id, user.id);
  const { data: session } = await supabase
    .from("ap_sessions")
    .select("created_by")
    .eq("id", id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.created_by !== user.id && role !== "owner") {
    return NextResponse.json({ error: "Only the owner can update the session" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name) patch.name = parsed.data.name;
  if (parsed.data.status) patch.status = parsed.data.status;

  const { data: updated, error: uErr } = await supabase
    .from("ap_sessions")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }
  return NextResponse.json({ session: updated });
}

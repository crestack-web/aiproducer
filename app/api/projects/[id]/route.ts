import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

const ALLOWED_STATUS = new Set([
  "draft",
  "generating_beat",
  "beat_ready",
  "analyzing",
  "blueprint_ready",
  "recording",
  "processing",
  "mixing",
  "mastering",
  "complete",
  "failed",
]);

/** GET /api/projects/:id */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error: dbError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (dbError) {
    console.error("get project", dbError);
    return NextResponse.json({ error: "Could not load project" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ project: data });
}

/**
 * PATCH /api/projects/:id
 * Update project fields (status, title). Used to mark session as recording so reopen resumes plan/session.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { status?: string; title?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 120);
  }
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUS.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: updated, error: upErr } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (upErr || !updated) {
    console.error("patch project", upErr);
    return NextResponse.json({ error: "Could not update project" }, { status: 500 });
  }

  return NextResponse.json({ project: updated });
}

/** DELETE /api/projects/:id — remove a project (and related rows) */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  for (const table of [
    "recordings",
    "recording_tasks",
    "production_tasks",
    "samples",
    "beats",
    "jobs",
    "song_versions",
    "music_generation_jobs",
  ] as const) {
    const { error: relErr } = await supabase.from(table).delete().eq("project_id", id);
    if (relErr) console.warn(`cleanup ${table}`, relErr.message);
  }

  const { error: delErr } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (delErr) {
    console.error("delete project", delErr);
    return NextResponse.json({ error: "Could not delete project" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

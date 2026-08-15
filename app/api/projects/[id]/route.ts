import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

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

  // Best-effort related cleanup (ignore missing tables / FK order issues)
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

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/blueprint — sections + nested tasks for Producer UI */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, status, title, genre, mood")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: sections, error: sErr } = await supabase
    .from("song_sections")
    .select("*")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });

  if (sErr) {
    return NextResponse.json({ error: "Could not load sections" }, { status: 500 });
  }

  const { data: tasks, error: tErr } = await supabase
    .from("recording_tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("priority", { ascending: false });

  if (tErr) {
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }

  const tasksBySection = new Map();
  for (const t of tasks ?? []) {
    const key = t.section_id || "_none";
    if (!tasksBySection.has(key)) tasksBySection.set(key, []);
    tasksBySection.get(key).push(t);
  }

  const blueprint = (sections ?? []).map((s) => ({
    ...s,
    role: (s.metadata && s.metadata.role) || null,
    tasks: tasksBySection.get(s.id) ?? [],
  }));

  return NextResponse.json({
    project,
    blueprint,
    task_count: tasks?.length ?? 0,
    section_count: sections?.length ?? 0,
  });
}

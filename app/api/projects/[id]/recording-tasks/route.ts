import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/recording-tasks — ordered list for Producer Session */
export async function GET(_req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: tasks, error: tErr } = await supabase
    .from("recording_tasks")
    .select("*, song_sections(id, type, label, order_index)")
    .eq("project_id", projectId)
    .order("start_ms", { ascending: true });

  if (tErr) {
    console.error(tErr);
    return NextResponse.json({ error: "Could not load tasks" }, { status: 500 });
  }

  const ordered = [...(tasks ?? [])].sort((a, b) => {
    const ts = (a.start_ms ?? 0) - (b.start_ms ?? 0);
    if (ts !== 0) return ts;
    if (a.required !== b.required) return a.required ? -1 : 1;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });

  return NextResponse.json({ tasks: ordered });
}

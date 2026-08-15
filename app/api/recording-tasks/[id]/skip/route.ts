import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/recording-tasks/:id/skip — mark optional task as skipped */
export async function POST(_req: Request, ctx: Ctx) {
  const { id: taskId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: task } = await supabase
    .from("recording_tasks")
    .select("id, project_id, required, status")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (task.required) {
    return NextResponse.json(
      { error: "Required parts cannot be skipped. Record this take to continue." },
      { status: 400 }
    );
  }

  if (task.status === "completed" || task.status === "skipped") {
    return NextResponse.json({ task: { ...task, status: task.status }, already: true });
  }

  const { data: updated, error: upErr } = await supabase
    .from("recording_tasks")
    .update({ status: "skipped" })
    .eq("id", taskId)
    .select()
    .single();

  if (upErr || !updated) {
    console.error("skip task", upErr);
    return NextResponse.json({ error: "Could not skip task" }, { status: 500 });
  }

  return NextResponse.json({ task: updated });
}

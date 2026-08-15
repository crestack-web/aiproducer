import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string; recordingId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id: taskId, recordingId } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: task } = await supabase
    .from("recording_tasks")
    .select("id, project_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", task.project_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: rec } = await supabase
    .from("recordings")
    .select("id")
    .eq("id", recordingId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (!rec) return NextResponse.json({ error: "Recording not found" }, { status: 404 });

  await supabase.from("recordings").update({ is_selected: false }).eq("task_id", taskId);
  const { data: updated, error: uErr } = await supabase
    .from("recordings")
    .update({ is_selected: true })
    .eq("id", recordingId)
    .select()
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  return NextResponse.json({ recording: updated });
}

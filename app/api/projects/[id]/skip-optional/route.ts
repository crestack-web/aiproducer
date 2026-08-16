import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/skip-optional
 * Mark every open, non-required recording task as skipped.
 * Required parts are never skipped.
 */
export async function POST(_req: Request, ctx: Ctx) {
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

  const { data: optionalOpen, error: listErr } = await supabase
    .from("recording_tasks")
    .select("id, status, required")
    .eq("project_id", projectId)
    .eq("required", false)
    .in("status", ["pending", "in_progress"]);

  if (listErr) {
    console.error("skip-optional list", listErr);
    return NextResponse.json({ error: "Could not list optional tasks" }, { status: 500 });
  }

  const ids = (optionalOpen || []).map((t) => t.id);
  if (ids.length === 0) {
    return NextResponse.json({ skipped: 0, task_ids: [], message: "No optional parts left to skip" });
  }

  const { data: updated, error: upErr } = await supabase
    .from("recording_tasks")
    .update({ status: "skipped" })
    .in("id", ids)
    .eq("required", false)
    .select("id, status");

  if (upErr) {
    console.error("skip-optional update", upErr);
    return NextResponse.json({ error: "Could not skip optional tasks" }, { status: 500 });
  }

  return NextResponse.json({
    skipped: (updated || []).length,
    task_ids: (updated || []).map((t) => t.id),
  });
}

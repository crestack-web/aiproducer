import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — cancel an in-flight PRODUCE_SONG job for this project.
 * Marks the job failed/cancelled so the worker stops claiming/continuing it
 * and the client can leave the producing UI.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { user, error: authErr } = await requireUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await ctx.params;
  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  let body: { jobId?: string } = {};
  try {
    body = (await req.json().catch(() => ({}))) as { jobId?: string };
  } catch {
    body = {};
  }

  const service = createServiceClient();

  const { data: project } = await service
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || String((project as { user_id?: string }).user_id) !== user.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Prefer explicit jobId; otherwise cancel latest active produce job for project
  let jobId = body.jobId ? String(body.jobId) : null;

  if (!jobId) {
    const { data: jobs } = await service
      .from("jobs")
      .select("id, status, type, created_at")
      .eq("project_id", projectId)
      .eq("type", "PRODUCE_SONG")
      .in("status", ["queued", "processing", "pending", "running"])
      .order("created_at", { ascending: false })
      .limit(5);

    const list = (jobs || []) as { id: string; status: string }[];
    jobId = list[0]?.id ?? null;
  }

  if (!jobId) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      message: "No active produce job to cancel",
    });
  }

  const now = new Date().toISOString();
  const { data: existing } = await service
    .from("jobs")
    .select("id, status, output_data, project_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!existing || String((existing as { project_id?: string }).project_id) !== projectId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const prevStatus = String((existing as { status?: string }).status || "");
  if (prevStatus === "completed" || prevStatus === "complete") {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      message: "Job already completed",
      jobId,
      status: prevStatus,
    });
  }

  const prevOut =
    existing && typeof (existing as { output_data?: unknown }).output_data === "object"
      ? ((existing as { output_data: Record<string, unknown> }).output_data || {})
      : {};

  const { error: upErr } = await service
    .from("jobs")
    .update({
      status: "failed",
      stage: "failed",
      progress: 0,
      error: "Cancelled by artist",
      completed_at: now,
      output_data: {
        ...prevOut,
        cancelled: true,
        cancelled_at: now,
        cancel_reason: "user_cancel",
      },
    })
    .eq("id", jobId)
    .eq("project_id", projectId);

  if (upErr) {
    console.error("[produce/cancel]", upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    cancelled: true,
    jobId,
    previousStatus: prevStatus,
  });
}

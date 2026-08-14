import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/jobs/:id */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (jErr || !job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Authorize via project ownership
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", job.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    output_data: job.output_data,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  });
}

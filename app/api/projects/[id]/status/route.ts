import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { tickProduceJob, getPipelineMode } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";
import { getRoexEnv } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/projects/:id/status — project + latest job; advances produce jobs while polling. */
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { user, supabase, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, status, title, genre, mood, tempo, prompt, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pErr || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const service = createServiceClient();

  const { data: produceJob } = await service
    .from("jobs")
    .select("id, status, stage, type")
    .eq("project_id", id)
    .eq("type", "PRODUCE_SONG")
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (produceJob) {
    try {
      await tickProduceJob(produceJob.id, { maxWorkMs: 20_000 });
    } catch (e) {
      console.error("status poll tick", e);
    }
  }

  const { data: jobs } = await service
    .from("jobs")
    .select(
      "id, type, status, progress, stage, error, provider_task_id, output_data, created_at, completed_at, attempts"
    )
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: master } = await service
    .from("audio_versions")
    .select("*")
    .eq("project_id", id)
    .eq("kind", "master")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let master_url: string | null = null;
  if (master?.audio_path && isStoragePath(master.audio_path)) {
    try {
      master_url = await createSignedDownloadUrl(master.audio_path, 3600);
    } catch {
      master_url = null;
    }
  }

  const { data: projNow } = await service.from("projects").select("status").eq("id", id).maybeSingle();

  const { count: recordingCount } = await service
    .from("recordings")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);

  const { data: planTasks } = await service
    .from("recording_tasks")
    .select("id, active, selected_in_plan, status")
    .eq("project_id", id);

  const sessionTaskCount = (planTasks || []).filter((row) => {
    if (row.active === false) return false;
    if (row.selected_in_plan === false) return false;
    if (row.status === "skipped") return false;
    return true;
  }).length;

  return NextResponse.json({
    project: { ...project, status: projNow?.status || project.status },
    jobs: jobs ?? [],
    master,
    master_url,
    recording_count: recordingCount ?? 0,
    session_task_count: sessionTaskCount,
    mode: getPipelineMode(),
    roex_env: getRoexEnv(),
  });
}

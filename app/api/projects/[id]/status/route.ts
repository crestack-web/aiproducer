import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { tickProduceJob, getPipelineMode } from "@/lib/audio/pipeline";
import { createServiceClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, isStoragePath } from "@/lib/storage";
import { getRoexEnv } from "@/lib/env";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 300;

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
    .select("id, status, stage, type, started_at, created_at, output_data, error")
    .eq("project_id", id)
    .eq("type", "PRODUCE_SONG")
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (produceJob?.id) {
    const out = (produceJob.output_data || {}) as Record<string, unknown>;
    const lockAt = typeof out.tick_lock_at === "string" ? Date.parse(out.tick_lock_at) : 0;
    const lockFresh = Boolean(lockAt && Date.now() - lockAt < 45_000);
    const started = produceJob.started_at
      ? Date.parse(String(produceJob.started_at))
      : Date.parse(String(produceJob.created_at || "")) || Date.now();
    const ageMs = Date.now() - started;

    if (ageMs > 8 * 60_000) {
      await service
        .from("jobs")
        .update({
          status: "failed",
          stage: "failed",
          progress: 100,
          error: "Production timed out. Tap Produce again — a new job will retry.",
          completed_at: new Date().toISOString(),
          output_data: { ...out, error: "timeout_8m" },
        })
        .eq("id", produceJob.id);
    } else if (!lockFresh) {
      try {
        await service
          .from("jobs")
          .update({
            status: "processing",
            started_at: produceJob.started_at || new Date().toISOString(),
            output_data: { ...out, tick_lock_at: new Date().toISOString() },
          })
          .eq("id", produceJob.id);
        await tickProduceJob(produceJob.id, { maxWorkMs: 55_000 });
      } catch (e) {
        console.error("status poll tick", e);
        const msg = e instanceof Error ? e.message : String(e);
        await service
          .from("jobs")
          .update({
            status: "failed",
            stage: "failed",
            progress: 100,
            error: msg.slice(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq("id", produceJob.id)
          .in("status", ["queued", "processing"]);
      }
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

  // Prefer audio_versions; fall back to songs (AP engine writes here)
  let { data: master } = await service
    .from("audio_versions")
    .select("*")
    .eq("project_id", id)
    .eq("kind", "master")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!master?.audio_path) {
    const { data: song } = await service
      .from("songs")
      .select("id, audio_path, status, version, metadata, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (song?.audio_path) {
      master = {
        id: song.id,
        project_id: id,
        kind: "master",
        version: song.version ?? 1,
        audio_path: song.audio_path,
        metadata: song.metadata,
        created_at: song.created_at,
      } as typeof master;
    }
  }

  // Also resolve from latest complete job output if still missing
  if (!master?.audio_path && jobs?.length) {
    const done = jobs.find(
      (j) =>
        j.type === "PRODUCE_SONG" &&
        (j.status === "complete" || j.status === "completed") &&
        j.output_data &&
        typeof j.output_data === "object"
    );
    const od = (done?.output_data || {}) as { master_storage_path?: string };
    if (od.master_storage_path && isStoragePath(od.master_storage_path)) {
      master = {
        id: done!.id,
        project_id: id,
        kind: "master",
        version: 1,
        audio_path: od.master_storage_path,
        metadata: od,
        created_at: done!.completed_at || done!.created_at,
      } as typeof master;
    }
  }

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

  // If a real master exists, the project is produced — even if status lagged on "recording"
  let statusOut = String(projNow?.status || project.status || "");
  const hasMaster =
    Boolean(master_url) ||
    (master?.audio_path &&
      typeof master.audio_path === "string" &&
      !String(master.audio_path).startsWith("mock://"));
  if (hasMaster) {
    const s = statusOut.toLowerCase();
    if (s !== "complete" && s !== "completed" && s !== "produced" && s !== "done") {
      statusOut = "complete";
      // Persist so next load opens the done screen
      await service.from("projects").update({ status: "complete" }).eq("id", id);
    }
  }

  return NextResponse.json({
    project: { ...project, status: statusOut },
    jobs: jobs ?? [],
    master,
    master_url,
    recording_count: recordingCount ?? 0,
    session_task_count: sessionTaskCount,
    mode: getPipelineMode(),
    roex_env: getRoexEnv(),
  });
}

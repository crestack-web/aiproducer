import { createServiceClient } from "@/lib/supabase/server";
import { MockMixProvider } from "@/lib/providers/mock-mix";
import { RoExMixProvider } from "@/lib/providers/roex";
import type { AudioMixProvider, StemKind } from "@/lib/audio/types";
import { resolveAudioUrl } from "@/lib/storage";
import { getRoexEnv } from "@/lib/env";

export type RecordingRow = { id: string; task_id: string; is_selected: boolean | null };
export type TakeRow = {
  id: string;
  task_id: string;
  audio_path: string | null;
  original_path?: string | null;
  processed_path?: string | null;
  duration_ms?: number | null;
  recording_tasks?: {
    id: string;
    type: string;
    start_ms: number | null;
    end_ms: number | null;
  } | null;
};
export type StemRow = { audio_path: string; kind: string };
export type JobOutput = {
  user_id?: string;
  mode?: string;
  mix_provider_task_id?: string;
  master_provider_task_id?: string;
  mix_storage_path?: string;
  master_storage_path?: string;
  mix_provider_url?: string;
  master_provider_url?: string;
  mix_version_id?: string;
  master_version_id?: string;
  mix_poll_attempts?: number;
  master_poll_attempts?: number;
  [key: string]: unknown;
};

export function getPipelineMode(): "mock" | "roex" {
  const m = (process.env.AUDIO_PIPELINE_MODE || "").toLowerCase();
  if (m === "mock") return "mock";
  if (m === "roex") return "roex";
  if (process.env.ROEX_API_KEY) return "roex";
  return "mock";
}

export function getMixProvider(): AudioMixProvider {
  return getPipelineMode() === "roex" ? new RoExMixProvider() : new MockMixProvider();
}

export function vocalStemKind(taskType: string): StemKind {
  const t = taskType.toLowerCase();
  if (t.includes("double")) return "DOUBLE";
  if (t.includes("harmony")) return "HARMONY";
  if (t.includes("adlib") || t.includes("call")) return "ADLIBS";
  if (t.includes("background") || t.includes("hum") || t.includes("texture")) return "BACKGROUND";
  return "LEAD";
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export function logProduce(fields: Record<string, unknown>) {
  console.info("[produce]", JSON.stringify(fields));
}

export async function toReadableUrl(path: string | null | undefined): Promise<string | null> {
  if (!path || path.startsWith("mock://")) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return resolveAudioUrl(path, 7200);
}

export function asOutput(job: { output_data?: unknown; input_data?: unknown }): JobOutput {
  const out =
    job.output_data && typeof job.output_data === "object" ? (job.output_data as JobOutput) : {};
  const input =
    job.input_data && typeof job.input_data === "object" ? (job.input_data as JobOutput) : {};
  return { ...input, ...out };
}

export async function patchJob(
  supabase: ReturnType<typeof createServiceClient>,
  jobId: string,
  patch: Record<string, unknown>
) {
  await supabase.from("jobs").update(patch).eq("id", jobId);
}

/**
 * Enqueue PRODUCE_SONG. Caller must already have verified project ownership.
 * Also re-checks ownership here (defense in depth with service-role client).
 */
export async function enqueueProduceSong(projectId: string, userId: string) {
  const supabase = createServiceClient();

  const { data: owned } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!owned) {
    throw new Error("Project not found or not owned by user");
  }

  const idempotencyKey = `produce:${projectId}`;

  const { data: existing } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["queued", "processing", "complete"])
    .maybeSingle();

  if (existing) {
    logProduce({
      event: "enqueue_deduped",
      jobId: existing.id,
      projectId,
      status: existing.status,
    });
    return { job_id: existing.id, status: existing.status, deduped: true };
  }

  let { data: selected, error: recErr } = await supabase
    .from("recordings")
    .select("id, task_id, is_selected, audio_path, project_id")
    .eq("project_id", projectId);

  if (recErr) console.error("enqueueProduceSong recordings", recErr);

  let rows = (selected || []) as RecordingRow[];

  if (rows.length === 0) {
    const { data: completedTasks } = await supabase
      .from("recording_tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "completed");

    const taskIds = (completedTasks || []).map((t: { id: string }) => t.id);
    if (taskIds.length > 0) {
      const { data: viaTasks } = await supabase
        .from("recordings")
        .select("id, task_id, is_selected, audio_path, project_id")
        .in("task_id", taskIds);
      rows = (viaTasks || []) as RecordingRow[];
      for (const r of rows) {
        const any = r as RecordingRow & { project_id?: string };
        if (!any.project_id) {
          await supabase.from("recordings").update({ project_id: projectId }).eq("id", r.id);
        }
      }
    }
  }

  if (rows.length === 0) {
    const { count: completedCount } = await supabase
      .from("recording_tasks")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "completed");

    if ((completedCount || 0) > 0) {
      throw new Error(
        "Takes were marked complete but no audio files were saved. Go back and re-record each required part, wait for “Saved”, then Keep take."
      );
    }
    throw new Error("No recordings found. Complete at least one take first.");
  }

  const hasSelected = rows.some((r) => Boolean(r.is_selected));
  if (!hasSelected) {
    const byTask = new Map<string, string>();
    for (const r of rows) byTask.set(r.task_id, r.id);
    for (const recId of byTask.values()) {
      await supabase.from("recordings").update({ is_selected: true }).eq("id", recId);
    }
  } else {
    const byTask = new Map<string, RecordingRow[]>();
    for (const r of rows) {
      if (!byTask.has(r.task_id)) byTask.set(r.task_id, []);
      byTask.get(r.task_id)!.push(r);
    }
    for (const [, list] of byTask) {
      if (!list.some((r) => r.is_selected)) {
        await supabase.from("recordings").update({ is_selected: true }).eq("id", list[0].id);
      }
    }
  }

  const mode = getPipelineMode();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      type: "PRODUCE_SONG",
      status: "queued",
      progress: 0,
      stage: "queued",
      idempotency_key: idempotencyKey,
      input_data: {
        user_id: userId,
        mode,
        recording_count: rows.length,
        roex_env: getRoexEnv(),
      },
      output_data: { user_id: userId, mode },
      attempts: 0,
    })
    .select()
    .single();

  if (error || !job) {
    const { data: again } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (again) return { job_id: again.id, status: again.status, deduped: true };
    throw error || new Error("Could not enqueue produce job");
  }

  await supabase.from("projects").update({ status: "processing" }).eq("id", projectId);
  logProduce({ event: "enqueued", jobId: job.id, projectId, mode, status: "queued" });
  return { job_id: job.id, status: job.status, deduped: false, recording_count: rows.length };
}

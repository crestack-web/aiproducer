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
  is_selected?: boolean | null;
  timeline_start_ms?: number | null;
  timeline_end_ms?: number | null;
  recording_offset_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  recording_tasks?: {
    id: string;
    type: string;
    start_ms: number | null;
    end_ms: number | null;
    title?: string | null;
    active?: boolean | null;
    selected_in_plan?: boolean | null;
    status?: string | null;
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

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.includes("token=") || value.includes("X-API-Key") || value.includes("service_role")) {
      try {
        const u = new URL(value);
        return `${u.origin}${u.pathname}`;
      } catch {
        return "[redacted]";
      }
    }
    if (/eyJ[a-zA-Z0-9_-]{20,}/.test(value)) return "[redacted-jwt]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (
        lk.includes("key") ||
        lk.includes("token") ||
        lk.includes("authorization") ||
        lk.includes("secret") ||
        lk.includes("password")
      ) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return value;
}

export function logProduce(fields: Record<string, unknown>) {
  console.info("[produce]", JSON.stringify(redactSecrets(fields)));
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

  const baseKey = `produce:${projectId}`;

  const { data: existing } = await supabase
    .from("jobs")
    .select("id, status, provider_task_id, stage, output_data, attempts")
    .eq("project_id", projectId)
    .eq("type", "PRODUCE_SONG")
    .in("status", ["queued", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    logProduce({
      event: "enqueue_deduped",
      jobId: existing.id,
      projectId,
      status: existing.status,
      stage: existing.stage,
    });
    return { job_id: existing.id, status: existing.status, deduped: true };
  }

  const { data: completed } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("type", "PRODUCE_SONG")
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (completed) {
    logProduce({
      event: "enqueue_deduped_complete",
      jobId: completed.id,
      projectId,
      status: completed.status,
    });
    return { job_id: completed.id, status: completed.status, deduped: true };
  }

  const { count: priorCount } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("type", "PRODUCE_SONG");

  const attempt = (priorCount || 0) + 1;
  const idempotencyKey = attempt === 1 ? baseKey : `${baseKey}:attempt-${attempt}`;

  const { data: activePlanTasks } = await supabase
    .from("recording_tasks")
    .select("id, active, selected_in_plan, status")
    .eq("project_id", projectId);

  const activeTaskIds = new Set(
    (activePlanTasks || [])
      .filter((t: { active?: boolean | null; selected_in_plan?: boolean | null; status?: string }) => {
        if (t.active === false) return false;
        if (t.selected_in_plan === false) return false;
        if (t.status === "skipped") return false;
        return true;
      })
      .map((t: { id: string }) => t.id)
  );

  const hasPlanFields = (activePlanTasks || []).some(
    (t: { active?: boolean | null; selected_in_plan?: boolean | null }) =>
      t.active != null || t.selected_in_plan != null
  );
  if ((activePlanTasks || []).length > 0 && !hasPlanFields) {
    for (const t of activePlanTasks || []) {
      activeTaskIds.add((t as { id: string }).id);
    }
  }

  let { data: selected, error: recErr } = await supabase
    .from("recordings")
    .select("id, task_id, is_selected, audio_path, project_id")
    .eq("project_id", projectId);

  if (recErr) console.error("enqueueProduceSong recordings", recErr);

  // Plan membership is by task_id only (not timestamps).
  let rows = ((selected || []) as RecordingRow[]).filter((r) => {
    if (!hasPlanFields) return true;
    if (activeTaskIds.size === 0) return false;
    return Boolean(r.task_id) && activeTaskIds.has(r.task_id);
  });

  logProduce({
    event: "enqueue_plan_match",
    projectId,
    selectedTaskIds: [...activeTaskIds],
    allRecordingTaskIds: ((selected || []) as RecordingRow[]).map((r) => r.task_id),
    matchedCount: rows.length,
    hasPlanFields,
  });

  if (rows.length === 0) {
    const { data: completedTasks } = await supabase
      .from("recording_tasks")
      .select("id, active, selected_in_plan, status")
      .eq("project_id", projectId)
      .eq("status", "completed");

    const taskIds = (completedTasks || [])
      .filter((t: { id: string; active?: boolean | null; selected_in_plan?: boolean | null }) => {
        if (t.active === false) return false;
        if (t.selected_in_plan === false) return false;
        return true;
      })
      .map((t: { id: string }) => t.id);
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
        "You have completed takes, but none are on your active plan. Restore a part in Customize, or record a selected part."
      );
    }
    throw new Error("No recordings found. Select at least one part on your plan and record it.");
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
        attempt,
      },
      output_data: { user_id: userId, mode, attempt },
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
  logProduce({ event: "enqueued", jobId: job.id, projectId, mode, status: "queued", active_artist_plan: true });
  return { job_id: job.id, status: job.status, deduped: false, recording_count: rows.length };
}

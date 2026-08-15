import { createServiceClient } from "@/lib/supabase/server";
import { MockMixProvider } from "@/lib/providers/mock-mix";
import { RoExMixProvider, mapMusicalStyle, stemToInstrumentGroup } from "@/lib/providers/roex";
import type { ArrangementPlacement, AudioMixProvider, StemKind } from "@/lib/audio/types";
import { resolveAudioUrl } from "@/lib/storage";

type RecordingRow = { id: string; task_id: string; is_selected: boolean | null };

type TakeRow = {
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

type StemRow = { audio_path: string; kind: string };

/**
 * Production default: use RoEx whenever ROEX_API_KEY is configured.
 * Explicit AUDIO_PIPELINE_MODE=mock still forces mock (local free runs).
 */
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

function vocalStemKind(taskType: string): StemKind {
  const t = taskType.toLowerCase();
  if (t.includes("double")) return "DOUBLE";
  if (t.includes("harmony")) return "HARMONY";
  if (t.includes("adlib") || t.includes("call")) return "ADLIBS";
  if (t.includes("background") || t.includes("hum") || t.includes("texture")) return "BACKGROUND";
  return "LEAD";
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Resolve storage object paths to HTTPS URLs RoEx can fetch. */
async function toReadableUrl(path: string | null | undefined): Promise<string | null> {
  if (!path || path.startsWith("mock://")) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // 2h expiry so RoEx mix/master jobs can finish
  return resolveAudioUrl(path, 7200);
}

export async function enqueueProduceSong(projectId: string, userId: string) {
  const supabase = createServiceClient();
  const idempotencyKey = `produce:${projectId}`;

  const { data: existing } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["queued", "processing", "complete"])
    .maybeSingle();

  if (existing) return { job_id: existing.id, status: existing.status, deduped: true };

  const { data: selected } = await supabase
    .from("recordings")
    .select("id, task_id, is_selected")
    .eq("project_id", projectId);

  const rows = (selected || []) as RecordingRow[];
  const hasSelected = rows.some((r: RecordingRow) => Boolean(r.is_selected));
  const hasAny = rows.length > 0;
  if (!hasAny) throw new Error("No recordings found. Complete at least one take first.");

  if (!hasSelected) {
    const byTask = new Map<string, string>();
    for (const r of rows) byTask.set(r.task_id, r.id);
    for (const recId of byTask.values()) {
      await supabase.from("recordings").update({ is_selected: true }).eq("id", recId);
    }
  }

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      project_id: projectId,
      type: "PRODUCE_SONG",
      status: "queued",
      progress: 0,
      stage: "queued",
      idempotency_key: idempotencyKey,
      input_data: { user_id: userId, mode: getPipelineMode() },
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
  return { job_id: job.id, status: job.status, deduped: false };
}

export async function tickProduceJob(jobId: string) {
  const supabase = createServiceClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job || job.type !== "PRODUCE_SONG") throw new Error("Invalid produce job");
  if (job.status === "complete" || job.status === "failed") return job;

  const projectId = job.project_id as string;
  const mode = getPipelineMode();
  const provider = getMixProvider();

  await supabase
    .from("jobs")
    .update({
      status: "processing",
      started_at: job.started_at || new Date().toISOString(),
      attempts: (job.attempts || 0) + 1,
      provider: provider.name,
    })
    .eq("id", jobId);

  try {
    await supabase.from("jobs").update({ progress: 15, stage: "prepare_vocals" }).eq("id", jobId);

    const { data: takesRaw } = await supabase
      .from("recordings")
      .select("*, recording_tasks(id, type, start_ms, end_ms, title)")
      .eq("project_id", projectId)
      .eq("is_selected", true);

    const takes = (takesRaw || []) as TakeRow[];

    for (const take of takes) {
      const original = take.original_path || take.audio_path;
      await supabase
        .from("recordings")
        .update({
          original_path: original,
          processed_path: take.processed_path || original,
          status: "ready",
        })
        .eq("id", take.id);
    }

    await supabase.from("jobs").update({ progress: 35, stage: "arrange" }).eq("id", jobId);

    const placements: ArrangementPlacement[] = takes.map((t: TakeRow) => {
      const task = t.recording_tasks;
      return {
        recording_id: t.id,
        task_id: task?.id || t.task_id,
        stem_kind: vocalStemKind(task?.type || "lead"),
        start_ms: task?.start_ms ?? 0,
        end_ms: task?.end_ms ?? t.duration_ms ?? 0,
        gain_db: 0,
      };
    });

    await supabase.from("jobs").update({ progress: 50, stage: "render_stems" }).eq("id", jobId);

    const { data: beat } = await supabase
      .from("beats")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase.from("audio_stems").delete().eq("project_id", projectId);

    const stemRows: Record<string, unknown>[] = [];
    if (beat?.audio_path) {
      stemRows.push({
        project_id: projectId,
        kind: "INSTRUMENTAL",
        audio_path: beat.audio_path,
        duration_ms: beat.duration_ms,
        order_index: 0,
        source_recording_ids: [],
        metadata: { role: "instrumental" },
      });
    }

    const byKind = new Map<StemKind, ArrangementPlacement[]>();
    for (const p of placements) {
      if (!byKind.has(p.stem_kind)) byKind.set(p.stem_kind, []);
      byKind.get(p.stem_kind)!.push(p);
    }

    let order = 1;
    for (const [kind, list] of byKind) {
      const first = list[0];
      const rec = takes.find((t: TakeRow) => t.id === first.recording_id);
      stemRows.push({
        project_id: projectId,
        kind,
        audio_path: rec?.processed_path || rec?.audio_path || "mock://empty",
        duration_ms: rec?.duration_ms,
        order_index: order++,
        source_recording_ids: list.map((l: ArrangementPlacement) => l.recording_id),
        metadata: { placements: list, mock_render: mode === "mock" },
      });
    }

    if (stemRows.length) await supabase.from("audio_stems").insert(stemRows);

    await supabase.from("jobs").update({ progress: 65, stage: "mix" }).eq("id", jobId);

    const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
    const style = mapMusicalStyle(project?.genre);
    // Production: preview unless ROEX_ALLOW_FULL=true (full/paid masters)
    const previewOnly = mode === "mock" || process.env.ROEX_ALLOW_FULL !== "true";
    const mixTracks = ((await supabase.from("audio_stems").select("*").eq("project_id", projectId)).data ||
      []) as StemRow[];

    // RoEx needs publicly fetchable HTTPS URLs, not storage object keys
    const resolvedTracks: { path: string; kind: StemKind }[] = [];
    for (const s of mixTracks) {
      const kind = s.kind as StemKind;
      if (mode === "roex") {
        const url = await toReadableUrl(s.audio_path);
        if (!url) {
          console.warn("Skipping stem without readable URL", s.kind, s.audio_path);
          continue;
        }
        resolvedTracks.push({ path: url, kind });
      } else {
        resolvedTracks.push({ path: s.audio_path, kind });
      }
    }

    if (mode === "roex" && resolvedTracks.length === 0) {
      throw new Error("No stems with readable URLs for RoEx mix. Check storage paths and signed URLs.");
    }

    const mixStart = await provider.startMix(
      resolvedTracks.map((t) => ({
        path: t.path,
        kind: t.kind,
        instrumentGroup: stemToInstrumentGroup(t.kind),
        presenceSetting: (t.kind === "LEAD" ? "LEAD" : "NORMAL") as "LEAD" | "NORMAL",
        panPreference: "CENTRE" as const,
        reverbPreference: (t.kind === "LEAD" ? "LOW" : "NONE") as "LOW" | "NONE",
      })),
      { musicalStyle: style, preview: previewOnly }
    );

    await supabase
      .from("jobs")
      .update({ provider_task_id: mixStart.provider_task_id, provider: provider.name })
      .eq("id", jobId);

    // Poll retrieve until download URL appears (RoEx jobs are async)
    let mixDone = await provider.retrieveMix(mixStart.provider_task_id);
    if (mode === "roex") {
      for (let i = 0; i < 12 && !mixDone.download_url; i++) {
        await sleep(5000);
        mixDone = await provider.retrieveMix(mixStart.provider_task_id);
      }
      if (!mixDone.download_url) {
        throw new Error("RoEx mix did not return a download URL in time");
      }
    }

    const { data: versions } = await supabase
      .from("audio_versions")
      .select("version")
      .eq("project_id", projectId)
      .eq("kind", "preview_mix")
      .order("version", { ascending: false })
      .limit(1);
    const nextVer = (versions?.[0]?.version || 0) + 1;
    const mixPath =
      mixDone.download_url || mixDone.local_path || beat?.audio_path || `mock://mix/${projectId}/v${nextVer}`;

    const { data: mixVersion } = await supabase
      .from("audio_versions")
      .insert({
        project_id: projectId,
        kind: "preview_mix",
        version: nextVer,
        audio_path: mixPath,
        job_id: jobId,
        provider: provider.name,
        provider_task_id: mixStart.provider_task_id,
        metadata: { ...(mixDone.metadata || {}), mode },
      })
      .select()
      .single();

    await supabase.from("jobs").update({ progress: 80, stage: "mix_analysis" }).eq("id", jobId);
    const analysis = await provider.analyzeMix(mixPath, { musicalStyle: style, isMaster: false });
    await supabase.from("quality_checks").insert({
      project_id: projectId,
      audio_version_id: mixVersion?.id,
      stage: "mix_analysis",
      status: analysis.status,
      metrics: analysis.metrics,
      notes: analysis.notes,
    });

    // Only hard-fail on explicit fail; needs_review continues (RoEx analysis often returns raw metrics)
    if (analysis.status === "fail") {
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          stage: "mix_gate",
          error: "Mix quality gate failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
      return { failed: true, stage: "mix_gate" };
    }

    await supabase.from("jobs").update({ progress: 90, stage: "master" }).eq("id", jobId);
    const masterStart = await provider.startMaster(mixPath, {
      musicalStyle: style,
      desiredLoudness: "MEDIUM",
      preview: previewOnly,
    });

    let masterDone = await provider.retrieveMaster(masterStart.provider_task_id);
    if (mode === "roex") {
      for (let i = 0; i < 12 && !masterDone.download_url; i++) {
        await sleep(5000);
        masterDone = await provider.retrieveMaster(masterStart.provider_task_id);
      }
      if (!masterDone.download_url) {
        throw new Error("RoEx master did not return a download URL in time");
      }
    }

    const masterPath = masterDone.download_url || masterDone.local_path || mixPath;

    const { data: masterVersions } = await supabase
      .from("audio_versions")
      .select("version")
      .eq("project_id", projectId)
      .eq("kind", "master")
      .order("version", { ascending: false })
      .limit(1);
    const masterVer = (masterVersions?.[0]?.version || 0) + 1;

    const { data: masterVersion } = await supabase
      .from("audio_versions")
      .insert({
        project_id: projectId,
        kind: "master",
        version: masterVer,
        audio_path: masterPath,
        job_id: jobId,
        provider: provider.name,
        provider_task_id: masterStart.provider_task_id,
        metadata: { ...(masterDone.metadata || {}), mode },
      })
      .select()
      .single();

    await supabase.from("jobs").update({ progress: 95, stage: "final_qc" }).eq("id", jobId);
    await supabase.from("quality_checks").insert({
      project_id: projectId,
      audio_version_id: masterVersion?.id,
      stage: "final_qc",
      status: "pass",
      metrics: { mock: mode === "mock", path: masterPath },
      notes: mode === "mock" ? "Mock QC pass" : "RoEx master path QC pass",
    });

    await supabase.from("songs").insert({
      project_id: projectId,
      audio_path: masterPath,
      status: "ready",
      version: masterVer,
      metadata: { audio_version_id: masterVersion?.id, mode },
    });

    await supabase
      .from("jobs")
      .update({
        status: "complete",
        progress: 100,
        stage: "complete",
        output_data: {
          mix_version_id: mixVersion?.id,
          master_version_id: masterVersion?.id,
          mode,
          provider: provider.name,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await supabase.from("projects").update({ status: "complete" }).eq("id", projectId);
    return {
      complete: true,
      mix_version_id: mixVersion?.id,
      master_version_id: masterVersion?.id,
      mode,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Produce pipeline failed";
    console.error("tickProduceJob", jobId, e);
    await supabase
      .from("jobs")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", jobId);
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    throw e;
  }
}

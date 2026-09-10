import { createServiceClient } from "@/lib/supabase/server";
import { resolveActivePlanTakes } from "@/lib/audio/resolve-active-plan-takes";
import {
  getPipelineMode,
  getMixProvider,
  asOutput,
  patchJob,
  logProduce,
  vocalStemKind,
  sleep,
  type TakeRow,
  type StemRow,
} from "@/lib/audio/produce-job";
import { getRoexEnv, getRoexWebhookUrl, isRoexFullAllowed } from "@/lib/env";
import { mapMusicalStyle, stemToInstrumentGroup } from "@/lib/providers/roex";
import type { ArrangementPlacement, StemKind } from "@/lib/audio/types";
import {
  isStoragePath,
  persistRemoteAudioToStorage,
  productionMasterPath,
  productionMixPath,
} from "@/lib/storage";
import { buildVocalStemRows } from "@/lib/audio/build-vocal-stems";
import {
  prepareRoexTrack,
  validateTracksForRoex,
  userFacingProduceError,
} from "@/lib/audio/roex-assets";
import { appendSampleStems } from "@/lib/audio/sample-stems";
import {
  buildPlacementManifest,
  resolvePlacementStartMs,
} from "@/lib/audio/session-timeline";

export { getPipelineMode, getMixProvider } from "@/lib/audio/produce-job";
export { enqueueProduceSong } from "@/lib/audio/produce-job";

export async function tickProduceJob(jobId: string, opts?: { maxWorkMs?: number }) {
  const maxWorkMs = opts?.maxWorkMs ?? 25_000;
  const startedAt = Date.now();
  const supabase = createServiceClient();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single();
  if (!job || job.type !== "PRODUCE_SONG") throw new Error("Invalid produce job");
  if (job.status === "complete" || job.status === "failed") return job;

  const projectId = job.project_id as string;
  const mode = getPipelineMode();
  const provider = getMixProvider();
  let out = asOutput(job);
  const userId = (out.user_id as string) || "";
  let stage = (job.stage as string) || "queued";
  const budgetOk = () => Date.now() - startedAt < maxWorkMs;

  await patchJob(supabase, jobId, {
    status: "processing",
    started_at: job.started_at || new Date().toISOString(),
    attempts: (job.attempts || 0) + 1,
    provider: provider.name,
  });

  logProduce({
    event: "tick_start",
    jobId,
    projectId,
    stage,
    attempt: (job.attempts || 0) + 1,
    mix_provider_task_id: out.mix_provider_task_id,
    master_provider_task_id: out.master_provider_task_id,
    mode,
    roex_env: getRoexEnv(),
  });

  try {
    if (["queued", "prepare_vocals", "arrange", "render_stems"].includes(stage)) {
      await patchJob(supabase, jobId, { progress: 15, stage: "prepare_vocals" });
      stage = "prepare_vocals";

      const takes = await resolveActivePlanTakes(supabase, projectId, jobId);

      await Promise.all(
        takes.map((take) => {
          const original = take.original_path || take.audio_path;
          return supabase
            .from("recordings")
            .update({
              original_path: original,
              processed_path: take.processed_path || original,
              status: "ready",
            })
            .eq("id", take.id);
        })
      );

      await patchJob(supabase, jobId, { progress: 35, stage: "arrange" });
      stage = "arrange";

      const placements: ArrangementPlacement[] = takes.map((t) => {
        const task = t.recording_tasks as {
          id?: string;
          type?: string;
          start_ms?: number | null;
          end_ms?: number | null;
        } | null;
        const rec = t as TakeRow & {
          timeline_start_ms?: number | null;
          timeline_end_ms?: number | null;
          recording_offset_ms?: number | null;
          metadata?: Record<string, unknown> | null;
        };
        const meta = (rec.metadata || {}) as Record<string, unknown>;
        const sectionStart =
          typeof task?.start_ms === "number"
            ? task.start_ms
            : typeof rec.timeline_start_ms === "number"
              ? rec.timeline_start_ms
              : typeof meta.section_start_ms === "number"
                ? (meta.section_start_ms as number)
                : 0;
        const offset =
          typeof rec.recording_offset_ms === "number"
            ? rec.recording_offset_ms
            : typeof meta.recording_offset_ms === "number"
              ? (meta.recording_offset_ms as number)
              : 0;
        const explicitPlacement =
          typeof meta.placement_start_ms === "number" ? (meta.placement_start_ms as number) : null;
        const start = resolvePlacementStartMs({
          sectionStartMs: sectionStart,
          recordingOffsetMs: offset,
          timelineStartMs: rec.timeline_start_ms,
          placementStartMs: explicitPlacement,
        });
        const durationMs =
          typeof rec.duration_ms === "number"
            ? rec.duration_ms
            : typeof meta.recorded_duration_ms === "number"
              ? (meta.recorded_duration_ms as number)
              : 0;
        const end =
          typeof rec.timeline_end_ms === "number"
            ? rec.timeline_end_ms
            : typeof task?.end_ms === "number"
              ? task.end_ms
              : start + durationMs;
        return {
          recording_id: rec.id,
          task_id: task?.id || rec.task_id,
          stem_kind: vocalStemKind(task?.type || "lead"),
          start_ms: start,
          end_ms: end,
          gain_db: 0,
          metadata: buildPlacementManifest({
            taskId: task?.id || rec.task_id,
            sectionLabel: (meta.section_label as string) || null,
            sectionStartMs: sectionStart,
            sectionEndMs: typeof task?.end_ms === "number" ? task.end_ms : null,
            recordingOffsetMs: offset,
            recordedDurationMs: durationMs || null,
            placementStartMs: start,
          }),
        };
      });

      await patchJob(supabase, jobId, { progress: 50, stage: "render_stems" });
      stage = "render_stems";

      const { data: beat } = await supabase
        .from("beats")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!beat?.audio_path) {
        throw new Error("Instrumental/beat is missing. Add a beat before Produce.");
      }

      const songDurationMs = Math.max(
        typeof beat.duration_ms === "number" && beat.duration_ms > 0 ? beat.duration_ms : 0,
        ...placements.map((p) => p.end_ms || 0),
        30_000
      );

      if (mode === "roex" && !userId) {
        throw new Error("Missing user_id on produce job — cannot store aligned stems");
      }

      await supabase.from("audio_stems").delete().eq("project_id", projectId);

      const stemRows: Record<string, unknown>[] = [];
      let instrumentalPath = beat.audio_path as string;
      stemRows.push({
        project_id: projectId,
        kind: "INSTRUMENTAL",
        audio_path: instrumentalPath,
        duration_ms: beat.duration_ms || songDurationMs,
        order_index: 0,
        source_recording_ids: [],
        metadata: { role: "instrumental", song_duration_ms: songDurationMs },
      });

      // ALL section takes composite into full-song stems (not only first of each kind)
      const alignedResults = await buildVocalStemRows({
        mode,
        userId,
        projectId,
        jobId,
        takes,
        placements,
        songDurationMs,
      });
      for (const row of alignedResults) {
        stemRows.push(row);
      }

      if (stemRows.length) await supabase.from("audio_stems").insert(stemRows);
      stage = "mix_submit";
      await patchJob(supabase, jobId, { progress: 60, stage, output_data: { ...out, song_duration_ms: songDurationMs } });
      out = { ...out, song_duration_ms: songDurationMs };
    }

    // ---------- MIX SUBMIT ----------
    if (stage === "mix_submit" || stage === "mix") {
      if (out.mix_provider_task_id) {
        logProduce({ event: "mix_resume_existing", jobId, projectId, provider_task_id: out.mix_provider_task_id });
        stage = "mix_poll";
        await patchJob(supabase, jobId, { stage, provider_task_id: out.mix_provider_task_id, progress: 65 });
      } else {
        const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
        const style = mapMusicalStyle(project?.genre);
        const mixTracks = ((await supabase.from("audio_stems").select("*").eq("project_id", projectId)).data ||
          []) as StemRow[];

        const resolvedTracks: { path: string; kind: StemKind }[] = [];
        for (const s of mixTracks) {
          const kind = s.kind as StemKind;
          if (mode === "roex") {
            const meta = (s as { metadata?: Record<string, unknown> }).metadata || {};
            if (kind !== "INSTRUMENTAL" && meta.timeline_aligned !== true) {
              throw new Error(`Pre-RoEx validation failed: ${kind} not timeline-aligned`);
            }
            const url = await resolveAudioUrl(s.audio_path, 7200);
            if (!url) {
              console.warn("Skipping stem without readable URL", s.kind, s.audio_path);
              continue;
            }
            resolvedTracks.push({ path: url, kind });
          } else {
            resolvedTracks.push({ path: s.audio_path, kind });
          }
        }

        if (mode === "roex" && resolvedTracks.length < 2) {
          throw new Error("RoEx requires instrumental + at least one aligned vocal stem");
        }

        logProduce({ event: "mix_submit_new", jobId, projectId, track_count: resolvedTracks.length, mode });

        const mixStart = await provider.startMix(
          resolvedTracks.map((t) => ({
            path: t.path,
            kind: t.kind,
            instrumentGroup: stemToInstrumentGroup(t.kind),
            presenceSetting: (t.kind === "LEAD" ? "LEAD" : "NORMAL") as "LEAD" | "NORMAL",
            panPreference: "CENTRE" as const,
            reverbPreference: (t.kind === "LEAD" ? "LOW" : "NONE") as "LOW" | "NONE",
          })),
          { musicalStyle: style, preview: true, webhookUrl: getRoexWebhookUrl() }
        );

        out = { ...out, mix_provider_task_id: mixStart.provider_task_id, mix_poll_attempts: 0 };
        stage = "mix_poll";
        await patchJob(supabase, jobId, {
          stage,
          progress: 65,
          provider_task_id: mixStart.provider_task_id,
          provider: provider.name,
          output_data: out,
        });
        logProduce({ event: "mix_submitted", jobId, projectId, provider_task_id: mixStart.provider_task_id });
      }
    }

    // ---------- MIX POLL ----------
    if (stage === "mix_poll") {
      const taskId = out.mix_provider_task_id as string;
      if (!taskId) throw new Error("Missing mix provider_task_id");

      let mixDone = await provider.retrieveMix(taskId);
      let polls = out.mix_poll_attempts || 0;

      while (mode === "roex" && !mixDone.download_url && budgetOk() && polls < 24) {
        await sleep(4000);
        polls += 1;
        mixDone = await provider.retrieveMix(taskId);
        out = { ...out, mix_poll_attempts: polls };
        await patchJob(supabase, jobId, { output_data: out, progress: Math.min(78, 65 + polls) });
      }

      if (mode === "roex" && !mixDone.download_url) {
        await patchJob(supabase, jobId, { status: "processing", stage: "mix_poll", output_data: out, provider_task_id: taskId });
        return { pending: true, stage: "mix_poll", job_id: jobId };
      }

      stage = "mix_store";
      out = { ...out, mix_provider_url: mixDone.download_url || mixDone.local_path, mix_poll_attempts: polls };
      await patchJob(supabase, jobId, { stage, output_data: out, progress: 80 });
    }

    // ---------- MIX STORE ----------
    if (stage === "mix_store") {
      if (!(out.mix_storage_path && isStoragePath(out.mix_storage_path as string))) {
        const providerUrl = out.mix_provider_url as string | undefined;
        let storagePath: string;
        if (mode === "mock") {
          storagePath = providerUrl && isStoragePath(providerUrl) ? providerUrl : `mock://mix/${projectId}/${jobId}`;
        } else {
          if (!providerUrl || (!providerUrl.startsWith("http://") && !providerUrl.startsWith("https://"))) {
            throw new Error("RoEx mix completed without a downloadable URL");
          }
          if (!userId) throw new Error("Missing user_id on produce job for storage path");
          const dest = productionMixPath(userId, projectId, jobId, "wav");
          const persisted = await persistRemoteAudioToStorage(providerUrl, dest);
          storagePath = persisted.path;
        }
        const { data: versions } = await supabase
          .from("audio_versions")
          .select("version")
          .eq("project_id", projectId)
          .eq("kind", "preview_mix")
          .order("version", { ascending: false })
          .limit(1);
        const nextVer = (versions?.[0]?.version || 0) + 1;
        const { data: mixVersion } = await supabase
          .from("audio_versions")
          .insert({
            project_id: projectId,
            kind: "preview_mix",
            version: nextVer,
            audio_path: storagePath,
            job_id: jobId,
            provider: provider.name,
            provider_task_id: out.mix_provider_task_id,
            metadata: { mode, provider_url: out.mix_provider_url, permanent: isStoragePath(storagePath) },
          })
          .select()
          .single();
        out = { ...out, mix_storage_path: storagePath, mix_version_id: mixVersion?.id };
      }
      stage = "master_submit";
      await patchJob(supabase, jobId, { stage, progress: 85, output_data: out });
    }

    // ---------- MASTER SUBMIT ----------
    if (stage === "master_submit" || stage === "master") {
      if (out.master_provider_task_id) {
        stage = "master_poll";
        await patchJob(supabase, jobId, { stage, provider_task_id: out.master_provider_task_id, progress: 88 });
      } else {
        const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
        const style = mapMusicalStyle(project?.genre);
        let mixUrlForMaster: string | null = null;
        if (mode === "roex") {
          mixUrlForMaster = await resolveAudioUrl(out.mix_storage_path as string, 7200);
          if (!mixUrlForMaster && typeof out.mix_provider_url === "string") mixUrlForMaster = out.mix_provider_url;
          if (!mixUrlForMaster) throw new Error("No mix URL available for mastering");
        } else {
          mixUrlForMaster = (out.mix_storage_path as string) || `mock://mix/${projectId}`;
        }
        const masterStart = await provider.startMaster(mixUrlForMaster!, {
          musicalStyle: style,
          desiredLoudness: "MEDIUM",
          preview: true,
        });
        out = { ...out, master_provider_task_id: masterStart.provider_task_id, master_poll_attempts: 0 };
        stage = "master_poll";
        await patchJob(supabase, jobId, {
          stage,
          progress: 88,
          provider_task_id: masterStart.provider_task_id,
          output_data: out,
        });
      }
    }

    // ---------- MASTER POLL ----------
    if (stage === "master_poll") {
      const taskId = out.master_provider_task_id as string;
      if (!taskId) throw new Error("Missing master provider_task_id");
      let masterDone = await provider.retrieveMaster(taskId);
      let polls = out.master_poll_attempts || 0;
      while (mode === "roex" && !masterDone.download_url && budgetOk() && polls < 24) {
        await sleep(4000);
        polls += 1;
        masterDone = await provider.retrieveMaster(taskId);
        out = { ...out, master_poll_attempts: polls };
        await patchJob(supabase, jobId, { output_data: out, progress: Math.min(94, 88 + polls) });
      }
      if (mode === "roex" && !masterDone.download_url) {
        await patchJob(supabase, jobId, { status: "processing", stage: "master_poll", output_data: out, provider_task_id: taskId });
        return { pending: true, stage: "master_poll", job_id: jobId };
      }
      stage = "master_store";
      out = { ...out, master_provider_url: masterDone.download_url || masterDone.local_path, master_poll_attempts: polls };
      await patchJob(supabase, jobId, { stage, output_data: out, progress: 95 });
    }

    // ---------- MASTER STORE ----------
    if (stage === "master_store") {
      if (!(out.master_storage_path && isStoragePath(out.master_storage_path as string))) {
        const providerUrl = out.master_provider_url as string | undefined;
        let storagePath: string;
        if (mode === "mock") {
          storagePath =
            providerUrl && isStoragePath(providerUrl)
              ? providerUrl
              : (out.mix_storage_path as string) || `mock://master/${projectId}/${jobId}`;
        } else {
          if (!providerUrl || (!providerUrl.startsWith("http://") && !providerUrl.startsWith("https://"))) {
            throw new Error("RoEx master completed without a downloadable URL");
          }
          if (!userId) throw new Error("Missing user_id on produce job for storage path");
          const dest = productionMasterPath(userId, projectId, jobId, "wav");
          const persisted = await persistRemoteAudioToStorage(providerUrl, dest);
          storagePath = persisted.path;
        }
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
            audio_path: storagePath,
            job_id: jobId,
            provider: provider.name,
            provider_task_id: out.master_provider_task_id,
            metadata: { mode, provider_url: out.master_provider_url, permanent: isStoragePath(storagePath) },
          })
          .select()
          .single();
        out = { ...out, master_storage_path: storagePath, master_version_id: masterVersion?.id };
        await supabase.from("songs").insert({
          project_id: projectId,
          audio_path: storagePath,
          status: "ready",
          version: masterVer,
          metadata: {
            audio_version_id: masterVersion?.id,
            mode,
            mix_storage_path: out.mix_storage_path,
            permanent: isStoragePath(storagePath),
          },
        });
      }
      stage = "complete";
      await patchJob(supabase, jobId, {
        status: "complete",
        progress: 100,
        stage: "complete",
        output_data: { ...out, mode, provider: provider.name },
        completed_at: new Date().toISOString(),
      });
      await supabase.from("projects").update({ status: "complete" }).eq("id", projectId);
      return { complete: true, mix_version_id: out.mix_version_id, master_version_id: out.master_version_id, mode };
    }

    return { pending: true, stage, job_id: jobId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Produce pipeline failed";
    console.error("tickProduceJob", jobId, e);
    logProduce({ event: "failed", jobId, projectId, stage, error: msg });
    await supabase
      .from("jobs")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString() })
      .eq("id", jobId);
    await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
    throw e;
  }
}

async function resolveAudioUrl(path: string | null | undefined, expiresSec = 7200): Promise<string | null> {
  if (!path || path.startsWith("mock://")) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const { resolveAudioUrl: resolve } = await import("@/lib/storage");
  return resolve(path, expiresSec);
}

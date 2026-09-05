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
import { buildAndStoreTimelineAlignedStem } from "@/lib/audio/render-aligned-stem";
import {
  prepareRoexTrack,
  validateTracksForRoex,
  userFacingProduceError,
} from "@/lib/audio/roex-assets";
import { appendSampleStems } from "@/lib/audio/sample-stems";
import {
  resolvePlacementStartMs,
  buildPlacementManifest,
} from "@/lib/audio/session-timeline";

export { getPipelineMode, getMixProvider, enqueueProduceSong } from "@/lib/audio/produce-job";
// enqueueProduceSong throws: "Project not found or not owned by user"

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
  if (stage === "webhook_received") {
    const hasMasterTask = Boolean(out.master_provider_task_id);
    const hasMixTask = Boolean(out.mix_provider_task_id);
    if (hasMasterTask && !out.master_storage_path) stage = "master_poll";
    else if (hasMixTask && out.mix_storage_path && !out.master_storage_path) stage = "master_submit";
    else if (hasMixTask && !out.mix_storage_path) stage = "mix_poll";
    else stage = "mix_poll";
    logProduce({ event: "recover_webhook_received_stage", jobId, projectId, recovered_stage: stage });
  }
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
      if (mode === "roex" && userId) {
        try {
          const { convertBufferToWav } = await import("@/lib/audio/convert-to-wav");
          const { downloadStorageOrUrl } = await import("@/lib/audio/roex-assets");
          const { isWavBuffer, ensureStereoWavForRoex } = await import("@/lib/audio/wav");
          const { uploadBuffer } = await import("@/lib/storage");
          let buf = await downloadStorageOrUrl(instrumentalPath);
          if (!isWavBuffer(buf)) {
            const conv = await convertBufferToWav(buf, instrumentalPath);
            buf = conv.buffer;
          }
          buf = ensureStereoWavForRoex(buf);
          const dest = `users/${userId}/projects/${projectId}/production/${jobId}/stems/instrumental.wav`;
          await uploadBuffer(dest, buf, "audio/wav");
          instrumentalPath = dest;
          logProduce({ event: "instrumental_wav_prepared", jobId, projectId, bytes: buf.length });
        } catch (e) {
          logProduce({
            event: "instrumental_wav_prepare_failed",
            jobId,
            projectId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      stemRows.push({
        project_id: projectId,
        kind: "INSTRUMENTAL",
        audio_path: instrumentalPath,
        duration_ms: beat.duration_ms || songDurationMs,
        order_index: 0,
        source_recording_ids: [],
        metadata: { role: "instrumental", song_duration_ms: songDurationMs },
      });

      const byKind = new Map<StemKind, ArrangementPlacement[]>();
      for (const p of placements) {
        if (!byKind.has(p.stem_kind)) byKind.set(p.stem_kind, []);
        byKind.get(p.stem_kind)!.push(p);
      }

      const kindEntries = [...byKind.entries()];
      const alignedResults = await Promise.all(
        kindEntries.map(async ([kind, list], index) => {
          const first = list[0];
          const rec = takes.find((t) => t.id === first.recording_id);
          const sourcePath = rec?.processed_path || rec?.audio_path;
          if (!sourcePath || !isStoragePath(sourcePath)) {
            throw new Error(`Vocal take ${first.recording_id} has no storage path for alignment`);
          }
          if (typeof first.start_ms !== "number" || first.start_ms < 0) {
            throw new Error(`Invalid timeline start for recording ${first.recording_id}`);
          }

          if (mode === "mock") {
            return {
              project_id: projectId,
              kind,
              audio_path: sourcePath,
              duration_ms: songDurationMs,
              order_index: index + 1,
              source_recording_ids: list.map((l) => l.recording_id),
              metadata: {
                placements: list,
                mock_render: true,
                timeline_aligned: true,
                full_song_pad: "mock",
                song_duration_ms: songDurationMs,
                timeline_start_ms: first.start_ms,
                timeline_end_ms: first.end_ms,
              },
            };
          }

          const aligned = await buildAndStoreTimelineAlignedStem({
            userId,
            projectId,
            jobId,
            recordingId: first.recording_id,
            sourcePath,
            timelineStartMs: first.start_ms,
            timelineEndMs: first.end_ms,
            songDurationMs,
          });

          if (!aligned.timelineAligned) {
            throw new Error(`Could not timeline-align vocal ${first.recording_id}`);
          }

          logProduce({
            event: "stem_aligned",
            jobId,
            projectId,
            recording_id: first.recording_id,
            path: aligned.storagePath,
            alignment_status: aligned.alignmentStatus,
            duration_ms: aligned.durationMs,
          });

          return {
            project_id: projectId,
            kind,
            audio_path: aligned.storagePath,
            duration_ms: aligned.durationMs,
            order_index: index + 1,
            source_recording_ids: list.map((l) => l.recording_id),
            metadata: {
              placements: list,
              mock_render: false,
              timeline_aligned: true,
              full_song_pad: "pcm_wav",
              alignment_status: aligned.alignmentStatus,
              song_duration_ms: songDurationMs,
              actual_vocal_ms: aligned.actualVocalMs,
              timeline_start_ms: aligned.timelineStartMs,
              source_path: sourcePath,
            },
          };
        })
      );
      for (const row of alignedResults) {
        stemRows.push(row);
      }
      let order = alignedResults.length + 1;

      const vocalStems = stemRows.filter((s) => s.kind !== "INSTRUMENTAL");
      for (const s of vocalStems) {
        const meta = (s.metadata || {}) as Record<string, unknown>;
        if (meta.timeline_aligned !== true) {
          throw new Error(`Vocal stem ${String(s.kind)} is not timeline-aligned — refusing RoEx mix`);
        }
        if (mode === "roex" && meta.full_song_pad === "metadata_only") {
          throw new Error("Refusing RoEx mix: vocal stem pad is metadata-only");
        }
      }
      if (vocalStems.length === 0) {
        throw new Error("No vocal stems after alignment — refusing mix");
      }

      try {
        order = await appendSampleStems({
          supabase,
          userId,
          projectId,
          jobId,
          songDurationMs,
          mode,
          stemRows,
          orderStart: order,
        });
      } catch (sampleErr) {
        logProduce({
          event: "sample_stems_error",
          jobId,
          projectId,
          error: sampleErr instanceof Error ? sampleErr.message : "sample stems failed",
        });
      }

      if (stemRows.length) await supabase.from("audio_stems").insert(stemRows);
      stage = "mix_submit";
      await patchJob(supabase, jobId, {
        progress: 60,
        stage,
        output_data: { ...out, song_duration_ms: songDurationMs },
      });
    }

    if (stage === "mix_submit" || stage === "mix" || stage === "mix_poll" || stage === "mix_store") {
      if (mode === "mock") {
        const mixPath = `mock://mix/${projectId}/${jobId}`;
        out = { ...out, mix_storage_path: mixPath, mix_provider_task_id: `mock-mix-${jobId}` };
        stage = "master_submit";
        await patchJob(supabase, jobId, { stage, progress: 85, output_data: out });
      } else {
        const mixTracks = ((await supabase.from("audio_stems").select("*").eq("project_id", projectId)).data ||
          []) as (StemRow & { metadata?: Record<string, unknown> })[];
        if (!mixTracks.some((s) => s.kind === "INSTRUMENTAL")) {
          throw new Error("Pre-RoEx validation failed: instrumental missing");
        }
        for (const s of mixTracks) {
          if (s.kind === "INSTRUMENTAL") continue;
          const meta = (s.metadata || {}) as Record<string, unknown>;
          if (meta.timeline_aligned !== true) {
            throw new Error(`Pre-RoEx validation failed: ${s.kind} not timeline-aligned`);
          }
        }
        if (out.mix_provider_task_id) {
          logProduce({ event: "mix_resume_existing", jobId, projectId, taskId: out.mix_provider_task_id });
          stage = "mix_poll";
        } else {
          const { data: project } = await supabase.from("projects").select("genre").eq("id", projectId).single();
          const style = mapMusicalStyle(project?.genre);
          await validateTracksForRoex(mixTracks);
          const preparedList = await Promise.all(
            mixTracks.map(async (s) => {
              const kind = s.kind as StemKind;
              const prepared = await prepareRoexTrack({
                provider,
                storagePath: s.audio_path,
                kind,
                jobId,
                projectId,
              });
              return { path: prepared.providerUrl, kind };
            })
          );
          const resolvedTracks = preparedList;
          if (resolvedTracks.length < 2) {
            throw new Error("RoEx requires instrumental + at least one aligned vocal stem");
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
        }

        if (stage === "mix_poll") {
          const taskId = out.mix_provider_task_id as string;
          let mixDone = await provider.retrieveMix(taskId);
          let polls = out.mix_poll_attempts || 0;
          while (!mixDone.download_url && budgetOk() && polls < 30) {
            const delay = Math.min(5000, 1500 + polls * 400);
            await sleep(delay);
            polls += 1;
            mixDone = await provider.retrieveMix(taskId);
            out = { ...out, mix_poll_attempts: polls };
            if (polls === 1 || polls % 2 === 0 || mixDone.download_url) {
              await patchJob(supabase, jobId, { output_data: out, progress: Math.min(78, 65 + polls) });
            }
          }
          if (!mixDone.download_url) {
            await patchJob(supabase, jobId, {
              status: "processing",
              stage: "mix_poll",
              output_data: out,
              provider_task_id: taskId,
            });
            return { pending: true, stage: "mix_poll", job_id: jobId };
          }
          if (!(out.mix_storage_path && isStoragePath(out.mix_storage_path))) {
            const providerUrl = mixDone.download_url || mixDone.local_path;
            if (!providerUrl || !providerUrl.startsWith("http")) {
              throw new Error("RoEx mix completed without a downloadable URL");
            }
            if (!userId) throw new Error("Missing user_id on produce job for storage path");
            const dest = productionMixPath(userId, projectId, jobId, "wav");
            const persisted = await persistRemoteAudioToStorage(providerUrl, dest);
            out = { ...out, mix_storage_path: persisted.path, mix_provider_url: providerUrl };
          }
          stage = "master_submit";
          await patchJob(supabase, jobId, { stage, progress: 85, output_data: out });
        }
      }
    }

    if (stage === "master_submit" || stage === "master" || stage === "master_poll" || stage === "master_store") {
      if (mode === "mock") {
        const masterPath = (out.mix_storage_path as string) || `mock://master/${projectId}/${jobId}`;
        out = { ...out, master_storage_path: masterPath, master_provider_task_id: `mock-master-${jobId}` };
        await supabase.from("songs").insert({
          project_id: projectId,
          audio_path: masterPath,
          status: "ready",
          version: 1,
          metadata: { mode: "mock", mix_storage_path: out.mix_storage_path },
        });
        await patchJob(supabase, jobId, {
          status: "complete",
          progress: 100,
          stage: "complete",
          output_data: { ...out, mode, provider: provider.name },
          completed_at: new Date().toISOString(),
        });
        await supabase.from("projects").update({ status: "complete" }).eq("id", projectId);
        logProduce({ event: "complete", jobId, projectId, mode: "mock" });
        return { complete: true, mode: "mock" };
      }

      if (out.master_provider_task_id) {
        logProduce({ event: "master_resume_existing", jobId, projectId, taskId: out.master_provider_task_id });
        stage = "master_poll";
      } else {
        const { data: project } = await supabase.from("projects").select("genre").eq("id", projectId).single();
        const style = mapMusicalStyle(project?.genre);
        let mixUrlForMaster: string | null = null;
        if (
          typeof out.mix_provider_url === "string" &&
          out.mix_provider_url.startsWith("http") &&
          !out.mix_provider_url.includes("supabase")
        ) {
          mixUrlForMaster = out.mix_provider_url;
        } else if (out.mix_storage_path && isStoragePath(out.mix_storage_path as string)) {
          const prepared = await prepareRoexTrack({
            provider,
            storagePath: out.mix_storage_path as string,
            kind: "INSTRUMENTAL",
            jobId,
            projectId,
          });
          mixUrlForMaster = prepared.providerUrl;
        }
        if (!mixUrlForMaster) throw new Error("No RoEx-safe mix URL available for mastering");
        const masterStart = await provider.startMaster(mixUrlForMaster, {
          musicalStyle: style,
          desiredLoudness: "MEDIUM",
          preview: true,
          webhookUrl: getRoexWebhookUrl(),
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

      if (stage === "master_poll") {
        const taskId = out.master_provider_task_id as string;
        let masterDone = await provider.retrieveMaster(taskId);
        let polls = out.master_poll_attempts || 0;
        while (!masterDone.download_url && budgetOk() && polls < 30) {
          const delay = Math.min(5000, 1500 + polls * 400);
          await sleep(delay);
          polls += 1;
          masterDone = await provider.retrieveMaster(taskId);
          out = { ...out, master_poll_attempts: polls };
          if (polls === 1 || polls % 2 === 0 || masterDone.download_url) {
            await patchJob(supabase, jobId, { output_data: out, progress: Math.min(94, 88 + polls) });
          }
        }
        if (!masterDone.download_url) {
          await patchJob(supabase, jobId, {
            status: "processing",
            stage: "master_poll",
            output_data: out,
            provider_task_id: taskId,
          });
          return { pending: true, stage: "master_poll", job_id: jobId };
        }
        if (!(out.master_storage_path && isStoragePath(out.master_storage_path))) {
          const providerUrl = masterDone.download_url || masterDone.local_path;
          if (!providerUrl || !providerUrl.startsWith("http")) {
            throw new Error("RoEx master completed without a downloadable URL");
          }
          if (!userId) throw new Error("Missing user_id on produce job for storage path");
          const dest = productionMasterPath(userId, projectId, jobId, "wav");
          const persisted = await persistRemoteAudioToStorage(providerUrl, dest);
          out = { ...out, master_storage_path: persisted.path };
          await supabase.from("songs").insert({
            project_id: projectId,
            audio_path: persisted.path,
            status: "ready",
            version: 1,
            metadata: { mode, mix_storage_path: out.mix_storage_path, permanent: true },
          });
        }
        await patchJob(supabase, jobId, {
          status: "complete",
          progress: 100,
          stage: "complete",
          output_data: { ...out, mode, provider: provider.name },
          completed_at: new Date().toISOString(),
        });
        await supabase.from("projects").update({ status: "complete" }).eq("id", projectId);
        logProduce({ event: "complete", jobId, projectId });
        return { complete: true, mode };
      }
    }

    return { pending: true, stage, job_id: jobId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Produce pipeline failed";
    const msg = userFacingProduceError(raw);
    console.error("tickProduceJob", jobId, e);
    logProduce({ event: "failed", jobId, projectId, stage, error: msg, provider_error: raw.slice(0, 500) });
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error: msg,
        output_data: { ...out, provider_error: raw.slice(0, 1000), failed_stage: stage },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
    throw e;
  }
}

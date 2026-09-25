/**
 * Integrate AP arrangement engine with existing produce jobs.
 * Assembles ALL recorded sections onto the beat timeline (full song).
 */

import { createServiceClient } from "@/lib/supabase/service";
import {
  productionMasterPath,
  productionMixPath,
  uploadBuffer,
} from "@/lib/storage";
import type { ApStage } from "../types";
import { collectVocalsForProduce } from "./collect-vocals";
import { runFastArrangement } from "@/lib/ap-engine/jobs/fast-produce";
import { runFullProduceWithCheckpoints } from "./run-full-phased";

export async function runInternalApProduceJob(opts: {
  jobId: string;
  projectId: string;
  userId: string;
}): Promise<{ complete: boolean; error?: string }> {
  const { jobId, projectId, userId } = opts;
  const supabase = createServiceClient();

  const patch = async (stage: string, progress: number, extra?: Record<string, unknown>) => {
    const { data: job } = await supabase.from("jobs").select("output_data").eq("id", jobId).single();
    const out = { ...((job?.output_data as object) || {}), ...(extra || {}), mode: "ap", provider: "ap-internal" };
    await supabase
      .from("jobs")
      .update({
        status:
          stage === "failed"
            ? "failed"
            : stage === "completed" || stage === "complete"
              ? "complete"
              : "processing",
        stage,
        progress,
        output_data: out,
        ...(stage === "completed" || stage === "complete" || stage === "failed"
          ? { completed_at: new Date().toISOString() }
          : {}),
        ...(stage === "failed" && extra?.error ? { error: String(extra.error) } : {}),
      })
      .eq("id", jobId);
  };

  const report = async (stage: ApStage) => {
    const progressMap: Record<string, number> = {
      analyzing: 20,
      restoring: 35,
      polishing: 42,
      producing: 50,
      mixing: 78,
      arranging: 70,
      mastering: 85,
      quality_check: 92,
      completed: 100,
      failed: 100,
      queued: 10,
    };
    await patch(stage === "completed" ? "complete" : stage, progressMap[stage] ?? 40);
  };

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("id, genre, mood, tempo, metadata")
      .eq("id", projectId)
      .single();

    const { resolveProjectBeat } = await import("@/lib/audio/resolve-project-beat");
    const { beat: resolvedBeat, diagnostics: beatDiag } = await resolveProjectBeat(
      supabase,
      projectId
    );
    console.info(
      "[ap-tick] beat resolve",
      JSON.stringify({ jobId, projectId, beatDiag, path: resolvedBeat?.audio_path?.slice(0, 80) })
    );

    if (!resolvedBeat?.audio_path) {
      await patch("failed", 100, {
        error: "Beat validation failed — add a beat before Produce.",
        beatDiag,
      });
      await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
      return { complete: false, error: "Beat validation failed" };
    }
    const beat = resolvedBeat;

    const { vocals, placementLog, diagnostics: vocalDiag } = await collectVocalsForProduce(
      supabase,
      projectId
    );
    console.info(
      "[ap-tick] arrangement layers",
      JSON.stringify({
        jobId,
        projectId,
        layerCount: vocals.length,
        placements: placementLog.map((p) => ({
          type: p.type,
          startMs: p.startMs,
          taskId: p.taskId,
          title: p.title,
        })),
        diagnostics: vocalDiag,
      })
    );

    if (!vocals.length) {
      const diagHint = (vocalDiag || []).slice(0, 8).join(" | ");
      const detail =
        diagHint.includes("download_fail")
          ? "Vocal files are in the database but could not be downloaded from storage (check R2 env on the worker)."
          : diagHint.includes("no_usable_audio_path")
            ? "Recording rows exist but have no storage path — the take may not have finished uploading."
            : diagHint.includes("recordings=0")
              ? "No recording rows for this project in the database the worker uses."
              : "No usable vocal take after plan matching and download.";
      const errorMsg = `No saved vocal take found. ${detail}${diagHint ? ` [${diagHint}]` : ""}`;
      await patch("failed", 100, {
        error: errorMsg,
        vocalDiag,
      });
      await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
      return { complete: false, error: errorMsg };
    }

    await report("analyzing");
    // Fast path for small sessions (≤3 vocal layers) so 1–2 take songs finish in minutes.
    // Full engine: PRODUCE_FULL_QUALITY=1, or more than 3 layers (unless PRODUCE_FAST=1).
    const forceFull =
      process.env.PRODUCE_FULL_QUALITY === "1" ||
      process.env.PRODUCE_FULL_QUALITY === "true";
    const forceFast =
      process.env.PRODUCE_FAST === "1" ||
      process.env.PRODUCE_FULL_QUALITY === "0" ||
      process.env.PRODUCE_FULL_QUALITY === "false";
    const smallSession = vocals.length <= 3;
    const useFast = forceFast || (smallSession && !forceFull);
    console.info(
      "[ap-tick] path",
      JSON.stringify({
        jobId,
        path: useFast ? "fast" : "full",
        layers: vocals.length,
        forceFull,
        forceFast,
        smallSession,
      })
    );
    if (useFast) {
      await patch("mixing", 35, { message: "Fast mix — assemble + polish" });
      const mixPath = productionMixPath(userId, projectId, jobId, "wav");
      const masterPath = productionMasterPath(userId, projectId, jobId, "wav");
      try {
        const fast = await runFastArrangement({
          beatPath: String(beat.audio_path),
          vocals: vocals as import("@/lib/ap-engine/jobs/fast-produce").FastVocalLayer[],
          genre: (project as { genre?: string | null }).genre ?? null,
          onStage: async (stage) => {
            await patch(String(stage), 55, { message: String(stage) });
          },
        });
        const wavBuf: Buffer = Buffer.isBuffer(fast.wav)
          ? fast.wav
          : Buffer.from(fast.wav as Uint8Array);
        await uploadBuffer(masterPath, wavBuf, "audio/wav");
        await uploadBuffer(mixPath, wavBuf, "audio/wav");
        await patch("complete", 100, {
          path: "fast",
          master_path: masterPath,
          mix_path: mixPath,
          mode: "ap-fast",
          duration_ms: fast.durationMs,
          layer_count: fast.layerCount,
        });
        await supabase
          .from("projects")
          .update({ status: "complete" })
          .eq("id", projectId);
        return { complete: true };
      } catch (fe) {
        const msg = fe instanceof Error ? fe.message : String(fe);
        console.error("[ap-tick] fast path failed, falling through to full engine", msg);
        // Fall through to full engine rather than hard-fail
      }
    }

    // Full AP engine — multi-tick checkpoints.
// Full AP engine — multi-tick checkpoints.

    const mixPath = productionMixPath(userId, projectId, jobId, "wav");
    const masterPath = productionMasterPath(userId, projectId, jobId, "wav");
    let mp3Path: string | null = null;
    let engineVersion = "ap-full";
    let metaExtra: Record<string, unknown> = {
      vocal_layers: vocals.length,
      placements: placementLog,
    };

    const projectMeta =
      project && typeof (project as { metadata?: unknown }).metadata === "object"
        ? ((project as { metadata: Record<string, unknown> }).metadata || {})
        : {};
    const productionDirection =
      projectMeta.production_direction && typeof projectMeta.production_direction === "object"
        ? (projectMeta.production_direction as import("../direction/types").ProductionDirection)
        : null;

    const phased = await runFullProduceWithCheckpoints({
      jobId,
      projectId,
      userId,
      beatPath: beat.audio_path,
      vocals,
      genre: (() => {
        const g = (project as { genre?: unknown } | null)?.genre;
        if (typeof g === "string") return g;
        if (Array.isArray(g)) return g.filter((x) => typeof x === "string").join(" ");
        if (g && typeof g === "object" && typeof (g as { name?: string }).name === "string") {
          return (g as { name: string }).name;
        }
        return null;
      })(),
      productionDirection,
      placementLog,
      report,
      patch,
    });
    if (!phased.complete) {
      if (phased.error) {
        await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
        return { complete: false, error: phased.error };
      }
      // Checkpoint saved — next status poll resumes full engine
      return { complete: false };
    }
    engineVersion = phased.engineVersion || "ap-full";
    mp3Path = phased.mp3Path ?? null;
    metaExtra = {
      ...metaExtra,
      ...(phased.metaExtra || {}),
    };

    await supabase.from("songs").insert({
      project_id: projectId,
      audio_path: masterPath,
      status: "ready",
      version: 1,
      metadata: {
        mode: "ap",
        provider: "ap-internal",
        engineVersion,
        ...metaExtra,
      },
    });

    try {
      const { count } = await supabase
        .from("audio_versions")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("kind", "master");
      const nextVer = (count || 0) + 1;
      await supabase.from("audio_versions").insert({
        project_id: projectId,
        kind: "master",
        version: nextVer,
        audio_path: masterPath,
        metadata: {
          mode: "ap",
          provider: "ap-internal",
          engineVersion,
          mix_storage_path: mixPath,
          master_mp3_path: mp3Path,
          vocal_layers: vocals.length,
          placements: placementLog,
        },
      });
    } catch (avErr) {
      console.warn("[ap-tick] audio_versions insert skipped", avErr);
    }

    await supabase
      .from("jobs")
      .update({
        status: "complete",
        stage: "complete",
        progress: 100,
        error: null,
        output_data: {
          mode: "ap",
          provider: "ap-internal",
          engineVersion,
          mix_storage_path: mixPath,
          master_storage_path: masterPath,
          master_mp3_path: mp3Path,
          vocal_layers: vocals.length,
          placements: placementLog,
          ...metaExtra,
        },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await supabase.from("projects").update({ status: "complete" }).eq("id", projectId);
    return { complete: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await patch("failed", 100, { error: msg });
    await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
    return { complete: false, error: msg };
  }
}

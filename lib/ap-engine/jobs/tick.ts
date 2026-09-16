/**
 * Integrate AP arrangement engine with existing produce jobs.
 * Assembles ALL recorded sections onto the beat timeline (full song).
 */

import { createServiceClient } from "@/lib/supabase/server";
import {
  productionMasterPath,
  productionMixPath,
  uploadBuffer,
} from "@/lib/storage";
import type { ApStage } from "../types";
import { collectVocalsForProduce } from "./collect-vocals";
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
      mixing: 70,
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
      await patch("failed", 100, {
        error: "No saved vocal take found. Record each section, then Produce.",
      });
      await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
      return { complete: false, error: "No vocal take" };
    }

    await report("analyzing");
    // Full AP engine only — multi-tick checkpoints (no fast path).
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
      genre: project?.genre,
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

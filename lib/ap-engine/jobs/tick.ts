/**
 * Integrate AP arrangement engine with existing produce jobs.
 * Assembles ALL recorded sections onto the beat timeline (full song).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { downloadStorageOrUrl } from "@/lib/audio/roex-assets";
import {
  productionMasterPath,
  productionMixPath,
  uploadBuffer,
} from "@/lib/storage";
import { runApArrangement } from "../index";
import type { ApStage } from "../types";
import { collectVocalsForProduce } from "./collect-vocals";
import { runFastArrangement } from "./fast-produce";

const AP_STAGES: ReadonlySet<string> = new Set([
  "queued",
  "analyzing",
  "restoring",
  "polishing",
  "producing",
  "mixing",
  "mastering",
  "quality_check",
  "completed",
  "failed",
]);

function asApStage(s: string): ApStage | null {
  if (s === "exporting") return "mastering";
  if (AP_STAGES.has(s)) return s as ApStage;
  return null;
}

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
      .select("id, genre, mood, tempo")
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
    // Full engine is the default produce path (restoration + QC + proper gain staging).
    // Opt into the fast stopgap only with AP_FAST_ENGINE=1 (e.g. emergency Vercel timeouts).
    const useFast =
      process.env.AP_FAST_ENGINE === "1" || process.env.AP_FAST_ENGINE === "true";

    const mixPath = productionMixPath(userId, projectId, jobId, "wav");
    const masterPath = productionMasterPath(userId, projectId, jobId, "wav");
    let mp3Path: string | null = null;
    let engineVersion = "ap-full";
    let metaExtra: Record<string, unknown> = {
      vocal_layers: vocals.length,
      placements: placementLog,
    };

    if (useFast) {
      const fast = await runFastArrangement({
        beatPath: beat.audio_path,
        vocals,
        onStage: async (s) => {
          const stage = asApStage(s);
          if (stage) await report(stage);
        },
      });
      engineVersion = "ap-fast-stopgap-2";
      await report("mastering");
      await uploadBuffer(masterPath, fast.wav, "audio/wav");
      await uploadBuffer(mixPath, fast.wav, "audio/wav");
      metaExtra = {
        ...metaExtra,
        duration_ms: fast.durationMs,
        path: "fast-stopgap",
        engineVersion: "ap-fast-stopgap-2",
        fast_diagnostics: fast.diagnostics,
        note: "Opt-in fast stopgap (AP_FAST_ENGINE=1). Default produce uses full engine.",
      };
    } else {
      const beatBuffer = await downloadStorageOrUrl(beat.audio_path);
      const result = await runApArrangement(
        {
          jobId,
          projectId,
          userId,
          beatBuffer,
          beatPathHint: beat.audio_path,
          vocals,
          genre: project?.genre,
        },
        report
      );

      if (!result.ok) {
        await patch("failed", 100, {
          error: result.error,
          detail: result.detail,
          engineVersion: "ap-full",
          placementLog,
        });
        await supabase.from("projects").update({ status: "recording" }).eq("id", projectId);
        return { complete: false, error: result.error };
      }

      engineVersion = result.engineVersion || "ap-full";
      const processedVocalPath = `users/${userId}/projects/${projectId}/production/${jobId}/vocal-processed.wav`;
      const restoredVocalPath = `users/${userId}/projects/${projectId}/production/${jobId}/vocal-restored.wav`;
      await uploadBuffer(mixPath, result.mixWav, "audio/wav");
      await uploadBuffer(masterPath, result.masterWav, "audio/wav");
      await uploadBuffer(processedVocalPath, result.processedVocalWav, "audio/wav");
      await uploadBuffer(restoredVocalPath, result.restoredVocalWav, "audio/wav");
      if (result.masterMp3) {
        mp3Path = productionMasterPath(userId, projectId, jobId, "mp3");
        await uploadBuffer(mp3Path, result.masterMp3, "audio/mpeg");
      }
      const roleNote = result.decision.notes.find((n) => n.startsWith("roles:"));
      metaExtra = {
        ...metaExtra,
        mix_storage_path: mixPath,
        master_mp3_path: mp3Path,
        processed_vocal_path: processedVocalPath,
        restored_vocal_path: restoredVocalPath,
        decision: result.decision,
        roles: roleNote || null,
        qc: result.qc,
        retryCount: result.retryCount,
        path: "full",
      };
    }

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

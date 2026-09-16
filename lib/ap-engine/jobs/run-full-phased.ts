/**
 * Full AP produce with multi-tick checkpoint/resume.
 * Phase restoring → arranging → done (persisted on jobs.output_data.ap_checkpoint).
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
import type { ApVocalLayerInput } from "../index";
import {
  emptyCheckpoint,
  restoredLayerPath,
  type ApCheckpoint,
} from "./ap-checkpoint";
import { runRestorationFrontEnd } from "../restoration/front-end";
import { normalizeToInternalPcm } from "../ingestion/normalize";
import { encodeStereoWav } from "../dsp";
import { validateAudioBuffer } from "../ingestion/validate";
import type { PlacementLog } from "./collect-vocals";

type ReportFn = (stage: ApStage) => Promise<void>;
type PatchFn = (stage: string, progress: number, extra?: Record<string, unknown>) => Promise<void>;

export async function runFullProduceWithCheckpoints(opts: {
  jobId: string;
  projectId: string;
  userId: string;
  beatPath: string;
  vocals: ApVocalLayerInput[];
  genre?: string | null;
  productionDirection?: import("../direction/types").ProductionDirection | null;
  placementLog: PlacementLog[];
  report: ReportFn;
  patch: PatchFn;
}): Promise<{
  complete: boolean;
  error?: string;
  engineVersion?: string;
  mixPath?: string;
  masterPath?: string;
  mp3Path?: string | null;
  metaExtra?: Record<string, unknown>;
}> {
  const { jobId, projectId, userId, beatPath, vocals, genre, productionDirection, placementLog, report, patch } = opts;
  const supabase = createServiceClient();
  const mixPath = productionMixPath(userId, projectId, jobId, "wav");
  const masterPath = productionMasterPath(userId, projectId, jobId, "wav");
  let mp3Path: string | null = null;

  const { data: jobRow } = await supabase.from("jobs").select("output_data").eq("id", jobId).single();
  const priorOut = { ...((jobRow?.output_data as object) || {}) } as Record<string, unknown>;
  let cp = (priorOut.ap_checkpoint as ApCheckpoint | undefined) || emptyCheckpoint();
  if (!cp.wallStartedAt) cp.wallStartedAt = new Date().toISOString();
  cp.tickCount = (cp.tickCount || 0) + 1;
  const tickStarted = Date.now();
  const deadlineAt = tickStarted + 220_000;
  const budgetOk = () => Date.now() < deadlineAt - 15_000;

  console.info(
    "[ap-tick] checkpoint",
    JSON.stringify({
      jobId,
      phase: cp.phase,
      restoreIndex: cp.restoreIndex,
      layersDone: cp.layers.length,
      tickCount: cp.tickCount,
    })
  );

  if (cp.phase === "restoring") {
    await report("restoring");
    const tRestore = Date.now();
    while (cp.restoreIndex < vocals.length && budgetOk()) {
      const v = vocals[cp.restoreIndex];
      const idx = cp.restoreIndex;
      try {
        const val = validateAudioBuffer(v.buffer, v.pathHint);
        if (!val.ok) {
          cp.restoreIndex++;
          continue;
        }
        const norm = await normalizeToInternalPcm(v.buffer, v.pathHint);
        const restored = runRestorationFrontEnd(norm.pcm);
        const wav = encodeStereoWav(restored.pcm);
        const storagePath = restoredLayerPath(userId, projectId, jobId, idx);
        await uploadBuffer(storagePath, wav, "audio/wav");
        cp.layers.push({
          index: idx,
          storagePath,
          role: String(v.taskType || v.sectionLabel || "lead"),
          sectionLabel: v.sectionLabel,
          taskType: v.taskType,
          startMs: Math.max(0, Number(v.startMs) || 0),
          pathHint: v.pathHint,
          noiseFloorBeforeDb: restored.report.noiseFloorBeforeDb,
          noiseFloorAfterDb: restored.report.noiseFloorAfterDb,
          restoreConfidence: restored.report.confidence,
        });
      } catch (e) {
        console.warn("[ap-tick] restore layer failed", idx, e);
      }
      cp.restoreIndex++;
    }
    cp.stageTimingsMs.restore_tick =
      (cp.stageTimingsMs.restore_tick || 0) + (Date.now() - tRestore);

    if (cp.restoreIndex < vocals.length) {
      cp.phase = "restoring";
      cp.lastCheckpointAt = new Date().toISOString();
      cp.resumedFrom = "restoring";
      await patch(
        "restoring",
        Math.min(40, 15 + Math.round((cp.restoreIndex / Math.max(1, vocals.length)) * 25)),
        {
          ap_checkpoint: cp,
          path: "full",
          checkpoint_phase: cp.phase,
          tick_count: cp.tickCount,
          restored_layers: cp.layers.length,
          vocal_layers: vocals.length,
          placements: placementLog,
        }
      );
      return { complete: false };
    }
    cp.phase = "arranging";
    cp.lastCheckpointAt = new Date().toISOString();
    await patch("producing", 45, {
      ap_checkpoint: cp,
      path: "full",
      checkpoint_phase: "arranging",
      tick_count: cp.tickCount,
      restored_layers: cp.layers.length,
    });
    if (!budgetOk()) {
      return { complete: false };
    }
  }

  if (cp.phase === "arranging") {
    await report("producing");
    const tArr = Date.now();
    const arrangedVocals: ApVocalLayerInput[] = [];
    for (const layer of cp.layers) {
      try {
        const buf = await downloadStorageOrUrl(layer.storagePath);
        arrangedVocals.push({
          buffer: buf,
          pathHint: layer.pathHint || layer.storagePath,
          taskType: layer.taskType,
          sectionLabel: layer.sectionLabel,
          startMs: layer.startMs,
        });
      } catch (e) {
        console.warn("[ap-tick] load restored layer failed", layer.index, e);
      }
    }
    if (!arrangedVocals.length) {
      await patch("failed", 100, {
        error: "No restored vocal layers available for arrangement",
        ap_checkpoint: cp,
      });
      return { complete: false, error: "No restored layers" };
    }

    const beatBuffer = await downloadStorageOrUrl(beatPath);
    const result = await runApArrangement(
      {
        jobId,
        projectId,
        userId,
        beatBuffer,
        beatPathHint: beatPath,
        vocals: arrangedVocals,
        genre,
        productionDirection: productionDirection ?? null,
        skipRestoration: true,
        deadlineAt,
      },
      report
    );
    cp.stageTimingsMs.arrange = Date.now() - tArr;

    if (!result.ok) {
      await patch("failed", 100, {
        error: result.error,
        detail: result.detail,
        engineVersion: "ap-full",
        placementLog,
        ap_checkpoint: cp,
        tick_count: cp.tickCount,
      });
      return { complete: false, error: result.error };
    }

    const engineVersion = result.engineVersion || "ap-full";
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
    cp.phase = "done";
    const wallMs = Date.now() - new Date(cp.wallStartedAt).getTime();
    const metaExtra: Record<string, unknown> = {
      mix_storage_path: mixPath,
      master_mp3_path: mp3Path,
      processed_vocal_path: processedVocalPath,
      restored_vocal_path: restoredVocalPath,
      decision: result.decision,
      roles: roleNote || null,
      qc: result.qc,
      retryCount: result.retryCount,
      path: "full",
      engineVersion,
      stage_timings_ms: { ...cp.stageTimingsMs, ...(result.stageTimingsMs || {}) },
      stage_status: result.stageStatus || null,
      duration_ms: result.durationMs,
      tick_count: cp.tickCount,
      wall_clock_ms: wallMs,
      ap_checkpoint: { phase: "done", tickCount: cp.tickCount, wallStartedAt: cp.wallStartedAt },
      restored_layer_reports: cp.layers.map((l) => ({
        index: l.index,
        confidence: l.restoreConfidence,
        noiseBefore: l.noiseFloorBeforeDb,
        noiseAfter: l.noiseFloorAfterDb,
      })),
    };
    console.info(
      "[ap-tick] full arrange complete",
      JSON.stringify({ jobId, ticks: cp.tickCount, wallMs, arrangeMs: cp.stageTimingsMs.arrange })
    );
    return {
      complete: true,
      engineVersion,
      mixPath,
      masterPath,
      mp3Path,
      metaExtra,
    };
  }

  return { complete: false, error: "Unknown checkpoint phase" };
}

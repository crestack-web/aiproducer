/**
 * Full AP produce with multi-tick checkpoint/resume.
 * Phase restoring → arranging → done (persisted on jobs.output_data.ap_checkpoint).
 */
import { createServiceClient } from "@/lib/supabase/service";
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
import { isFullQualityProduce, produceWorkerTickBudgetMs } from "@/lib/produce/execution-mode";

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
  // Worker / full-quality: long budget (default 20m). Inline Vercel: keep ~3.5m soft budget.
  const tickBudgetMs = isFullQualityProduce() ? produceWorkerTickBudgetMs() : 220_000;
  const deadlineAt = tickStarted + tickBudgetMs;
  const budgetOk = () => Date.now() < deadlineAt - (isFullQualityProduce() ? 60_000 : 15_000);

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
    const restoreFails: string[] = Array.isArray((cp as { restoreFails?: string[] }).restoreFails)
      ? [...((cp as { restoreFails?: string[] }).restoreFails || [])]
      : [];
    while (cp.restoreIndex < vocals.length && budgetOk()) {
      const v = vocals[cp.restoreIndex];
      const idx = cp.restoreIndex;
      try {
        if (!v?.buffer || !Buffer.isBuffer(v.buffer) || v.buffer.length < 64) {
          restoreFails.push(`layer_${idx}: missing_or_tiny_buffer`);
          console.warn("[ap-tick] restore skip missing buffer", idx);
          cp.restoreIndex++;
          continue;
        }
        const val = validateAudioBuffer(v.buffer, v.pathHint);
        if (!val.ok) {
          restoreFails.push(`layer_${idx}: validate_fail ${val.errors?.join(",") || "invalid"}`);
          console.warn("[ap-tick] restore validate fail", idx, val.errors);
          // Fall through: still try normalize for arrangement (full path, skip heavy restore)
        }
        let uploaded = false;
        try {
          const norm = await normalizeToInternalPcm(v.buffer, v.pathHint);
          let pcm = norm.pcm;
          let noiseFloorBeforeDb: number | undefined;
          let noiseFloorAfterDb: number | undefined;
          let restoreConfidence: string | undefined;
          try {
            const restored = runRestorationFrontEnd(norm.pcm);
            pcm = restored.pcm;
            noiseFloorBeforeDb = restored.report.noiseFloorBeforeDb;
            noiseFloorAfterDb = restored.report.noiseFloorAfterDb;
            restoreConfidence = restored.report.confidence;
          } catch (re) {
            // Keep normalized PCM — arrangement must not die solely on restore DSP
            restoreFails.push(
              `layer_${idx}: restore_dsp ${re instanceof Error ? re.message : String(re)}`
            );
            console.warn("[ap-tick] restore DSP failed, using normalized PCM", idx, re);
          }
          const wav = encodeStereoWav(pcm);
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
            noiseFloorBeforeDb,
            noiseFloorAfterDb,
            restoreConfidence,
          });
          uploaded = true;
        } catch (e) {
          restoreFails.push(
            `layer_${idx}: ${e instanceof Error ? e.message : String(e)}`
          );
          console.warn("[ap-tick] restore layer failed", idx, e);
        }
        if (!uploaded) {
          /* layer skipped */
        }
      } catch (e) {
        restoreFails.push(`layer_${idx}: outer ${e instanceof Error ? e.message : String(e)}`);
        console.warn("[ap-tick] restore outer failed", idx, e);
      }
      cp.restoreIndex++;
    }
    (cp as { restoreFails?: string[] }).restoreFails = restoreFails.slice(-40);
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
    if (cp.layers.length === 0) {
      const fails = (cp as { restoreFails?: string[] }).restoreFails || [];
      const msg =
        "Produce could not prepare any vocal layers. " +
        (fails[0] || "Check that takes uploaded and are valid audio.");
      await patch("failed", 100, {
        error: msg.slice(0, 400),
        ap_checkpoint: cp,
        restoreFails: fails,
      });
      return { complete: false, error: msg };
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
    await report("arranging");
    await patch("arranging", 55, {
      ap_checkpoint: cp,
      path: "full",
      checkpoint_phase: "arranging",
      message: "Loading restored vocals onto the beat…",
    });
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
      const fails = (cp as { restoreFails?: string[] }).restoreFails || [];
      const detail =
        fails.length > 0
          ? fails.slice(0, 6).join("; ")
          : "all layers failed validate/download/upload during restore";
      const msg = `No vocal layers ready for arrangement (${detail})`;
      await patch("failed", 100, {
        error: msg,
        ap_checkpoint: cp,
        restoreFails: fails,
      });
      return { complete: false, error: msg };
    }

    await patch("arranging", 62, {
      ap_checkpoint: cp,
      path: "full",
      message: "Arranging vocals on the beat…",
      layers: arrangedVocals.length,
    });

    // Keep claim lock alive for the whole arrange (can exceed old 8m stale window)
    const { heartbeatProduceJob } = await import("@/lib/audio/claim-produce-job");
    const workerId =
      typeof (priorOut.worker_id) === "string" ? String(priorOut.worker_id) : "ap-arrange";
    const hb = setInterval(() => {
      void heartbeatProduceJob(jobId, workerId).catch(() => undefined);
    }, 45_000);

    let beatBuffer: Buffer;
    try {
      beatBuffer = await downloadStorageOrUrl(beatPath);
    } catch (be) {
      clearInterval(hb);
      const msg = `Could not download beat for arrangement: ${be instanceof Error ? be.message : String(be)}`;
      await patch("failed", 100, { error: msg, ap_checkpoint: cp });
      return { complete: false, error: msg };
    }

    // Soft wall: cap arrange so we never sit at 70% for the full tick budget.
    // Sync DSP does not yield to Promise.race timers — prefer failing over to fast.
    const remaining = deadlineAt - Date.now() - 30_000;
    const arrangeBudgetMs = Math.max(45_000, Math.min(5 * 60_000, remaining));
    const arrangeDeadline = Date.now() + arrangeBudgetMs;

    const reportWithProgress: typeof report = async (stage) => {
      await report(stage);
      // Map sub-stages to climbing progress so UI is not frozen at 70
      const prog: Record<string, number> = {
        analyzing: 58,
        restoring: 60,
        polishing: 64,
        producing: 66,
        arranging: 70,
        mixing: 78,
        mastering: 88,
        quality_check: 94,
        completed: 99,
      };
      const p = prog[String(stage)] ?? 70;
      await patch(String(stage === "completed" ? "arranging" : stage), p, {
        ap_checkpoint: { ...cp, phase: "arranging" },
        path: "full",
        message: String(stage),
      }).catch(() => undefined);
      void heartbeatProduceJob(jobId, workerId).catch(() => undefined);
    };

    let result: Awaited<ReturnType<typeof runApArrangement>>;
    try {
      result = await Promise.race([
        runApArrangement(
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
            deadlineAt: Math.min(deadlineAt, arrangeDeadline),
          },
          reportWithProgress
        ),
        new Promise<Awaited<ReturnType<typeof runApArrangement>>>((_, rej) => {
          setTimeout(
            () => rej(new Error(`Arrangement timed out after ${Math.round(arrangeBudgetMs / 1000)}s`)),
            arrangeBudgetMs
          );
        }),
      ]);
    } catch (ae) {
      clearInterval(hb);
      const msg = ae instanceof Error ? ae.message : String(ae);
      console.error("[ap-tick] arrange failed/timeout", msg);
      // Leave checkpoint at arranging so next tick can retry (not a permanent fail on soft timeout
      // unless we're out of wall budget)
      if (/timed out/i.test(msg) && budgetOk()) {
        cp.lastCheckpointAt = new Date().toISOString();
        cp.resumedFrom = "arranging";
        await patch("arranging", 70, {
          ap_checkpoint: cp,
          path: "full",
          message: "Arrangement still running — retrying next tick…",
          arrange_timeout: true,
        });
        return { complete: false };
      }
      await patch("failed", 100, {
        error: msg.slice(0, 400),
        ap_checkpoint: cp,
      });
      return { complete: false, error: msg };
    } finally {
      clearInterval(hb);
    }

    cp.stageTimingsMs.arrange = Date.now() - tArr;

    if (!result.ok) {
      const errMsg =
        result.detail && result.error && !String(result.error).includes(String(result.detail))
          ? `${result.error}: ${result.detail}`
          : result.error || result.detail || "Production engine failed";
      await patch("failed", 100, {
        error: errMsg,
        detail: result.detail,
        engineVersion: "ap-full",
        placementLog,
        ap_checkpoint: cp,
        tick_count: cp.tickCount,
      });
      return { complete: false, error: errMsg };
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

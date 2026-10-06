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
import { runFastArrangement } from "@/lib/ap-engine/jobs/fast-produce";

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
    await report("analyzing");
    await patch("analyzing", 18, {
      ap_checkpoint: cp,
      path: "full",
      message: "Checking vocal takes…",
    }).catch(() => undefined);
    await report("restoring");
    await patch("restoring", 28, {
      ap_checkpoint: cp,
      path: "full",
      message: "Cleaning up vocals (noise / levels)…",
    }).catch(() => undefined);
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
    await report("polishing");
    await patch("polishing", 48, {
      ap_checkpoint: cp,
      path: "full",
      checkpoint_phase: "arranging",
      tick_count: cp.tickCount,
      restored_layers: cp.layers.length,
      message: "Vocals cleaned — preparing arrangement…",
    });
    if (!budgetOk()) {
      return { complete: false };
    }
  }

  if (cp.phase === "arranging") {
    // Do NOT jump UI to "arranging" yet — analyze/cleanup stages still run inside
    // runApArrangement (skipRestoration only skips a second restore pass).
    await report("analyzing");
    await patch("analyzing", 50, {
      ap_checkpoint: cp,
      path: "full",
      checkpoint_phase: "arranging",
      message: "Analyzing cleaned vocals…",
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

    await report("polishing");
    await patch("polishing", 56, {
      ap_checkpoint: cp,
      path: "full",
      message: "Loading cleaned vocals…",
      layers: arrangedVocals.length,
    });

    // Keep claim lock alive for the whole arrange (can exceed old 8m stale window)
    const { heartbeatProduceJob } = await import("@/lib/audio/claim-produce-job");
    const workerId =
      typeof (priorOut.worker_id) === "string" ? String(priorOut.worker_id) : "ap-arrange";
    const hb = setInterval(() => {
      void heartbeatProduceJob(jobId, workerId).catch(() => undefined);
    }, 15_000);

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
    const remaining = deadlineAt - Date.now() - 45_000;
    // Use almost the full tick budget — the old 8m hard cap caused permanent
    // "stuck at 68% arranging" loops when choir/many layers needed longer.
    const arrangeBudgetMs = Math.max(90_000, Math.min(18 * 60_000, remaining));
    const arrangeDeadline = Date.now() + arrangeBudgetMs;

    const reportWithProgress = async (
      stage: Parameters<typeof report>[0],
      meta?: Record<string, unknown>
    ) => {
      // CRITICAL: never map "completed" → "arranging" (that was reverting jobs to processing
      // after the engine finished and blocked the UI at the wrong stage).
      if (stage === "completed") {
        // Export/upload still runs after arrangement returns — do not mark job complete here.
        // Advance UI to 98% so it is clear we are finishing, not stuck mid-arrange.
        await patch("quality_check", 98, {
          ap_checkpoint: { ...cp, phase: "arranging" },
          path: "full",
          message: "Exporting your master…",
        }).catch(() => undefined);
        void heartbeatProduceJob(jobId, workerId).catch(() => undefined);
        return;
      }

      await report(stage);
      const prog: Record<string, number> = {
        analyzing: 52,
        restoring: 54,
        polishing: 58,
        producing: 60,
        arranging: 68,
        mixing: 80,
        mastering: 88,
        quality_check: 94,
        completed: 100,
      };
      const stageName = String(stage);
      let p = prog[stageName] ?? 58;
      if (typeof meta?.progressHint === "number" && Number.isFinite(meta.progressHint)) {
        // Never regress (stuck-at-76% was progressHint then a later report clamping lower)
        p = Math.max(p, Math.min(96, Math.round(meta.progressHint as number)));
      }
      const layerMsg =
        typeof meta?.layer === "number" && typeof meta?.of === "number"
          ? `Arranging layer ${meta.layer}/${meta.of}${meta.role ? ` (${meta.role})` : ""}…`
          : meta?.sub === "level_match"
            ? "Balancing vocal levels…"
            : meta?.sub === "vocal_bus"
              ? "Building the vocal bus…"
              : meta?.sub === "blend"
                ? "Blending vocals with the beat…"
                : null;
      await patch(stageName, p, {
        ap_checkpoint: { ...cp, phase: "arranging" },
        path: "full",
        message:
          layerMsg ||
          (stageName === "analyzing"
            ? "Analyzing vocals…"
            : stageName === "restoring"
              ? "Vocal cleanup…"
              : stageName === "polishing"
                ? "Polishing takes…"
                : stageName === "arranging"
                  ? "Arranging vocals on the beat…"
                  : stageName === "mixing"
                    ? "Mixing…"
                    : stageName === "mastering"
                      ? "Mastering…"
                      : stageName === "quality_check"
                        ? "Final quality check…"
                        : String(stage)),
      }).catch(() => undefined);
      void heartbeatProduceJob(jobId, workerId).catch(() => undefined);
    };

    // Arrange+mix+master: prefer fast timeline assembly.
    // Full runApArrangement is CPU-bound and blocks the event loop — Promise.race
    // timeouts never fire, jobs sit at ~76% "Arrange on beat" until the safety reaper.
    // AP_ARRANGE_FULL=1 re-enables the heavy path for debugging.
    const forceFullArrange = String(process.env.AP_ARRANGE_FULL || "").trim() === "1";
    let result: {
      ok: boolean;
      masterPath?: string;
      mixPath?: string;
      mp3Path?: string;
      engineVersion?: string;
      error?: string;
      meta?: Record<string, unknown>;
    };

    try {
      if (!forceFullArrange) {
        console.info("[ap-tick] arrange via runFastArrangement (reliable path)", {
          jobId,
          layers: arrangedVocals.length,
        });
        await reportWithProgress("arranging", { sub: "stack", progressHint: 78 });
        const fast = await runFastArrangement({
          beatPath,
          vocals: arrangedVocals.map((v) => ({
            buffer: v.buffer,
            pathHint: v.pathHint,
            taskType: v.taskType,
            startMs: v.startMs ?? undefined,
            role: v.role,
          })),
          onStage: async (s) => {
            const hint =
              s.includes("mix") || s.includes("blend")
                ? 88
                : s.includes("master")
                  ? 92
                  : 80;
            await reportWithProgress(
              s.includes("master") ? "mastering" : s.includes("mix") ? "mixing" : "arranging",
              { progressHint: hint }
            );
          },
          genre: genre || null,
        });
        if (!fast.wav?.length) throw new Error("Fast arrangement returned empty audio");
        const wavBuf = Buffer.isBuffer(fast.wav) ? fast.wav : Buffer.from(fast.wav as Uint8Array);
        result = {
          ok: true,
          masterWav: wavBuf,
          mixWav: wavBuf,
          engineVersion: "ap-fast",
          meta: { path: "fast_arrange", layerCount: fast.layerCount, durationMs: fast.durationMs },
        };
      } else {
        result = await Promise.race([
          runApArrangement(
            {
              jobId,
              projectId,
              userId,
              beatPath,
              vocals: arrangedVocals,
              genre: genre || null,
              productionDirection: productionDirection || null,
              placementLog,
              skipRestore: true,
              deadlineAt: Math.min(deadlineAt, arrangeDeadline),
            },
            reportWithProgress
          ),
          new Promise<never>((_, rej) => {
            setTimeout(() => rej(new Error("arrange_timeout")), arrangeCapMs);
          }),
        ]);
      }
    } catch (ae) {
      clearInterval(hb);
      const msg = ae instanceof Error ? ae.message : String(ae);
      console.error("[ap-tick] arrange failed/timeout", msg);
      // Fallback: always try fast path once before giving up
      try {
        console.info("[ap-tick] arrange fallback → runFastArrangement", { jobId });
        await reportWithProgress("arranging", { sub: "stack", progressHint: 78 });
        const fast = await runFastArrangement({
          beatPath,
          vocals: arrangedVocals.map((v) => ({
            buffer: v.buffer,
            pathHint: v.pathHint,
            taskType: v.taskType,
            startMs: v.startMs ?? undefined,
            role: v.role,
          })),
          onStage: async (s) => {
            await reportWithProgress(
              s.includes("master") ? "mastering" : s.includes("mix") ? "mixing" : "arranging",
              { progressHint: 85 }
            );
          },
          genre: genre || null,
        });
        if (!fast.wav?.length) throw new Error(msg || "Fast arrangement returned empty audio");
        const wavBuf = Buffer.isBuffer(fast.wav) ? fast.wav : Buffer.from(fast.wav as Uint8Array);
        result = {
          ok: true,
          masterWav: wavBuf,
          mixWav: wavBuf,
          engineVersion: "ap-fast",
          meta: { path: "fast_arrange_fallback", layerCount: fast.layerCount, durationMs: fast.durationMs },
        };
      } catch (fe) {
        const fmsg = fe instanceof Error ? fe.message : String(fe);
        const attempts = Number((cp as { arrangeAttempts?: number }).arrangeAttempts || 0) + 1;
        (cp as { arrangeAttempts?: number }).arrangeAttempts = attempts;
        cp.resumedFrom = "arranging";
        if (attempts < 3) {
          await patch("arranging", 70, {
            ap_checkpoint: cp,
            arrange_timeout: true,
            arrange_attempts: attempts,
            message: "Retrying arrangement…",
          });
          return { complete: false };
        }
        await patch("failed", 100, {
          error: `Arrangement could not finish (${fmsg.slice(0, 200)}). Tap Produce again — your recordings are safe.`,
          ap_checkpoint: cp,
          arrange_timeout: true,
          arrange_attempts: attempts,
        });
        return { complete: false, error: fmsg };
      }
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

    // Explicit export stage so UI is not frozen on mastering while R2 uploads run
    await patch("quality_check", 96, {
      path: "full",
      message: "Exporting master WAV…",
      ap_checkpoint: { ...cp, phase: "arranging" },
    }).catch(() => undefined);
    void heartbeatProduceJob(jobId, workerId).catch(() => undefined);

    try {
      if (!result.mixWav?.length || !result.masterWav?.length) {
        throw new Error("Engine returned empty mix/master buffers — cannot export");
      }
      // Parallel R2 puts — same files, lower wall-clock (network-bound)
      await patch("quality_check", 97, {
        path: "full",
        message: "Uploading master and stems…",
      }).catch(() => undefined);
      const asBuf = (b: unknown): Buffer => {
        if (Buffer.isBuffer(b)) return b;
        if (b instanceof Uint8Array) return Buffer.from(b);
        if (b instanceof ArrayBuffer) return Buffer.from(b);
        throw new Error("export: expected audio Buffer");
      };
      const uploads: Promise<unknown>[] = [
        uploadBuffer(mixPath, asBuf(result.mixWav), "audio/wav"),
        uploadBuffer(masterPath, asBuf(result.masterWav), "audio/wav"),
      ];
      // Optional stems — full engine only; fast arrange omits these
      if (result.processedVocalWav?.length) {
        uploads.push(uploadBuffer(processedVocalPath, asBuf(result.processedVocalWav), "audio/wav"));
      }
      if (result.restoredVocalWav?.length) {
        uploads.push(uploadBuffer(restoredVocalPath, asBuf(result.restoredVocalWav), "audio/wav"));
      }
      if (result.masterMp3?.length) {
        mp3Path = productionMasterPath(userId, projectId, jobId, "mp3");
        uploads.push(uploadBuffer(mp3Path, asBuf(result.masterMp3), "audio/mpeg"));
      }
      await Promise.all(uploads);
    } catch (upErr) {
      const msg = upErr instanceof Error ? upErr.message : String(upErr);
      console.error("[ap-tick] export upload failed", msg);
      await patch("failed", 100, {
        error: `Export failed: ${msg.slice(0, 300)}. Check R2 env on the worker.`,
        path: "full",
        engineVersion,
        ap_checkpoint: cp,
      });
      return { complete: false, error: `Export failed: ${msg}` };
    }

    await patch("quality_check", 99, {
      path: "full",
      message: "Saving your song…",
      master_storage_path: masterPath,
      mix_storage_path: mixPath,
    }).catch(() => undefined);
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

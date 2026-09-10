/**
 * AP Audio Production Engine — Phase 1 entry
 */

import { analyzeBeat } from "./analysis/beat";
import { combineAnalysis } from "./analysis/combine";
import { analyzeVocal } from "./analysis/vocal";
import { normalizeToInternalPcm, placeOnTimeline } from "./ingestion/normalize";
import { validateAudioBuffer } from "./ingestion/validate";
import { decideProduction } from "./production/decision-engine";
import { processVocalChain } from "./production/vocal-chain";
import { restoreVocal } from "./restoration/denoise";
import { stabilizeLevel } from "./restoration/dynamics-fix";
import { mixVocalAndBeat } from "./mix/engine";
import { masterMix } from "./master/engine";
import { runQc } from "./qc/checks";
import { decisionAfterQc, shouldRetry } from "./qc/retry";
import { exportMp3, exportWav } from "./render/export-wav-mp3";
import {
  AP_ENGINE_VERSION,
  type ApProduceFailure,
  type ApProduceInput,
  type ApProduceResult,
  type ApStage,
  type ProductionDecision,
} from "./types";

export * from "./types";
export { resolveGenreProfile, listGenreProfiles } from "./production/genre-profiles";

export type StageReporter = (stage: ApStage, meta?: Record<string, unknown>) => Promise<void> | void;

function logAp(event: string, data: Record<string, unknown>) {
  console.info("[ap-engine]", JSON.stringify({ event, engine: AP_ENGINE_VERSION, ...data }));
}

function renderFromDecision(
  vocalPlaced: ReturnType<typeof placeOnTimeline>["vocal"],
  beatPlaced: ReturnType<typeof placeOnTimeline>["beat"],
  decision: ProductionDecision
) {
  const restored = restoreVocal(vocalPlaced, decision.vocal);
  const stabilized = stabilizeLevel(restored, 0.1);
  const produced = processVocalChain(stabilized, decision.vocal);
  const mix = mixVocalAndBeat(produced, beatPlaced, decision.mix);
  const master = masterMix(mix, decision.master);
  return { restored, produced, mix, master };
}

/**
 * Full Phase 1 pipeline: analysis → decision → DSP → mix → master → QC (+1 retry).
 */
export async function runApProduction(
  input: ApProduceInput,
  report?: StageReporter
): Promise<ApProduceResult | ApProduceFailure> {
  const t0 = Date.now();
  const stage = async (s: ApStage, meta?: Record<string, unknown>) => {
    logAp("stage", { jobId: input.jobId, stage: s, ...meta });
    await report?.(s, meta);
  };

  try {
    await stage("analyzing");
    const vVal = validateAudioBuffer(input.vocalBuffer, input.vocalPathHint);
    const bVal = validateAudioBuffer(input.beatBuffer, input.beatPathHint);
    if (!vVal.ok) {
      return {
        ok: false,
        stage: "analyzing",
        error: "Vocal validation failed",
        detail: vVal.errors.join(","),
        engineVersion: AP_ENGINE_VERSION,
      };
    }
    if (!bVal.ok) {
      return {
        ok: false,
        stage: "analyzing",
        error: "Beat validation failed",
        detail: bVal.errors.join(","),
        engineVersion: AP_ENGINE_VERSION,
      };
    }

    const vocalNorm = await normalizeToInternalPcm(input.vocalBuffer, input.vocalPathHint);
    const beatNorm = await normalizeToInternalPcm(input.beatBuffer, input.beatPathHint);

    const vocalA = analyzeVocal(vocalNorm.pcm);
    const beatA = analyzeBeat(beatNorm.pcm);
    const analysis = combineAnalysis(vocalA, beatA);
    logAp("analysis", {
      jobId: input.jobId,
      vocal: {
        rms: +vocalA.rms.toFixed(4),
        peak: +vocalA.peak.toFixed(4),
        silence: +vocalA.silenceRatio.toFixed(3),
      },
      beat: { rms: +beatA.rms.toFixed(4), peak: +beatA.peak.toFixed(4) },
    });

    let decision = decideProduction(analysis, input.genre);
    logAp("decision", {
      jobId: input.jobId,
      genre: decision.genre,
      notes: decision.notes,
      vocalGainDb: decision.mix.vocalGainDb,
      beatGainDb: decision.mix.beatGainDb,
    });

    const startMs = input.vocalStartMs ?? 0;
    const placed = placeOnTimeline(vocalNorm.pcm, beatNorm.pcm, startMs);

    await stage("restoring");
    await stage("producing");
    await stage("mixing");
    await stage("mastering");

    let rendered = renderFromDecision(placed.vocal, placed.beat, decision);
    await stage("quality_check");
    let qc = runQc(rendered.master, rendered.mix);
    let retryCount = 0;

    if (shouldRetry(qc, retryCount)) {
      retryCount = 1;
      logAp("qc_retry", { jobId: input.jobId, issues: qc.issues });
      decision = decisionAfterQc(decision, qc);
      await stage("mixing", { retry: 1 });
      await stage("mastering", { retry: 1 });
      rendered = renderFromDecision(placed.vocal, placed.beat, decision);
      await stage("quality_check", { retry: 1 });
      qc = runQc(rendered.master, rendered.mix);
    }

    if (!qc.passed) {
      return {
        ok: false,
        stage: "quality_check",
        error: "Production quality check failed",
        detail: qc.issues.join(","),
        engineVersion: AP_ENGINE_VERSION,
      };
    }

    const masterWav = exportWav(rendered.master);
    const mixWav = exportWav(rendered.mix);
    const processedVocalWav = exportWav(rendered.produced);
    const restoredVocalWav = exportWav(rendered.restored);
    const masterMp3 = await exportMp3(rendered.master);

    const durationMs = Date.now() - t0;
    logAp("completed", {
      jobId: input.jobId,
      durationMs,
      masterBytes: masterWav.length,
      mp3: Boolean(masterMp3),
      retryCount,
      qc: qc.metrics,
    });

    await stage("completed");
    return {
      ok: true,
      masterWav,
      masterMp3,
      mixWav,
      processedVocalWav,
      restoredVocalWav,
      decision,
      analysis,
      qc,
      retryCount,
      durationMs,
      engineVersion: AP_ENGINE_VERSION,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logAp("failed", { jobId: input.jobId, error: msg });
    return {
      ok: false,
      stage: "failed",
      error: "Production engine failed",
      detail: msg,
      engineVersion: AP_ENGINE_VERSION,
    };
  }
}

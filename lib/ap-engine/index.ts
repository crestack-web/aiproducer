/**
 * AP Audio Production Engine — multi-role arrangement (Phase 1+)
 */

import { analyzeBeat } from "./analysis/beat";
import { combineAnalysis } from "./analysis/combine";
import { analyzeVocal } from "./analysis/vocal";
import { normalizeToInternalPcm } from "./ingestion/normalize";
import { validateAudioBuffer } from "./ingestion/validate";
import {
  adjustArrangementForRetry,
  adjustDecisionForRetry,
  decideArrangementMix,
  decideLayer,
  decideProduction,
} from "./production/decision-engine";
import { processVocalChain } from "./production/vocal-chain";
import { restoreVocal } from "./restoration/denoise";
import { stabilizeLevel } from "./restoration/dynamics-fix";
import { mixVocalAndBeat } from "./mix/engine";
import { processAndPlaceLayer, sumVocalBus } from "./mix/stack";
import { masterMix } from "./master/engine";
import { runQc } from "./qc/checks";
import { shouldRetry } from "./qc/retry";
import { exportMp3, exportWav } from "./render/export-wav-mp3";
import { resolveVocalRole, resolveSectionKind, type VocalRole } from "./roles";
import {
  AP_ENGINE_VERSION,
  type ApProduceFailure,
  type ApProduceInput,
  type ApProduceResult,
  type ApStage,
  type PcmStereo,
  type ProductionDecision,
  type StageReporter,
} from "./types";
import { cloneStereo } from "./dsp";

export * from "./types";
export { resolveGenreProfile, listGenreProfiles } from "./profiles/genre-profiles";
export { resolveVocalRole, resolveSectionKind, type VocalRole } from "./roles";

export type ApVocalLayerInput = {
  buffer: Buffer;
  pathHint?: string;
  taskType?: string | null;
  sectionLabel?: string | null;
  startMs?: number | null;
};

export type ApArrangementInput = {
  jobId: string;
  projectId: string;
  userId: string;
  beatBuffer: Buffer;
  beatPathHint?: string;
  vocals: ApVocalLayerInput[];
  genre?: string | null;
};

function logAp(event: string, data: Record<string, unknown>) {
  console.info("[ap-engine]", JSON.stringify({ event, engine: AP_ENGINE_VERSION, ...data }));
}

/**
 * Multi-vocal arrangement produce.
 * Lead establishes reference; supporting roles add size/depth/expression.
 */
export async function runApArrangement(
  input: ApArrangementInput,
  report?: StageReporter
): Promise<ApProduceResult | ApProduceFailure> {
  const t0 = Date.now();
  const stage = async (s: ApStage, meta?: Record<string, unknown>) => {
    logAp("stage", { jobId: input.jobId, stage: s, ...meta });
    await report?.(s, meta);
  };

  try {
    await stage("analyzing");
    const bVal = validateAudioBuffer(input.beatBuffer, input.beatPathHint);
    if (!bVal.ok) {
      return {
        ok: false,
        stage: "analyzing",
        error: "Beat validation failed",
        detail: bVal.errors.join(","),
        engineVersion: AP_ENGINE_VERSION,
      };
    }
    if (!input.vocals.length) {
      return {
        ok: false,
        stage: "analyzing",
        error: "No vocal takes provided",
        engineVersion: AP_ENGINE_VERSION,
      };
    }

    const beatNorm = await normalizeToInternalPcm(input.beatBuffer, input.beatPathHint);
    const beatA = analyzeBeat(beatNorm.pcm);

    const normalizedLayers: {
      pcm: PcmStereo;
      role: VocalRole;
      section: ReturnType<typeof resolveSectionKind>;
      startMs: number;
      analysis: ReturnType<typeof analyzeVocal>;
    }[] = [];

    for (const v of input.vocals) {
      const val = validateAudioBuffer(v.buffer, v.pathHint);
      if (!val.ok) continue;
      const norm = await normalizeToInternalPcm(v.buffer, v.pathHint);
      const role = resolveVocalRole(v.taskType, v.sectionLabel);
      const section = resolveSectionKind(v.sectionLabel, v.taskType);
      const analysis = analyzeVocal(norm.pcm);
      normalizedLayers.push({
        pcm: norm.pcm,
        role,
        section,
        startMs: v.startMs ?? 0,
        analysis,
      });
    }

    if (!normalizedLayers.length) {
      return {
        ok: false,
        stage: "analyzing",
        error: "Vocal validation failed",
        engineVersion: AP_ENGINE_VERSION,
      };
    }

    const hasLead = normalizedLayers.some((l) => l.role === "lead");
    const layerCount = normalizedLayers.length;
    const leadAnalysis =
      normalizedLayers.find((l) => l.role === "lead")?.analysis || normalizedLayers[0].analysis;

    logAp("analysis", {
      jobId: input.jobId,
      layers: normalizedLayers.map((l) => ({
        role: l.role,
        section: l.section,
        startMs: l.startMs,
        durationMs: l.analysis.durationMs,
        rms: +l.analysis.rms.toFixed(4),
      })),
      beatRms: +beatA.rms.toFixed(4),
      beatDurationMs: beatA.durationMs,
    });

    // Decisions per layer
    let layerDecisions = normalizedLayers.map((l) =>
      decideLayer(
        {
          role: l.role,
          section: l.section,
          analysis: l.analysis,
          layerCount,
          hasLead,
        },
        input.genre
      )
    );

    let arrMix = decideArrangementMix(leadAnalysis, beatA, input.genre, layerCount);
    logAp("decision", {
      jobId: input.jobId,
      genre: arrMix.notes.find((n) => n.startsWith("genre:")),
      roles: layerDecisions.map((d) => d.role),
      notes: [...arrMix.notes, ...layerDecisions.flatMap((d) => d.notes)].slice(0, 20),
    });

    await stage("restoring");
    await stage("producing");
    await stage("mixing");

    const renderStack = () => {
      const placed: PcmStereo[] = [];
      let leadProcessed: PcmStereo | null = null;
      let restoredLead: PcmStereo | null = null;
      for (let i = 0; i < normalizedLayers.length; i++) {
        const layer = normalizedLayers[i];
        const decision = layerDecisions[i];
        const out = processAndPlaceLayer(beatNorm.pcm, {
          pcm: layer.pcm,
          startMs: layer.startMs,
          decision,
        });
        placed.push(out);
        if (layer.role === "lead" || (!hasLead && i === 0)) {
          // capture lead chain for artifacts
          let v = cloneStereo(layer.pcm);
          restoredLead = restoreVocal(v, decision.vocal);
          leadProcessed = processVocalChain(stabilizeLevel(restoredLead, 0.11), decision.vocal);
        }
      }
      const vocalBus = sumVocalBus(placed);
      const mix = mixVocalAndBeat(vocalBus, beatNorm.pcm, arrMix.mix);
      const master = masterMix(mix, arrMix.master);
      return {
        mix,
        master,
        processedVocal: leadProcessed || placed[0],
        restoredVocal: restoredLead || placed[0],
      };
    };

    await stage("mastering");
    let rendered = renderStack();
    await stage("quality_check");
    let qc = runQc(rendered.master, rendered.mix);
    let retryCount = 0;

    if (shouldRetry(qc, retryCount)) {
      retryCount = 1;
      logAp("qc_retry", { jobId: input.jobId, issues: qc.issues });
      arrMix = {
        mix: adjustDecisionForRetry(
          {
            genre: "ap",
            vocal: layerDecisions[0].vocal,
            mix: arrMix.mix,
            master: arrMix.master,
            notes: arrMix.notes,
          },
          qc.issues
        ).mix,
        master: adjustDecisionForRetry(
          {
            genre: "ap",
            vocal: layerDecisions[0].vocal,
            mix: arrMix.mix,
            master: arrMix.master,
            notes: arrMix.notes,
          },
          qc.issues
        ).master,
        notes: [...arrMix.notes, "retry"],
      };
      // boost lead on retry if quiet
      if (qc.issues.includes("VOCAL_TOO_QUIET")) {
        layerDecisions = layerDecisions.map((d) => {
          if (d.role === "lead") {
            return { ...d, vocal: { ...d.vocal, gainDb: d.vocal.gainDb + 1.5 } };
          }
          return d;
        });
      }
      await stage("mixing", { retry: 1 });
      await stage("mastering", { retry: 1 });
      rendered = renderStack();
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
    const processedVocalWav = exportWav(rendered.processedVocal);
    const restoredVocalWav = exportWav(rendered.restoredVocal);
    const masterMp3 = await exportMp3(rendered.master);

    const durationMs = Date.now() - t0;
    const analysis = combineAnalysis(leadAnalysis, beatA);
    const decision: ProductionDecision = {
      genre: arrMix.notes.find((n) => n.startsWith("genre:"))?.slice(6) || "rnb",
      vocal: layerDecisions.find((d) => d.role === "lead")?.vocal || layerDecisions[0].vocal,
      mix: arrMix.mix,
      master: arrMix.master,
      notes: [
        ...arrMix.notes,
        ...layerDecisions.flatMap((d) => d.notes),
        `roles:${layerDecisions.map((d) => d.role).join("+")}`,
      ],
    };

    logAp("completed", {
      jobId: input.jobId,
      durationMs,
      layerCount,
      roles: layerDecisions.map((d) => d.role),
      masterBytes: masterWav.length,
      mp3: Boolean(masterMp3),
      retryCount,
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

/** Phase 1 single-vocal entry — delegates to arrangement with one layer. */
export async function runApProduction(
  input: ApProduceInput,
  report?: StageReporter
): Promise<ApProduceResult | ApProduceFailure> {
  return runApArrangement(
    {
      jobId: input.jobId,
      projectId: input.projectId,
      userId: input.userId,
      beatBuffer: input.beatBuffer,
      beatPathHint: input.beatPathHint,
      genre: input.genre,
      vocals: [
        {
          buffer: input.vocalBuffer,
          pathHint: input.vocalPathHint,
          taskType: "lead",
          startMs: input.vocalStartMs ?? 0,
        },
      ],
    },
    report
  );
}

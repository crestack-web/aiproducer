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
import { mixVocalAndBeat } from "./mix/engine";
import { processAndPlaceLayerDetailed, sumVocalBus } from "./mix/stack";
import { matchVocalLevelsAcrossSong } from "./mix/level-match";
import { processVocalBus } from "./mix/vocal-bus";
import { masterMix } from "./master/engine";
import { runQc } from "./qc/checks";
import { runTranslationQc, applyTranslationFix } from "./qc/translation";
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
import type { PitchQC } from "./pitch";

export * from "./types";
export { resolveGenreProfile, listGenreProfiles } from "./profiles/genre-profiles";
export { runApTime } from "./timing";
export { extractSongFingerprint, applyFeedbackTag, resolveStyleAxis, styleLabel } from "./master/engine";
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
    await stage("polishing");
    await stage("producing");
    await stage("mixing");

    const renderStack = () => {
      const placed: PcmStereo[] = [];
      let leadProcessed: PcmStereo | null = null;
      let restoredLead: PcmStereo | null = null;
      let leadPolishedRef: PcmStereo | null = null;
      const pitchQcAll: PitchQC[] = [];
      const performanceNotes: string[] = [];

      // Lead first so support layers can time-align to polished lead
      const order = normalizedLayers.map((_, i) => i);
      order.sort((a, b) => {
        const ra = normalizedLayers[a].role === "lead" ? 0 : 1;
        const rb = normalizedLayers[b].role === "lead" ? 0 : 1;
        return ra - rb;
      });

      const placedByIndex: (PcmStereo | null)[] = normalizedLayers.map(() => null);

      for (const i of order) {
        const layer = normalizedLayers[i];
        const decision = layerDecisions[i];
        const detailed = processAndPlaceLayerDetailed(beatNorm.pcm, {
          pcm: layer.pcm,
          startMs: layer.startMs,
          decision,
          genre: input.genre,
          leadReference: leadPolishedRef,
          bpm: beatA?.bpm ?? null,
        });
        placedByIndex[i] = detailed.placed;
        if (detailed.polished) pitchQcAll.push(detailed.polished.qc);

        const pq = detailed.performanceQc;
        if (pq?.mouth?.applied) {
          performanceNotes.push(
            `mouth_l${i}:p=${pq.mouth.plosiveEvents},c=${pq.mouth.clickEvents},b=${pq.mouth.breathEvents}`
          );
        }
        if (pq?.ride?.applied) {
          performanceNotes.push(
            `ride_l${i}:ph=${pq.ride.phrases},boost=${pq.ride.maxBoostDb.toFixed(1)},cut=${pq.ride.maxCutDb.toFixed(1)}`
          );
        }
        if (pq?.deess?.applied) {
          performanceNotes.push(
            `deess_l${i}:sib=${pq.deess.sibilanceRatio.toFixed(2)},duck=${pq.deess.meanDuck.toFixed(2)}`
          );
        }
        if (pq?.room?.applied) {
          performanceNotes.push(
            `room_l${i}:red=${pq.room.reductionDb.toFixed(1)}dB,gate=${pq.room.gatedRatio.toFixed(2)}`
          );
        }

        if (layer.role === "lead" || (!hasLead && i === 0)) {
          restoredLead = detailed.restored;
          leadProcessed = detailed.processed;
          leadPolishedRef = detailed.polished?.applied
            ? detailed.polished.pcm
            : detailed.restored;
        }
      }

      for (let i = 0; i < placedByIndex.length; i++) {
        placed.push(placedByIndex[i]!);
      }

      // Cross-section vocal consistency — match lead active RMS across the song
      const rolesForMatch = normalizedLayers.map((l) => l.role);
      const matched = matchVocalLevelsAcrossSong(placed, rolesForMatch);
      placed.length = 0;
      placed.push(...matched.layers);
      if (matched.notes.length) performanceNotes.push(...matched.notes);

      let vocalBus = sumVocalBus(placed);
      vocalBus = processVocalBus(vocalBus, { glue: 0.5, density: 0.32 });
      const mix = mixVocalAndBeat(vocalBus, beatNorm.pcm, arrMix.mix);
      const master = masterMix(mix, arrMix.master, { genre: input.genre, mood: null, vocalSit: "forward", platform: "both" });
      return {
        mix,
        master,
        processedVocal: leadProcessed || placed[0],
        restoredVocal: restoredLead || placed[0],
        pitchQcAll,
        performanceNotes,
      };
    };

    await stage("mastering");
    let rendered = renderStack();
    // Soft peak safety before QC so phone mixes rarely hard-fail on CLIPPING
    const { safetyLimitMaster } = await import("./qc/checks");
    rendered = {
      ...rendered,
      master: safetyLimitMaster(rendered.master, -1),
    };
    await stage("quality_check");
    let qc = runQc(rendered.master, rendered.mix);
    let retryCount = 0;

    if (shouldRetry(qc, retryCount)) {
      retryCount = 1;
      logAp("qc_retry", { jobId: input.jobId, issues: qc.issues, warnings: qc.warnings });
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
      // boost lead on retry if quiet (legacy issue codes may still appear pre-soft-pass)
      if (
        qc.issues.includes("VOCAL_TOO_QUIET") ||
        qc.warnings.some((w) => w.includes("quiet") || w.includes("low_level"))
      ) {
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
      rendered = {
        ...rendered,
        master: safetyLimitMaster(rendered.master, -1),
      };
      await stage("quality_check", { retry: 1 });
      qc = runQc(rendered.master, rendered.mix);
    }

    // Only fail on truly unusable audio (silence / broken / invalid duration).
    // Level warnings still deliver the song — product > perfectionist QC block.
    if (!qc.passed) {
      logAp("qc_failed_fatal", {
        jobId: input.jobId,
        issues: qc.issues,
        warnings: qc.warnings,
        metrics: qc.metrics,
      });
      return {
        ok: false,
        stage: "quality_check",
        error: "Production quality check failed",
        detail: qc.issues.join(",") || qc.warnings.join(","),
        engineVersion: AP_ENGINE_VERSION,
      };
    }
    if (qc.warnings.length) {
      logAp("qc_passed_with_warnings", {
        jobId: input.jobId,
        warnings: qc.warnings,
        metrics: qc.metrics,
      });
    }

    // Translation QC: phone / mono / quiet — auto presence lift if vocal disappears
    try {
      const tr = runTranslationQc(rendered.master);
      logAp("translation_qc", {
        jobId: input.jobId,
        monoOk: tr.monoOk,
        phoneOk: tr.phoneOk,
        quietOk: tr.quietOk,
        warnings: tr.warnings,
        presenceBoostDb: tr.presenceBoostDb,
      });
      if (tr.presenceBoostDb > 0.3) {
        rendered = {
          ...rendered,
          master: applyTranslationFix(rendered.master, tr.presenceBoostDb),
        };
        logAp("translation_fix", { jobId: input.jobId, boostDb: tr.presenceBoostDb });
      }
      if (tr.warnings.length) {
        // non-fatal — attach to notes via log only
      }
    } catch (e) {
      logAp("translation_qc_error", {
        jobId: input.jobId,
        error: e instanceof Error ? e.message : String(e),
      });
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

    const pitchSummary = (rendered.pitchQcAll || []).map((p) => ({
      corrected: p.notesCorrected,
      maxCents: Math.round(p.maxCorrectionCents),
      fallback: p.usedFallback,
      artifactRisk: Number(p.artifactRisk.toFixed(2)),
    }));

    logAp("completed", {
      jobId: input.jobId,
      durationMs,
      layerCount,
      roles: layerDecisions.map((d) => d.role),
      masterBytes: masterWav.length,
      mp3: Boolean(masterMp3),
      retryCount,
      pitch: pitchSummary,
      performance: rendered.performanceNotes || [],
      notes: [
        ...decision.notes,
        ...pitchSummary.map(
          (p, i) =>
            `pitch_layer${i}:corr=${p.corrected},maxCents=${p.maxCents},fallback=${p.fallback}`
        ),
        ...(rendered.performanceNotes || []),
      ].slice(0, 40),
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

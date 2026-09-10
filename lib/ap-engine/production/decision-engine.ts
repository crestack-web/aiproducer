import type { CombinedAnalysis, ProductionDecision } from "../types";
import { resolveGenreProfile } from "./genre-profiles";
import { gainToDb } from "../dsp";

/**
 * Deterministic AP producer brain (Phase 1).
 * AI decides parameters; DSP executes — no LLM on audio.
 */
export function decideProduction(
  analysis: CombinedAnalysis,
  genre?: string | null
): ProductionDecision {
  const profile = resolveGenreProfile(genre);
  const notes: string[] = [`genre:${profile.id}`];
  const v = analysis.vocal;
  const b = analysis.beat;

  // High-pass from profile + mud
  let highPassHz = profile.highPassHz;
  if (v.bands.low > 0.42) {
    highPassHz = Math.min(120, highPassHz + 15);
    notes.push("muddy_low_end");
  }

  // Gate from noise floor
  let gateThresholdDb = -42;
  if (v.noiseFloor != null) {
    gateThresholdDb = Math.max(-50, Math.min(-28, gainToDb(v.noiseFloor) + 8));
  }
  if (v.silenceRatio > 0.45) notes.push("sparse_vocal");

  // EQ from spectral balance
  const eq = [];
  eq.push({ type: "highpass" as const, freq: highPassHz, q: 0.7 });
  if (v.bands.low > 0.38) {
    eq.push({ type: "lowshelf" as const, freq: 180, gainDb: -2.5, q: 0.7 });
  } else if (profile.warmthDb > 0) {
    eq.push({ type: "lowshelf" as const, freq: 200, gainDb: profile.warmthDb * 0.6, q: 0.7 });
  }
  // Presence
  eq.push({
    type: "peak" as const,
    freq: 2800,
    gainDb: profile.vocalPresenceDb * 0.55,
    q: 1.1,
  });
  if (v.bands.high > 0.4) {
    eq.push({ type: "highshelf" as const, freq: 8000, gainDb: -2, q: 0.7 });
    notes.push("bright_vocal");
  } else {
    eq.push({ type: "highshelf" as const, freq: 9000, gainDb: 1.2, q: 0.7 });
  }

  // Compression from crest
  let ratio = profile.compressionRatio;
  let thresholdDb = -18;
  if (v.crest != null && v.crest > 6) {
    ratio = Math.min(5, ratio + 0.6);
    thresholdDb = -20;
    notes.push("dynamic_vocal");
  } else if (v.crest != null && v.crest < 3.2) {
    ratio = Math.max(2.2, ratio - 0.5);
    thresholdDb = -16;
    notes.push("already_dense");
  }

  let deEsserAmount = 0.25;
  if (v.bands.high > 0.36) deEsserAmount = 0.4;
  let saturation = 0.12;
  if (profile.id === "hiphop") saturation = 0.16;

  // Level: target vocal RMS near -18 dBFS before mix
  const targetRms = 0.12;
  let gainDb = 0;
  if (v.rms > 1e-6) {
    gainDb = gainToDb(targetRms / v.rms);
    gainDb = Math.max(-12, Math.min(18, gainDb));
  }

  // Mix balance from RMS comparison
  const vocalToBeat = v.rms / (b.rms + 1e-9);
  let vocalGainDb = 0;
  let beatGainDb = 0;
  if (vocalToBeat < 0.35) {
    vocalGainDb = 3.5;
    beatGainDb = -1.5;
    notes.push("vocal_quiet_vs_beat");
  } else if (vocalToBeat > 1.4) {
    vocalGainDb = -1.5;
    beatGainDb = 0.5;
    notes.push("vocal_hot_vs_beat");
  } else {
    vocalGainDb = 1.5;
    beatGainDb = -0.5;
  }

  // Masking: if both mid-heavy, cut beat presence
  let beatPresenceCutDb = 0;
  if (v.bands.mid > 0.4 && b.bands.mid > 0.38) {
    beatPresenceCutDb = 2.2;
    notes.push("mid_masking");
  }

  return {
    genre: profile.id,
    vocal: {
      highPassHz,
      gateThresholdDb,
      eq,
      compressor: {
        thresholdDb,
        ratio,
        attackMs: 12,
        releaseMs: 90,
        makeupDb: 2,
      },
      deEsserAmount,
      saturation,
      gainDb,
      reverbSend: profile.reverbSend,
      delaySend: profile.delaySend,
    },
    mix: {
      vocalGainDb,
      beatGainDb,
      vocalPan: 0,
      duckDb: profile.beatDuckDb,
      beatPresenceCutDb,
    },
    master: {
      eq: [
        { type: "highpass", freq: 30, q: 0.7 },
        { type: "highshelf", freq: 10000, gainDb: 0.8, q: 0.7 },
      ],
      compressor: {
        thresholdDb: -12,
        ratio: 1.6,
        attackMs: 25,
        releaseMs: 180,
        makeupDb: 0.5,
      },
      limiterCeilingDb: -1.0,
      targetLufs: profile.targetLufs,
      makeupDb: 1.5,
    },
    notes,
  };
}

/** Adjust decision after QC failure (single retry). */
export function adjustDecisionForRetry(
  decision: ProductionDecision,
  issues: string[]
): ProductionDecision {
  const d = JSON.parse(JSON.stringify(decision)) as ProductionDecision;
  if (issues.includes("VOCAL_TOO_QUIET")) {
    d.mix.vocalGainDb += 3;
    d.mix.beatGainDb -= 1.5;
    d.notes.push("retry_boost_vocal");
  }
  if (issues.includes("VOCAL_TOO_LOUD")) {
    d.mix.vocalGainDb -= 2.5;
    d.notes.push("retry_reduce_vocal");
  }
  if (issues.includes("CLIPPING") || issues.includes("EXCESSIVE_PEAK")) {
    d.master.limiterCeilingDb = -1.5;
    d.master.makeupDb = Math.max(0, d.master.makeupDb - 1);
    d.mix.vocalGainDb -= 1;
    d.mix.beatGainDb -= 1;
    d.notes.push("retry_reduce_peak");
  }
  return d;
}

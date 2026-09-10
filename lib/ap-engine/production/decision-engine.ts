/**
 * AP Producer Decision Engine — role + section + genre aware.
 * AI decides; DSP executes. No LLM on audio bytes.
 */

import { gainToDb } from "../dsp";
import { resolveGenreProfile } from "../profiles/genre-profiles";
import type { VocalRole, SongSectionKind } from "../roles";
import { DEFAULT_ROLE_GAIN_DB } from "../roles";
import type {
  CombinedAnalysis,
  EqBand,
  ProductionDecision,
  VocalAnalysis,
  VocalDecision,
  MixDecision,
  MasterDecision,
} from "../types";

export type LayerContext = {
  role: VocalRole;
  section: SongSectionKind;
  analysis: VocalAnalysis;
  /** Other layers present in project */
  layerCount: number;
  hasLead: boolean;
};

export type LayerDecision = {
  role: VocalRole;
  section: SongSectionKind;
  vocal: VocalDecision;
  /** Stereo width 0–1 applied at mix */
  width: number;
  /** Priority sort key */
  priority: number;
  notes: string[];
};

export type ArrangementDecision = {
  genre: string;
  layers: LayerDecision[];
  mix: MixDecision;
  master: MasterDecision;
  notes: string[];
  layerCount: number;
};

function sectionAdjust(
  section: SongSectionKind,
  profile: ReturnType<typeof resolveGenreProfile>,
  role: VocalRole
): { gainDb: number; widthMul: number; reverbMul: number; delayMul: number } {
  let gainDb = 0;
  let widthMul = 1;
  let reverbMul = 1;
  let delayMul = 1;

  if (section === "verse") {
    gainDb += role === "lead" ? profile.verseIntimacyDb : -0.5;
    widthMul = role === "lead" ? 0.85 : 0.9;
    reverbMul = 0.85;
  } else if (section === "pre_chorus") {
    widthMul = 1.05;
    reverbMul = 1.1;
    gainDb += 0.3;
  } else if (section === "chorus") {
    gainDb += role === "lead" ? profile.chorusEnergyBoostDb * 0.4 : profile.chorusEnergyBoostDb * 0.7;
    widthMul = role === "lead" ? 1 : 1.15;
    reverbMul = 1.15;
  } else if (section === "bridge") {
    reverbMul = 1.2;
    widthMul = 1.1;
  } else if (section === "outro") {
    reverbMul = 1.35;
    delayMul = 1.3;
    if (role !== "lead") gainDb -= 1;
  } else if (section === "intro") {
    reverbMul = 1.25;
    delayMul = 1.2;
  }

  return { gainDb, widthMul, reverbMul, delayMul };
}

export function decideLayer(
  ctx: LayerContext,
  genre?: string | null
): LayerDecision {
  const profile = resolveGenreProfile(genre);
  const treatment = profile.roles[ctx.role];
  const v = ctx.analysis;
  const notes: string[] = [`role:${ctx.role}`, `section:${ctx.section}`];
  const sec = sectionAdjust(ctx.section, profile, ctx.role);

  let highPassHz = 80 + treatment.highPassHzOffset;
  // Support layers: more HPF so they don't fight the lead's body
  if (ctx.role !== "lead") {
    highPassHz += ctx.role === "background" || ctx.role.startsWith("harmony") ? 35 : 20;
  }
  if (v.bands.low > 0.42) {
    highPassHz += 12;
    notes.push("mud_control");
  }

  let gateThresholdDb = -42;
  if (v.noiseFloor != null) {
    gateThresholdDb = Math.max(-52, Math.min(-28, gainToDb(v.noiseFloor) + 8));
  }

  // Preserve identity: less aggressive gate on lead / ballad
  if (ctx.role === "lead" && profile.preserveDynamics > 0.6) {
    gateThresholdDb -= 4;
  }

  const eq: EqBand[] = [{ type: "highpass", freq: highPassHz, q: 0.7 }];
  if (v.bands.low > 0.38 || treatment.warmthDb < 0) {
    eq.push({ type: "lowshelf", freq: 180, gainDb: treatment.warmthDb < 0 ? treatment.warmthDb : -2, q: 0.7 });
  } else if (treatment.warmthDb > 0.3) {
    eq.push({ type: "lowshelf", freq: 200, gainDb: treatment.warmthDb * 0.55, q: 0.7 });
  }

  const presence = treatment.presenceDb * (ctx.role === "lead" ? 1 : ctx.role === "double" ? 0.55 : 0.35);
  eq.push({ type: "peak", freq: ctx.role === "harmony_low" ? 2200 : 2800, gainDb: presence * 0.55, q: 1.1 });

  if (v.bands.high > 0.4 && ctx.role === "lead") {
    eq.push({ type: "highshelf", freq: 8000, gainDb: -1.8, q: 0.7 });
    notes.push("tame_air");
  } else if (ctx.role === "harmony_high" || ctx.role === "adlib") {
    eq.push({ type: "highshelf", freq: 9000, gainDb: 1.0, q: 0.7 });
  }

  let ratio = 3.0 + treatment.compressionRatioBoost;
  let thresholdDb = -18;
  if (profile.preserveDynamics > 0.7 && ctx.role === "lead") {
    ratio = Math.max(2.2, ratio - 0.5);
    thresholdDb = -16;
    notes.push("preserve_dynamics");
  }
  if (v.crest != null && v.crest > 6) {
    ratio = Math.min(5, ratio + 0.5);
    notes.push("dynamic_performance");
  }

  // Level toward role-relative target (lead ~ -18 dBFS RMS proxy)
  const leadTarget = 0.12;
  const roleGain = DEFAULT_ROLE_GAIN_DB[ctx.role] + treatment.gainDbOffset + sec.gainDb;
  let gainDb = roleGain;
  if (v.rms > 1e-6) {
    const toward = gainToDb(leadTarget / v.rms);
    gainDb = Math.max(-14, Math.min(16, toward + roleGain));
  }

  let deEsserAmount = ctx.role === "lead" ? 0.3 : ctx.role === "double" ? 0.22 : 0.15;
  if (v.bands.high > 0.36) deEsserAmount += ctx.role === "lead" ? 0.12 : 0.06;

  let saturation = ctx.role === "lead" ? 0.14 : ctx.role === "adlib" ? 0.16 : 0.06;
  if (profile.id === "hiphop" || profile.id === "trap") saturation += ctx.role === "lead" ? 0.05 : 0.02;

  // Backgrounds: darker, more ambient, never competing presence
  if (ctx.role === "background") {
    notes.push("bg_atmosphere");
  }
  if (ctx.role === "double") {
    notes.push("double_size");
  }
  if (ctx.role.startsWith("harmony")) {
    notes.push("harmony_depth");
  }

  const width = Math.min(0.85, treatment.width * sec.widthMul);
  const reverbSend = Math.min(0.4, treatment.reverb * sec.reverbMul);
  const delaySend = Math.min(0.28, treatment.delay * sec.delayMul);

  // Ad-libs in sparse sections get more delay character
  if (ctx.role === "adlib" && v.silenceRatio > 0.35) {
    notes.push("adlib_space");
  }

  return {
    role: ctx.role,
    section: ctx.section,
    priority: ctx.role === "lead" ? 0 : 1,
    width,
    notes,
    vocal: {
      highPassHz,
      gateThresholdDb,
      eq,
      compressor: {
        thresholdDb,
        ratio,
        attackMs: ctx.role === "lead" ? 12 : 8,
        releaseMs: ctx.role === "lead" ? 90 : 70,
        makeupDb: ctx.role === "lead" ? 2 : 1.5,
      },
      deEsserAmount,
      saturation,
      gainDb,
      reverbSend,
      delaySend,
    },
  };
}

/** Mix-level decision from full arrangement analysis. */
export function decideArrangementMix(
  leadAnalysis: VocalAnalysis | null,
  beatAnalysis: CombinedAnalysis["beat"],
  genre: string | null | undefined,
  layerCount: number
): { mix: MixDecision; master: MasterDecision; notes: string[] } {
  const profile = resolveGenreProfile(genre);
  const notes: string[] = [`genre:${profile.id}`, `layers:${layerCount}`];

  let vocalGainDb = 1.5;
  let beatGainDb = -0.5;
  if (leadAnalysis) {
    const ratio = leadAnalysis.rms / (beatAnalysis.rms + 1e-9);
    if (ratio < 0.35) {
      vocalGainDb = 3.2 * profile.leadForwardness;
      beatGainDb = -1.2 * (1 - profile.beatRespect * 0.3);
      notes.push("vocal_quiet_vs_beat");
    } else if (ratio > 1.4) {
      vocalGainDb = -1.2;
      beatGainDb = 0.4 * profile.beatRespect;
      notes.push("vocal_hot_vs_beat");
    }
  }

  // Dense stacks: slightly lower lead bus so arrangement fits
  if (layerCount >= 4) {
    vocalGainDb -= 0.8;
    notes.push("dense_stack");
  }

  let beatPresenceCutDb = 0;
  if (leadAnalysis && leadAnalysis.bands.mid > 0.4 && beatAnalysis.bands.mid > 0.38) {
    beatPresenceCutDb = 1.8 + (1 - profile.beatRespect);
    notes.push("mid_masking");
  }

  const mix: MixDecision = {
    vocalGainDb,
    beatGainDb,
    vocalPan: 0,
    duckDb: 0.8 + (1 - profile.beatRespect) * 0.8,
    beatPresenceCutDb,
  };

  const master: MasterDecision = {
    eq: [
      { type: "highpass", freq: 30, q: 0.7 },
      { type: "highshelf", freq: 10000, gainDb: profile.leadForwardness > 0.8 ? 1.0 : 0.6, q: 0.7 },
    ],
    compressor: {
      thresholdDb: -12,
      ratio: 1.5 + (1 - profile.preserveDynamics) * 0.4,
      attackMs: 25,
      releaseMs: 180,
      makeupDb: 0.5,
    },
    limiterCeilingDb: -1.0,
    targetLufs: profile.targetLufs,
    makeupDb: 1.2,
  };

  return { mix, master, notes };
}

/** Legacy single-vocal API used by Phase 1 callers. */
export function decideProduction(
  analysis: CombinedAnalysis,
  genre?: string | null
): ProductionDecision {
  const layer = decideLayer(
    {
      role: "lead",
      section: "other",
      analysis: analysis.vocal,
      layerCount: 1,
      hasLead: true,
    },
    genre
  );
  const arr = decideArrangementMix(analysis.vocal, analysis.beat, genre, 1);
  return {
    genre: resolveGenreProfile(genre).id,
    vocal: layer.vocal,
    mix: arr.mix,
    master: arr.master,
    notes: [...layer.notes, ...arr.notes],
  };
}

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

export function adjustArrangementForRetry(
  arr: ArrangementDecision,
  issues: string[]
): ArrangementDecision {
  const d = JSON.parse(JSON.stringify(arr)) as ArrangementDecision;
  if (issues.includes("VOCAL_TOO_QUIET")) {
    d.mix.vocalGainDb += 3;
    d.mix.beatGainDb -= 1.5;
    for (const layer of d.layers) {
      if (layer.role === "lead") layer.vocal.gainDb += 1.5;
    }
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

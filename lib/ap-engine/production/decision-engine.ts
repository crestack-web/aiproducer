/**
 * AP Producer Decision Engine — role + section + genre aware.
 * AI decides; DSP executes. No LLM on audio bytes.
 */

import { gainToDb } from "../dsp";
import { buildBeatMaskBands } from "../mix/masking-lite";
import { resolveGenreProfile } from "../profiles/genre-profiles";
import { applyRnbMixBias } from "../profiles/rnb-production";
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

/**
 * Section-aware space & energy.
 * Verse = intimate/dry · Chorus = wider/wetter · Bridge/outro = atmospheric.
 */
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
    gainDb += role === "lead" ? profile.verseIntimacyDb : -0.6;
    widthMul = role === "lead" ? 0.78 : 0.85;
    reverbMul = 0.55;
    delayMul = 0.5;
  } else if (section === "pre_chorus") {
    widthMul = 1.08;
    reverbMul = 0.95;
    delayMul = 0.9;
    gainDb += 0.4;
  } else if (section === "chorus") {
    gainDb += role === "lead" ? profile.chorusEnergyBoostDb * 0.45 : profile.chorusEnergyBoostDb * 0.75;
    widthMul = role === "lead" ? 1.05 : 1.22;
    reverbMul = 1.35;
    delayMul = 1.15;
  } else if (section === "bridge") {
    reverbMul = 1.4;
    delayMul = 1.2;
    widthMul = 1.15;
    if (role === "lead") gainDb -= 0.3;
  } else if (section === "outro") {
    reverbMul = 1.55;
    delayMul = 1.45;
    widthMul = 1.2;
    if (role !== "lead") gainDb -= 1.2;
  } else if (section === "intro") {
    reverbMul = 1.3;
    delayMul = 1.15;
    widthMul = 1.1;
    if (role === "lead") gainDb -= 0.5;
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

  // Per-voice character EQ (recording-production engineer, not a flat preset)
  const ch = v.character;
  if (ch && ctx.role === "lead") {
    if (ch.mud > 0.35) {
      eq.push({ type: "peak", freq: 180, gainDb: -2.2 * ch.mud, q: 0.85 });
      notes.push("cut_mud");
    }
    if (ch.box > 0.35) {
      eq.push({ type: "peak", freq: 450, gainDb: -2.0 * ch.box, q: 1.0 });
      notes.push("cut_box");
    }
    if (ch.nasal > 0.4) {
      eq.push({ type: "peak", freq: 1100, gainDb: -1.8 * ch.nasal, q: 1.2 });
      notes.push("cut_nasal");
    }
    if (ch.harsh > 0.4) {
      eq.push({ type: "peak", freq: 3500, gainDb: -2.4 * ch.harsh, q: 1.3 });
      notes.push("tame_harsh");
    }
    if (ch.thin > 0.35) {
      eq.push({ type: "lowshelf", freq: 200, gainDb: 1.8 * ch.thin, q: 0.7 });
      notes.push("add_body");
    }
    if (ch.air < 0.15 && ch.harsh < 0.35) {
      eq.push({ type: "highshelf", freq: 11000, gainDb: 1.4, q: 0.7 });
      notes.push("add_air");
    }
    if (ch.presence < 0.25) {
      eq.push({ type: "peak", freq: 2800, gainDb: 1.6, q: 1.0 });
      notes.push("lift_presence");
    }
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
  // Floor a little wet so voice shares space with the beat (anti-freestyle isolation)
  const reverbSend = Math.min(0.42, Math.max(0.08, treatment.reverb * sec.reverbMul));
  const delaySend = Math.min(0.28, Math.max(0.04, treatment.delay * sec.delayMul));

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

  let vocalGainDb = 1.4 * profile.leadForwardness;
  let beatGainDb = -0.4 * profile.beatRespect;
  if (leadAnalysis) {
    const ratio = leadAnalysis.rms / (beatAnalysis.rms + 1e-9);
    if (ratio < 0.4) {
      vocalGainDb = 3.8 * profile.leadForwardness;
      beatGainDb = -1.6 * (1 - profile.beatRespect * 0.25);
      notes.push("vocal_quiet_vs_beat");
    } else if (ratio > 1.3) {
      vocalGainDb = -0.8;
      beatGainDb = 0.5 * profile.beatRespect;
      notes.push("vocal_hot_vs_beat");
    } else {
      // Center the vocal slightly forward for pop/streaming
      vocalGainDb = 1.2 * profile.leadForwardness;
      beatGainDb = -0.3;
      notes.push("vocal_in_pocket");
    }
  }

  if (layerCount >= 4) {
    vocalGainDb -= 0.6;
    notes.push("dense_stack");
  }

  let beatPresenceCutDb = 1.2 + (1 - profile.beatRespect) * 0.8;
  if (leadAnalysis && leadAnalysis.bands.mid > 0.35 && beatAnalysis.bands.mid > 0.32) {
    beatPresenceCutDb = 2.0 + (1 - profile.beatRespect) * 1.1;
    notes.push("mid_masking");
  }

  // Multi-band mask from spectral overlap
  const beatMaskBands = buildBeatMaskBands(leadAnalysis, beatAnalysis, beatPresenceCutDb);
  if (beatMaskBands.length) notes.push(`mask_bands:${beatMaskBands.length}`);

  let mix: MixDecision = {
    vocalGainDb,
    beatGainDb,
    vocalPan: 0,
    duckDb: 1.8 + (1 - profile.beatRespect) * 1.2,
    beatPresenceCutDb,
    beatMaskBands,
    duckMidFocus: 0.8,
  };
  mix = applyRnbMixBias(mix, profile.id);
  if (mix.duckDb >= 2.4) notes.push("rnb_mid_duck");
  if ((mix.beatMaskBands?.length || 0) >= 3) notes.push("rnb_presence_pocket");

  const master: MasterDecision = {
    eq: [
      { type: "highpass", freq: 28, q: 0.7 },
      { type: "peak", freq: 120, gainDb: 0.5, q: 0.8 },
      { type: "peak", freq: 2800, gainDb: -0.4, q: 1.0 }, // slight glue notch
      { type: "highshelf", freq: 10000, gainDb: profile.leadForwardness > 0.8 ? 0.9 : 0.55, q: 0.7 },
      { type: "peak", freq: 180, gainDb: 0.35, q: 0.7 }, // R&B warmth body
    ],
    compressor: {
      thresholdDb: -12,
      ratio: 1.5 + (1 - profile.preserveDynamics) * 0.45,
      attackMs: 28,
      releaseMs: 180,
      makeupDb: 0.5,
    },
    limiterCeilingDb: -1.0,
    targetLufs: profile.targetLufs,
    makeupDb: 0.9,
    truePeakMarginDb: 0.5,
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

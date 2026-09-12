/**
 * AP Mastering Agent
 * Analyze → context-aware process chain → plain-language report.
 * Order: corrective EQ → bus glue → tonal EQ → saturation → limit → safety.
 */
import {
  applyEqStereo,
  applyGainStereo,
  cloneStereo,
  compressStereo,
  dbToGain,
  saturateInPlace,
  applyBiquadInPlace,
} from "../dsp";
import type { MasterDecision, PcmStereo } from "../types";
import { analyzeMasterInput, type MasterAnalysis } from "./analyze";
import { resolveMasterContext, type MasterContext } from "./context";
import { normalizeToStreamingTarget, truePeakLimit } from "./loudness";

export type MasterAgentResult = {
  pcm: PcmStereo;
  before: MasterAnalysis;
  after: MasterAnalysis;
  context: MasterContext;
  steps: string[];
  /** Plain language for the artist */
  summary: string;
};

function correctiveEq(out: PcmStereo, before: MasterAnalysis, ctx: MasterContext): string[] {
  const notes: string[] = [];
  const issues = ctx.knownIssues.map((s) => s.toLowerCase());

  // Mud
  if (before.bands.low > 0.42 || issues.some((i) => i.includes("mud") || i.includes("boomy"))) {
    applyBiquadInPlace(out.left, "peak", 180, out.sampleRate, -1.8, 0.9);
    applyBiquadInPlace(out.right, "peak", 180, out.sampleRate, -1.8, 0.9);
    notes.push("eased low-mid mud");
  }
  // Harsh
  if (before.bands.high > 0.38 || issues.some((i) => i.includes("harsh") || i.includes("bright"))) {
    applyBiquadInPlace(out.left, "peak", 3500, out.sampleRate, -1.6, 1.2);
    applyBiquadInPlace(out.right, "peak", 3500, out.sampleRate, -1.6, 1.2);
    notes.push("softened harsh upper mids");
  }
  // Thin
  if (before.bands.low < 0.22 || issues.some((i) => i.includes("thin"))) {
    applyBiquadInPlace(out.left, "lowshelf", 160, out.sampleRate, 1.4, 0.7);
    applyBiquadInPlace(out.right, "lowshelf", 160, out.sampleRate, 1.4, 0.7);
    notes.push("added low-end body");
  }
  // Vocal forward presence if requested
  if (ctx.vocalSit === "forward") {
    applyBiquadInPlace(out.left, "peak", 2600, out.sampleRate, 1.1, 1.0);
    applyBiquadInPlace(out.right, "peak", 2600, out.sampleRate, 1.1, 1.0);
    notes.push("lifted vocal presence");
  } else {
    applyBiquadInPlace(out.left, "peak", 2600, out.sampleRate, 0.4, 1.0);
    applyBiquadInPlace(out.right, "peak", 2600, out.sampleRate, 0.4, 1.0);
  }
  return notes;
}

function busGlue(out: PcmStereo, ctx: MasterContext, before: MasterAnalysis): string {
  // Low ratio, slower attack for glue — denser if LRA is wide or mood is loud
  let ratio = ctx.mood === "loud" ? 2.2 : ctx.mood === "balanced" ? 1.8 : 1.5;
  let threshold = ctx.mood === "loud" ? -14 : -12;
  if (before.lraProxy > 9) {
    ratio += 0.35;
    threshold -= 1;
  }
  compressStereo(out, {
    thresholdDb: threshold,
    ratio,
    attackMs: ctx.mood === "spacious" ? 35 : 22,
    releaseMs: 160,
    makeupDb: ctx.mood === "loud" ? 1.2 : 0.7,
  });
  return `bus glue (ratio ${ratio.toFixed(1)}, ${ctx.mood})`;
}

function tonalEq(out: PcmStereo, before: MasterAnalysis, ctx: MasterContext): string[] {
  const notes: string[] = [];
  // Reference-ish curve: controlled sub, present mids, smooth air
  applyBiquadInPlace(out.left, "highpass", 28, out.sampleRate, 0, 0.7);
  applyBiquadInPlace(out.right, "highpass", 28, out.sampleRate, 0, 0.7);

  if (before.bands.low < 0.28) {
    applyBiquadInPlace(out.left, "peak", 90, out.sampleRate, 0.8, 0.8);
    applyBiquadInPlace(out.right, "peak", 90, out.sampleRate, 0.8, 0.8);
    notes.push("warmed sub foundation");
  } else if (before.bands.low > 0.4) {
    applyBiquadInPlace(out.left, "peak", 90, out.sampleRate, -0.6, 0.8);
    applyBiquadInPlace(out.right, "peak", 90, out.sampleRate, -0.6, 0.8);
  }

  // Slight air for commercial sheen without harshness
  const air = ctx.mood === "spacious" ? 0.5 : 0.9;
  applyBiquadInPlace(out.left, "highshelf", 11000, out.sampleRate, air, 0.7);
  applyBiquadInPlace(out.right, "highshelf", 11000, out.sampleRate, air, 0.7);
  notes.push("commercial top polish");
  return notes;
}

function saturation(out: PcmStereo, ctx: MasterContext): string {
  const amount = ctx.mood === "loud" ? 0.18 : ctx.mood === "balanced" ? 0.12 : 0.07;
  saturateInPlace(out.left, amount);
  saturateInPlace(out.right, amount);
  return `light harmonic density (${ctx.mood})`;
}

function buildSummary(
  ctx: MasterContext,
  before: MasterAnalysis,
  after: MasterAnalysis,
  steps: string[]
): string {
  const louder = after.integratedDb - before.integratedDb;
  const parts: string[] = [];
  if (louder > 1) parts.push("louder and more competitive");
  else if (louder < -1) parts.push("a bit more controlled in level");
  else parts.push("leveled for streaming");

  if (ctx.mood === "loud") parts.push("denser and more glued");
  if (ctx.vocalSit === "forward") parts.push("vocal kept forward");
  else parts.push("vocal sitting in the pocket");

  if (steps.some((s) => s.includes("mud"))) parts.push("mud cleaned up");
  if (steps.some((s) => s.includes("harsh"))) parts.push("harsh edges softened");

  const delta = `Level ${before.integratedDb.toFixed(1)} → ${after.integratedDb.toFixed(1)} dB (proxy), peak ${after.truePeakDb.toFixed(1)} dBTP.`;
  return `Master is ${parts.join(", ")}. ${delta} Want it louder/quieter, or more/less vocal presence?`;
}

/**
 * Full mastering agent pass on a finished mix.
 */
export function runMasteringAgent(
  mix: PcmStereo,
  decision: MasterDecision,
  opts?: {
    genre?: string | null;
    mood?: string | null;
    vocalSit?: string | null;
    platform?: string | null;
    knownIssues?: string[] | null;
  }
): MasterAgentResult {
  const ctx = resolveMasterContext({
    genre: opts?.genre,
    mood: opts?.mood,
    vocalSit: opts?.vocalSit,
    platform: opts?.platform,
    knownIssues: opts?.knownIssues,
    targetLufsHint: decision.targetLufs,
  });

  // Prefer competitive target from context when decision is quiet/default
  const targetLufs = Math.min(-9.5, Math.max(-14, ctx.targetLufs));
  const ceiling = Math.min(-1.0, decision.limiterCeilingDb ?? -1.0);

  const before = analyzeMasterInput(mix);
  const out = cloneStereo(mix);
  const steps: string[] = [];

  // 1. Corrective EQ
  steps.push(...correctiveEq(out, before, ctx));

  // Apply decision EQ as additional tonal polish if provided
  if (decision.eq?.length) {
    applyEqStereo(out, decision.eq);
    steps.push("profile EQ");
  }

  // 2. Bus glue
  steps.push(busGlue(out, ctx, before));
  if (decision.compressor) {
    // lighter second stage if decision has compressor
    compressStereo(out, {
      ...decision.compressor,
      ratio: Math.min(decision.compressor.ratio, 1.8),
      makeupDb: Math.min(decision.compressor.makeupDb, 0.6),
    });
  }

  // 3. Tonal EQ
  steps.push(...tonalEq(out, before, ctx));

  // 4. Saturation
  steps.push(saturation(out, ctx));

  // Pre-limit makeup
  if (decision.makeupDb && Math.abs(decision.makeupDb) > 0.05) {
    applyGainStereo(out, dbToGain(Math.min(2, decision.makeupDb)));
  }

  // 5. Limiting to target loudness
  const ln = normalizeToStreamingTarget(out, targetLufs, ceiling, 0.35);
  steps.push(
    `limited to ~${targetLufs} LUFS family (${ln.beforeDb.toFixed(1)}→${ln.afterDb.toFixed(1)} dB, ${ln.passes} passes)`
  );

  // 6. Safety
  truePeakLimit(out, ceiling, 0.35);
  const after = analyzeMasterInput(out);

  // Guard: if peak still hot, pull once more
  if (after.truePeakDb > -0.8) {
    truePeakLimit(out, -1.2, 0.2);
  }

  const afterFinal = analyzeMasterInput(out);
  const summary = buildSummary(ctx, before, afterFinal, steps);

  if (typeof console !== "undefined") {
    console.log("[ap-master-agent]", summary);
    console.log("[ap-master-agent] steps:", steps.join(" | "));
  }

  return {
    pcm: out,
    before,
    after: afterFinal,
    context: ctx,
    steps,
    summary,
  };
}

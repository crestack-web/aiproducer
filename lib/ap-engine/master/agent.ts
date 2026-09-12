/**
 * AP Mastering Agent — adaptive per-song intelligence.
 * Song fingerprint + style axis + genre/mood context → process chain → report.
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
import { extractSongFingerprint, type SongFingerprint } from "./song-fingerprint";
import { resolveStyleAxis, styleLabel, type StyleAxis } from "./style-axis";
import { mergeArtistProfile, type ArtistMasterProfile } from "./artist-profile";

export type MasterAgentResult = {
  pcm: PcmStereo;
  before: MasterAnalysis;
  after: MasterAnalysis;
  context: MasterContext;
  fingerprint: SongFingerprint;
  styleAxis: StyleAxis;
  steps: string[];
  summary: string;
};

export type MasterAgentOptions = {
  genre?: string | null;
  mood?: string | null;
  vocalSit?: string | null;
  platform?: string | null;
  knownIssues?: string[] | null;
  style?: number | string | null;
  bpm?: number | null;
  artistProfile?: ArtistMasterProfile | null;
};

function correctiveEq(
  out: PcmStereo,
  before: MasterAnalysis,
  ctx: MasterContext,
  fp: SongFingerprint,
  style: StyleAxis
): string[] {
  const notes: string[] = [];
  const issues = ctx.knownIssues.map((s) => s.toLowerCase());
  const carve = 0.7 + fp.density * 0.6; // denser → more surgical

  if (before.bands.low > 0.4 || issues.some((i) => i.includes("mud"))) {
    const cut = -1.4 * carve - (1 - style) * 0.3;
    applyBiquadInPlace(out.left, "peak", 180, out.sampleRate, cut, 0.9);
    applyBiquadInPlace(out.right, "peak", 180, out.sampleRate, cut, 0.9);
    notes.push("eased low-mid mud");
  }
  // Powerful/bright voice → stronger de-ess region; soft voice → gentler
  const harshCut =
    -1.2 * (0.6 + fp.vocalTimbre.brightness * 0.8) * (style > 0.5 ? 1 : 0.7);
  if (before.bands.high > 0.36 || fp.vocalTimbre.brightness > 0.65 || issues.some((i) => i.includes("harsh"))) {
    applyBiquadInPlace(out.left, "peak", 3500, out.sampleRate, harshCut, 1.2);
    applyBiquadInPlace(out.right, "peak", 3500, out.sampleRate, harshCut, 1.2);
    notes.push("softened harsh upper mids");
  }
  if (before.bands.low < 0.22 || fp.vocalTimbre.brightness > 0.7 || issues.some((i) => i.includes("thin"))) {
    applyBiquadInPlace(out.left, "lowshelf", 160, out.sampleRate, 1.2 + (1 - style) * 0.4, 0.7);
    applyBiquadInPlace(out.right, "lowshelf", 160, out.sampleRate, 1.2 + (1 - style) * 0.4, 0.7);
    notes.push("added low-end body");
  }
  // Presence: forward + polished more; raw keeps texture
  // Vocal clarity / "crisp" without harshness
  const presence =
    (ctx.vocalSit === "forward" ? 1.35 : 0.55) * (0.75 + style * 0.55) *
    (fp.vocalTimbre.harmonicity > 0.4 ? 1 : 0.9);
  // Presence (intelligibility) + gentle air (crisp, not harsh)
  applyBiquadInPlace(out.left, "peak", 3000, out.sampleRate, presence, 1.05);
  applyBiquadInPlace(out.right, "peak", 3000, out.sampleRate, presence, 1.05);
  applyBiquadInPlace(out.left, "peak", 5200, out.sampleRate, presence * 0.45, 1.2);
  applyBiquadInPlace(out.right, "peak", 5200, out.sampleRate, presence * 0.45, 1.2);
  const air = 0.55 + style * 0.45;
  applyBiquadInPlace(out.left, "highshelf", 10000, out.sampleRate, air, 0.7);
  applyBiquadInPlace(out.right, "highshelf", 10000, out.sampleRate, air, 0.7);
  if (presence > 0.4) notes.push("lifted vocal presence + air");
  return notes;
}

function busGlue(
  out: PcmStereo,
  ctx: MasterContext,
  fp: SongFingerprint,
  style: StyleAxis
): string {
  // Tempo-scaled attack/release
  const bpm = fp.bpm || 96;
  const beatMs = 60000 / bpm;
  const attackMs = Math.max(12, Math.min(40, beatMs * (style < 0.4 ? 0.08 : 0.05)));
  const releaseMs = Math.max(80, Math.min(280, beatMs * 0.35));

  // Glue amount from style + existing dynamics
  let ratio = 1.4 + style * 1.0;
  if (fp.currentLra > 9) ratio += 0.35;
  if (fp.currentLra < 5) ratio -= 0.25;
  if (fp.density > 0.7) ratio += 0.2;
  ratio = Math.max(1.3, Math.min(2.6, ratio));

  const threshold = -11 - style * 4 - (fp.density > 0.65 ? 1 : 0);
  const makeup = 0.4 + style * 1.0;

  compressStereo(out, {
    thresholdDb: threshold,
    ratio,
    attackMs,
    releaseMs,
    makeupDb: makeup,
  });
  return `bus glue style=${styleLabel(style)} ratio=${ratio.toFixed(1)} atk=${attackMs.toFixed(0)}ms`;
}

function tonalEq(out: PcmStereo, before: MasterAnalysis, style: StyleAxis): string[] {
  const notes: string[] = [];
  applyBiquadInPlace(out.left, "highpass", 28, out.sampleRate, 0, 0.7);
  applyBiquadInPlace(out.right, "highpass", 28, out.sampleRate, 0, 0.7);
  if (before.bands.low < 0.28) {
    applyBiquadInPlace(out.left, "peak", 90, out.sampleRate, 0.7, 0.8);
    applyBiquadInPlace(out.right, "peak", 90, out.sampleRate, 0.7, 0.8);
    notes.push("warmed sub");
  }
  const air = 0.25 + style * 0.75;
  applyBiquadInPlace(out.left, "highshelf", 11000, out.sampleRate, air, 0.7);
  applyBiquadInPlace(out.right, "highshelf", 11000, out.sampleRate, air, 0.7);
  notes.push(style > 0.6 ? "commercial air" : "natural top");
  return notes;
}

function saturation(out: PcmStereo, style: StyleAxis, density: number): string {
  const amount = 0.04 + style * 0.16 + density * 0.04;
  saturateInPlace(out.left, amount);
  saturateInPlace(out.right, amount);
  return `saturation ${amount.toFixed(2)} (${styleLabel(style)})`;
}

function targetFromStyle(ctx: MasterContext, style: StyleAxis, loudnessBiasDb: number): number {
  // Competitive commercial loudness (RMS proxy). Raw stays more dynamic.
  // ~-11.5 raw → ~-9 polished so masters don't feel quiet vs streaming refs.
  const base = -11.5 + style * 2.8;
  let t = base;
  if (ctx.mood === "loud") t = Math.max(t, -10.5);
  if (ctx.mood === "spacious") t = Math.min(t, -12.5);
  t += loudnessBiasDb;
  return Math.min(-9.5, Math.max(-14.5, t));
}

function buildSummary(
  ctx: MasterContext,
  before: MasterAnalysis,
  after: MasterAnalysis,
  fp: SongFingerprint,
  style: StyleAxis,
  steps: string[]
): string {
  const parts: string[] = [];
  parts.push(styleLabel(style));
  if (after.integratedDb - before.integratedDb > 1.5) parts.push("louder");
  if (style > 0.6) parts.push("denser glue");
  else parts.push("more open dynamics");
  if (fp.vocalTimbre.brightness > 0.65) parts.push("tamed bright vocal");
  if (steps.some((s) => s.includes("mud"))) parts.push("cleared mud");

  return (
    `Master is ${parts.join(", ")}. ` +
    `Level ${before.integratedDb.toFixed(1)}→${after.integratedDb.toFixed(1)} dB, ` +
    `peak ${after.truePeakDb.toFixed(1)} dBTP, ` +
    `density ${fp.density.toFixed(2)}, style ${style.toFixed(2)}. ` +
    `Want it louder/quieter, or more raw vs polished?`
  );
}

export function runMasteringAgent(
  mix: PcmStereo,
  decision: MasterDecision,
  opts?: MasterAgentOptions
): MasterAgentResult {
  const before = analyzeMasterInput(mix);
  const fp = extractSongFingerprint(mix, opts?.bpm ?? null);
  const artist = mergeArtistProfile(opts?.artistProfile, fp.vocalTimbre.brightness);

  let style = resolveStyleAxis({
    explicit: opts?.style,
    mood: opts?.mood,
    fingerprintLra: fp.currentLra,
    fingerprintDensity: fp.density,
  });
  style = Math.max(0, Math.min(1, style + artist.styleBias));

  const ctx = resolveMasterContext({
    genre: opts?.genre,
    mood: opts?.mood,
    vocalSit: opts?.vocalSit,
    platform: opts?.platform,
    knownIssues: opts?.knownIssues,
    targetLufsHint: decision.targetLufs,
  });

  const targetLufs = targetFromStyle(ctx, style, artist.loudnessBiasDb);
  const ceiling = Math.min(-1.0, decision.limiterCeilingDb ?? -1.0);

  const out = cloneStereo(mix);
  const steps: string[] = [
    `fingerprint density=${fp.density.toFixed(2)} lra=${fp.currentLra.toFixed(1)} bpm=${fp.bpm?.toFixed(0) ?? "?"}`,
    `style=${styleLabel(style)} (${style.toFixed(2)}) conf=${artist.confidence.toFixed(2)}`,
  ];

  steps.push(...correctiveEq(out, before, ctx, fp, style));
  if (decision.eq?.length) {
    applyEqStereo(out, decision.eq);
    steps.push("profile EQ");
  }
  steps.push(busGlue(out, ctx, fp, style));
  steps.push(...tonalEq(out, before, style));
  steps.push(saturation(out, style, fp.density));

  if (decision.makeupDb && Math.abs(decision.makeupDb) > 0.05) {
    applyGainStereo(out, dbToGain(Math.min(1.5, decision.makeupDb * (0.5 + style * 0.5))));
  }

  const ln = normalizeToStreamingTarget(out, targetLufs, ceiling, 0.35);
  steps.push(
    `limit ~${targetLufs.toFixed(1)} (${ln.beforeDb.toFixed(1)}→${ln.afterDb.toFixed(1)}, ${ln.passes}p)`
  );
  truePeakLimit(out, ceiling, 0.35);

  let after = analyzeMasterInput(out);
  if (after.truePeakDb > -0.8) {
    truePeakLimit(out, -1.2, 0.2);
    after = analyzeMasterInput(out);
  }

  const summary = buildSummary(ctx, before, after, fp, style, steps);
  if (typeof console !== "undefined") {
    console.log("[ap-master-agent]", summary);
    console.log("[ap-master-agent]", steps.join(" | "));
  }

  return { pcm: out, before, after, context: ctx, fingerprint: fp, styleAxis: style, steps, summary };
}

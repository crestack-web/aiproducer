/**
 * Fast produce path (STOPGAP) — timeline assembly + light polish for Vercel time limits.
 *
 * WHY THIS EXISTS (git: f0915f2): full runApArrangement timed out / stalled on Vercel,
 * so Produce was switched to this path by default. Full engine remains via AP_FULL_ENGINE=1.
 *
 * This file is intentionally a temporary quality floor, not the long-term mixer:
 * - Mild musical duck (not rectangular -10 dB gates)
 * - Light HPF + soft gate before any gain boost (noise not scaled up raw)
 * - Conservatively staged gain so peaks stay under 1.0 into the mix bus
 *
 * engineVersion / meta path: "ap-fast-stopgap-2"
 */
import { downloadStorageOrUrl } from "@/lib/audio/roex-assets";
import {
  encodeStereoWav,
  cloneStereo,
  dbToGain,
  applyGainStereo,
  peakOf,
  rmsOf,
  limitStereo,
  compressStereo,
  applyEqStereo,
  highPassInPlace,
  gateInPlace,
} from "@/lib/ap-engine/dsp";
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import type { PcmStereo } from "@/lib/ap-engine/types";
import {
  normalizeToStreamingTarget,
  truePeakLimit,
  estimateLoudnessProxyDb,
} from "@/lib/ap-engine/master/loudness";
import { runMasteringAgent } from "@/lib/ap-engine/master/agent";
import {
  applyConsoleFxWithAutomation,
  applyConsoleTrackFx as applyConsoleTrackFxShared,
  type ConsoleTrackFx,
} from "@/lib/audio/console-fx-offline";
import { resolveMasterContext } from "@/lib/ap-engine/master/context";
import { resolveVibeDeltas, applyVibeSectionRide } from "@/lib/ap-engine/vibe";
import type { MasterDecision } from "@/lib/ap-engine/types";
import { analyzePerformance, decideVocalSpace, applyVocalSpace } from "@/lib/ap-engine/space";
import {
  buildArrangementPlan,
  applySectionAutomation,
  type ArrangementPlan,
} from "@/lib/ap-engine/arrangement";
import { resolveGenreProfile } from "@/lib/ap-engine/profiles/genre-profiles";
import {
  resolveVocalRole,
  DEFAULT_ROLE_GAIN_DB,
  DEFAULT_ROLE_WIDTH,
  DEFAULT_ROLE_PAN,
  type VocalRole,
} from "@/lib/ap-engine/roles";
import { applyWidth } from "@/lib/ap-engine/mix/width";
import { polishVocalLayer } from "@/lib/ap-engine/pitch";
import {
  parseFxAutomation,
  type FxAutomationDoc,
} from "@/lib/ap-engine/fx-automation";

export type FastTrackFx = {
  gainDb?: number;
  pan?: number;
  eqLowDb?: number;
  eqMidDb?: number;
  eqHighDb?: number;
  compress?: number;
  reverb?: number;
  delay?: number;
  saturation?: number;
  width?: number;
  air?: number;
  rotorMix?: number;
  rotorSpeed?: number;
  rotorDepth?: number;
  rotorWarmth?: number;
  rotorFast?: number;
  springMix?: number;
  springDelay?: number;
  springTension?: number;
  springDamp?: number;
  springMod?: number;
  deEss?: number;
  gate?: number;
  noiseReduce?: number;
  phraseCleanup?: number;
  voiceChanger?: number;
  voicePitchSemis?: number;
  voiceCharacter?: number;
  highPassHz?: number;
  lowPassHz?: number;
  limiter?: number;
  chorus?: number;
  telephone?: number;
  doubler?: number;
  slapDelay?: number;
  plateReverb?: number;
};

/** Apply Console Track FX on top of role processing (matches producer-view intent). */

/** Offline automation: re-apply key params in ~50ms blocks along the timeline. */
/** @deprecated use applyConsoleFxWithAutomation — kept for any residual refs */
function applyConsoleTrackFx(pcm: PcmStereo, fx: FastTrackFx | null | undefined): void {
  applyConsoleTrackFxShared(pcm, fx as ConsoleTrackFx | null);
}

export type FastVocalLayer = {
  buffer?: Buffer;
  audio_path?: string;
  pathHint?: string;
  startMs?: number | null;
  type?: string | null;
  taskType?: string | null;
  role?: string | null;
  taskId?: string;
  sectionLabel?: string | null;
  /** Console Track FX — affects produced master, not only live preview */
  trackFx?: FastTrackFx | null;
};

/** Fast path engine id — bump when mix/master separation or loudness changes. */
export const FAST_ENGINE_VERSION = "ap-fast-space-10-console-fx";

/**
 * Post level-match fader from role hierarchy (linear).
 * Lead is vocal-forward; support roles sit clearly under.
 */
function roleGainLinear(role: VocalRole): number {
  const db = DEFAULT_ROLE_GAIN_DB[role] ?? 0;
  // Lead gets a commercial push on top of 0 dB relative target
  const leadPush = role === "lead" ? 1.32 : role === "intro" || role === "outro" ? 1.12 : 1.0;
  return Math.pow(10, db / 20) * leadPush;
}

/** Resolve role from any of the layer's type fields + title/section. */
function layerRole(v: FastVocalLayer): VocalRole {
  const raw = v.taskType || v.type || v.role || "";
  const label = v.sectionLabel || null;
  // Stack/choir layers: titles like "Choir center" / generated_by metadata path
  const blob = `${raw} ${label || ""} ${v.pathHint || ""}`.toLowerCase();
  if (
    /choir|ooh|ahh|bgv|backing|stack|pad/.test(blob) &&
    !/lead|main|melody/.test(blob)
  ) {
    return "background";
  }
  return resolveVocalRole(raw, label);
}

/**
 * Role-specific EQ — lead present/forward; doubles body; harmonies softer top;
 * backgrounds darker/wider; adlibs bright and short-feel.
 */
function applyRoleEq(pcm: PcmStereo, role: VocalRole): void {
  switch (role) {
    case "lead":
      applyEqStereo(pcm, [
        { type: "highpass", freq: 80, q: 0.7 },
        { type: "peak", freq: 220, gainDb: -1.2, q: 0.9 },
        { type: "peak", freq: 3200, gainDb: 2.2, q: 1.0 },
        { type: "highshelf", freq: 10000, gainDb: 1.2, q: 0.7 },
      ]);
      break;
    case "double":
      applyEqStereo(pcm, [
        { type: "highpass", freq: 100, q: 0.7 },
        { type: "peak", freq: 280, gainDb: -0.8, q: 0.9 },
        { type: "peak", freq: 2500, gainDb: 0.8, q: 1.0 },
        { type: "highshelf", freq: 9000, gainDb: -0.5, q: 0.7 },
      ]);
      break;
    case "harmony_high":
      applyEqStereo(pcm, [
        { type: "highpass", freq: 135, q: 0.7 },
        { type: "peak", freq: 400, gainDb: -1.5, q: 0.8 },
        { type: "peak", freq: 4500, gainDb: 0.5, q: 1.1 },
        { type: "highshelf", freq: 9000, gainDb: -0.4, q: 0.7 },
      ]);
      break;
    case "harmony_mid":
    case "harmony_low":
      applyEqStereo(pcm, [
        { type: "highpass", freq: 125, q: 0.7 },
        { type: "peak", freq: 350, gainDb: -1.2, q: 0.85 },
        { type: "peak", freq: 2800, gainDb: 0.2, q: 1.0 },
        { type: "highshelf", freq: 8000, gainDb: -1.5, q: 0.7 },
      ]);
      break;
    case "adlib":
      applyEqStereo(pcm, [
        { type: "highpass", freq: 110, q: 0.7 },
        { type: "peak", freq: 3800, gainDb: 1.8, q: 1.1 },
        { type: "highshelf", freq: 10000, gainDb: 1.0, q: 0.7 },
      ]);
      break;
    case "background":
      // Choir protect: HPF 150 Hz, cut presence band, soft/flat air (warm not fizzy)
      applyEqStereo(pcm, [
        { type: "highpass", freq: 150, q: 0.7 },
        { type: "peak", freq: 500, gainDb: -2.2, q: 0.8 },
        { type: "peak", freq: 2200, gainDb: -1.2, q: 1.0 },
        { type: "highshelf", freq: 7500, gainDb: -2.8, q: 0.7 },
      ]);
      break;
    case "intro":
    case "outro":
      applyEqStereo(pcm, [
        { type: "highpass", freq: 90, q: 0.7 },
        { type: "peak", freq: 3000, gainDb: 1.0, q: 1.0 },
        { type: "highshelf", freq: 9000, gainDb: 0.5, q: 0.7 },
      ]);
      break;
    default:
      applyEqStereo(pcm, [
        { type: "highpass", freq: 80, q: 0.7 },
        { type: "peak", freq: 3000, gainDb: 1.2, q: 1.0 },
      ]);
  }
}

/**
 * Role-specific dynamics — Choir & Harmony Protection Policy:
 * support/harmony bus uses 1.5–2:1 with slow attack (40–60 ms) so stacks
 * keep natural ebb/flow instead of pumping or sounding robotic.
 */
function applyRoleDynamics(pcm: PcmStereo, role: VocalRole): void {
  switch (role) {
    case "lead":
      compressStereo(pcm, {
        thresholdDb: -16,
        ratio: 3.2,
        attackMs: 10,
        releaseMs: 90,
        makeupDb: 2.8,
      });
      break;
    case "double":
      compressStereo(pcm, {
        thresholdDb: -18,
        ratio: 2.2,
        attackMs: 28,
        releaseMs: 120,
        makeupDb: 1.2,
      });
      break;
    case "harmony_high":
    case "harmony_mid":
    case "harmony_low":
      compressStereo(pcm, {
        thresholdDb: -20,
        ratio: 1.8,
        attackMs: 48,
        releaseMs: 160,
        makeupDb: 0.7,
      });
      break;
    case "adlib":
      compressStereo(pcm, {
        thresholdDb: -18,
        ratio: 2.4,
        attackMs: 12,
        releaseMs: 90,
        makeupDb: 1.5,
      });
      break;
    case "background":
      // Ultra-gentle glue (1.35:1, 60 ms+) — natural swells breathe, no pump
      compressStereo(pcm, {
        thresholdDb: -24,
        ratio: 1.35,
        attackMs: 60,
        releaseMs: 220,
        makeupDb: 0.25,
      });
      break;
    default:
      compressStereo(pcm, {
        thresholdDb: -18,
        ratio: 2.2,
        attackMs: 20,
        releaseMs: 110,
        makeupDb: 1.2,
      });
  }
}

function mixOnto(
  master: PcmStereo,
  layer: PcmStereo,
  startSample: number,
  gain: number
): void {
  const n = layer.left.length;
  for (let i = 0; i < n; i++) {
    const j = startSample + i;
    if (j < 0 || j >= master.left.length) continue;
    master.left[j] = (master.left[j] || 0) + (layer.left[i] || 0) * gain;
    master.right[j] = (master.right[j] || 0) + (layer.right[i] || 0) * gain;
  }
}

/**
 * Envelope-follow duck: reduce beat only where vocal energy is present.
 * Depth ~3–4 dB (amount 0.68), attack/release ~300 ms — not a rectangular gate.
 */
function duckBeatUnderVocalEnvelope(
  mix: PcmStereo,
  vocal: PcmStereo,
  startSample: number,
  depthLinear = 0.68,
  attackMs = 300,
  releaseMs = 350
): void {
  const sr = mix.sampleRate;
  const attack = Math.max(1, Math.floor((attackMs / 1000) * sr));
  const release = Math.max(1, Math.floor((releaseMs / 1000) * sr));
  const n = vocal.left.length;
  let noise = 0;
  const probe = Math.min(n, Math.floor(sr * 0.15));
  for (let i = 0; i < probe; i++) {
    const a = Math.abs(vocal.left[i] || 0);
    const b = Math.abs(vocal.right[i] || 0);
    noise += a + b;
  }
  noise = (noise / Math.max(1, probe * 2)) * 3 + 0.008;

  let env = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(Math.abs(vocal.left[i] || 0), Math.abs(vocal.right[i] || 0));
    const target = v > noise ? 1 : 0;
    const coeff = target > env ? 1 / attack : 1 / release;
    env += (target - env) * Math.min(1, coeff * 8);
    if (env < 0) env = 0;
    if (env > 1) env = 1;
    const g = 1 - env * (1 - depthLinear);
    const j = startSample + i;
    if (j < 0 || j >= mix.left.length) continue;
    mix.left[j] *= g;
    mix.right[j] *= g;
  }
}

/**
 * Role-aware level-match vs beat RMS.
 * Lead sits above the beat; support roles target lower ratios so they don't compete.
 */
function levelMatchToBeat(vocal: PcmStereo, beatRms: number, role: VocalRole): void {
  const vRms = Math.max(rmsOf(vocal.left), rmsOf(vocal.right), 1e-8);
  // Lead sits above the beat. Support — especially Stack choir — must stay a quiet bed.
  // Never pull background/harmony up toward lead energy (that made Console-good stacks
  // attack the lead after Produce).
  const targetRatio =
    role === "lead"
      ? 1.65
      : role === "intro" || role === "outro"
        ? 1.2
        : role === "double"
          ? 0.72
          : role === "adlib"
            ? 0.65
            : role.startsWith("harmony")
              ? 0.32
              : role === "background"
                ? 0.18
                : 0.55;
  const floor =
    role === "lead"
      ? 0.045
      : role === "background"
        ? 0.008
        : role.startsWith("harmony")
          ? 0.012
          : 0.02;
  const target = Math.max(beatRms * targetRatio, floor);
  let g = target / vRms;
  const maxG =
    role === "lead"
      ? 5.5
      : role === "background"
        ? 1.15
        : role.startsWith("harmony")
          ? 1.35
          : role === "double"
            ? 2.0
            : 2.4;
  const minG =
    role === "background" || role.startsWith("harmony") ? 0.25 : 0.45;
  g = Math.min(maxG, Math.max(minG, g));
  applyGainStereo(vocal, g);
  const pk = Math.max(peakOf(vocal.left), peakOf(vocal.right), 1e-6);
  const peakCap =
    role === "lead"
      ? 0.92
      : role === "background"
        ? 0.42
        : role.startsWith("harmony")
          ? 0.55
          : 0.78;
  if (pk > peakCap) applyGainStereo(vocal, peakCap / pk);
}

/** Light noise floor control before any boost stack. */
function lightCleanVocal(pcm: PcmStereo): void {
  highPassInPlace(pcm.left, pcm.sampleRate, 80);
  highPassInPlace(pcm.right, pcm.sampleRate, 80);
  gateInPlace(pcm.left, pcm.sampleRate, -42);
  gateInPlace(pcm.right, pcm.sampleRate, -42);
}

/** Ensure peak * fader stays under headroom before summing into the beat. */
function headroomForFader(pcm: PcmStereo, fader: number, maxIntoBus = 0.95): void {
  const pk = Math.max(peakOf(pcm.left), peakOf(pcm.right), 1e-6);
  const into = pk * fader;
  if (into > maxIntoBus) {
    applyGainStereo(pcm, maxIntoBus / into);
  }
}

function asNodeBuffer(data: unknown): Buffer | null {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data.length > 0 ? data : null;
  if (data instanceof Uint8Array) return data.length > 0 ? Buffer.from(data) : null;
  if (ArrayBuffer.isView(data as ArrayBufferView)) {
    const view = data as ArrayBufferView;
    if (view.byteLength <= 0) return null;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

async function loadVocalBuffer(v: FastVocalLayer): Promise<{ raw: Buffer; hint: string }> {
  const fromBuf = asNodeBuffer(v.buffer);
  if (fromBuf) {
    const hint = String(v.pathHint || v.audio_path || "vocal.wav").split("#")[0];
    return { raw: fromBuf, hint };
  }
  const path = (v.audio_path || v.pathHint || "").split("#")[0];
  if (!path) throw new Error("Vocal layer missing buffer and audio_path");
  const raw = await downloadStorageOrUrl(path);
  return { raw, hint: path };
}

export async function runFastArrangement(opts: {
  beatPath: string;
  vocals: FastVocalLayer[];
  onStage?: (stage: string) => Promise<void>;
  genre?: string | null;
  bpm?: number | null;
  productionDirection?: import("../direction/types").ProductionDirection | null;
  /** Project-level FX automation (metadata.fx_automation) */
  fxAutomation?: FxAutomationDoc | null;
}): Promise<{
  /** @deprecated same as masterWav — kept for older callers */
  wav: Buffer;
  mixWav: Buffer;
  masterWav: Buffer;
  layerCount: number;
  durationMs: number;
  path: "fast-space" | "fast-stopgap";
  diagnostics: Record<string, unknown>;
  engineVersion: string;
}> {
  const report = opts.onStage || (async () => undefined);

  await report("analyzing");

  const beatRaw = await downloadStorageOrUrl(opts.beatPath);
  const beatNorm = await normalizeToInternalPcm(beatRaw, opts.beatPath);
  let beat: PcmStereo = {
    left: new Float32Array(beatNorm.pcm.left),
    right: new Float32Array(beatNorm.pcm.right),
    sampleRate: beatNorm.pcm.sampleRate,
  };
  if (beat.left.length < beat.sampleRate * 2) {
    throw new Error("Beat is too short or failed to decode");
  }

  const beatRms = Math.max(rmsOf(beat.left), rmsOf(beat.right), 1e-6);
  const vibeDeltas = resolveVibeDeltas(opts.productionDirection || null);
  const beatPeak = Math.max(peakOf(beat.left), peakOf(beat.right));
  const sampleRate = beat.sampleRate;
  let totalSamples = beat.left.length;
  // Leave room for vocal-forward balance; beat still present but not masking lead.
  const beatGain = 0.78;
  let duckDb = 5.0;
  let spaceCharacter: string | null = null;
  let spaceNotes: string[] = [];


  await report("processing_vocals");
  const layers: {
    pcm: PcmStereo;
    startMs: number;
    gain: number;
    type: string;
    role: VocalRole;
    pan: number;
    duckDb?: number;
  }[] = [];
  const skipReasons: string[] = [];
  const layerDiag: Record<string, unknown>[] = [];

  for (const v of opts.vocals) {
    const label = v.taskId || v.sectionLabel || v.pathHint || v.audio_path || "layer";
    try {
      const { raw, hint } = await loadVocalBuffer(v);
      const vocalNorm = await normalizeToInternalPcm(raw, hint);
      const pcm: PcmStereo = {
        left: new Float32Array(vocalNorm.pcm.left),
        right: new Float32Array(vocalNorm.pcm.right),
        sampleRate: vocalNorm.pcm.sampleRate,
      };

      // Canonical role from task type + title/section (uploaded tracks included)
      const role = layerRole(v);
      const type = role; // keep string field for diagnostics / arrangement

      lightCleanVocal(pcm);
      // Choir / background: tighter gate so room noise isn't amplified into the master
      if (role === "background" || role.startsWith("harmony")) {
        gateInPlace(pcm.left, pcm.sampleRate, -38);
        gateInPlace(pcm.right, pcm.sampleRate, -38);
        highPassInPlace(pcm.left, pcm.sampleRate, role === "background" ? 160 : 120);
        highPassInPlace(pcm.right, pcm.sampleRate, role === "background" ? 160 : 120);
      }
      const rmsAfterClean = Math.max(rmsOf(pcm.left), rmsOf(pcm.right));

      // Pitch polish / soft auto-tune — lead must not stay raw.
      // Choir/harmony stay uncorrected (organic stack). Doubles/adlibs get light tighten.
      let pitchNotes: string[] = [];
      if (
        role === "lead" ||
        role === "double" ||
        role === "adlib" ||
        role === "intro" ||
        role === "outro"
      ) {
        try {
          const bias =
            role === "lead"
              ? 0.72
              : role === "adlib"
                ? 0.45
                : 0.32;
          const polished = polishVocalLayer({
            pcm,
            role,
            genre: opts.genre ?? null,
            correctionStrengthBias: bias,
            forcePreserveVibrato: true,
          });
          if (polished.applied && polished.pcm) {
            pcm.left = polished.pcm.left;
            pcm.right = polished.pcm.right;
            const dn = polished.decision?.notes;
            pitchNotes = Array.isArray(dn) && dn.length
              ? dn.slice(0, 8)
              : [
                  "pitch_applied",
                  `notes_corrected:${polished.qc?.notesCorrected ?? 0}`,
                ];
          } else {
            pitchNotes = [
              "pitch_skipped",
              ...(polished.decision?.notes?.slice(0, 4) || []),
            ];
          }
        } catch (pe) {
          pitchNotes = ["pitch_failed"];
          console.warn(
            "[fast-produce] pitch polish failed",
            role,
            pe instanceof Error ? pe.message : pe
          );
        }
      } else {
        pitchNotes = ["pitch_bypass_stack"];
      }

      // Role-specific tone + dynamics (not one chain for all vocals)
      applyRoleEq(pcm, role);
      applyRoleDynamics(pcm, role);
      // Vibe chip → lead tone (presence / air / mud)
      if (role === "lead" && vibeDeltas) {
        applyEqStereo(pcm, [
          { type: "peak", freq: 280, gainDb: vibeDeltas.leadMudCutDb * 0.5, q: 0.85 },
          { type: "peak", freq: 3200, gainDb: vibeDeltas.leadPresenceBoostDb * 0.45, q: 1.0 },
          { type: "highshelf", freq: 11000, gainDb: vibeDeltas.leadAirShelfDb * 0.5, q: 0.7 },
        ]);
      }

      levelMatchToBeat(pcm, beatRms, role);
      const fader = roleGainLinear(role);
      headroomForFader(pcm, fader, role === "lead" ? 0.95 : 0.88);

      // Stereo image by role — lead center; supports use natural pan, not synthetic width
      // (M-S wideners on choir → hollow/phasey robot tone)
      const pan = DEFAULT_ROLE_PAN[role] ?? 0;
      const isStack =
        role === "background" || role.startsWith("harmony") || role === "double";
      const width = isStack ? 0.08 : DEFAULT_ROLE_WIDTH[role] ?? 0.1;
      try {
        applyWidth(pcm, width, pan);
      } catch {
        /* width optional */
      }

      // —— AP SPACE: performance + role → character (present / intimate / wide) ——
      let spaceNotes: string[] = [];
      let spaceCharacter = "present";
      let duckDbLayer = 2.0;
      try {
        const perf = analyzePerformance(pcm);
        const space = decideVocalSpace({
          performance: perf,
          roleType: role,
          sectionLabel: v.sectionLabel || null,
          genre: opts.genre ?? null,
          bpm: opts.bpm ?? null,
        });
        const applied = applyVocalSpace(pcm, space);
        pcm.left = applied.pcm.left;
        pcm.right = applied.pcm.right;
        spaceNotes = space.notes;
        spaceCharacter = space.character;
        duckDbLayer = space.duckDb;
        // Support roles duck the beat less than lead (avoid pumping on stacks)
        if (role !== "lead") duckDbLayer = Math.min(duckDbLayer, 2.5);
      } catch {
        spaceNotes = ["space_skipped"];
      }

      // Console Track FX + automation — same artist intent as Export bounce
      applyConsoleFxWithAutomation(
        pcm,
        (v.trackFx || null) as ConsoleTrackFx | null,
        opts.fxAutomation || null,
        v.taskId || "",
        Math.max(0, Number(v.startMs) || 0)
      );

      // Vibe + section dynamic riding (verse intimate / chorus open)
      let sectionRideNotes: string[] = [];
      try {
        const ride = applyVibeSectionRide(pcm, {
          sectionLabel: v.sectionLabel || null,
          role,
          vibe: vibeDeltas,
        });
        sectionRideNotes = ride.notes;
      } catch {
        sectionRideNotes = ["section_ride_skipped"];
      }

      const startMs = Math.max(0, Number(v.startMs) || 0);
      const peakPreMix = Math.max(peakOf(pcm.left), peakOf(pcm.right));
      layers.push({ pcm, startMs, gain: fader, type, role, pan, duckDb: duckDbLayer });
      if (role === "lead" && duckDbLayer) duckDb = duckDbLayer;
      layerDiag.push({
        label,
        type,
        role,
        startMs,
        durationMs: vocalNorm.durationMs,
        bytes: raw.length,
        rmsAfterClean: Number(rmsAfterClean.toFixed(5)),
        peakPreMix: Number(peakPreMix.toFixed(4)),
        fader: Number(fader.toFixed(3)),
        pan,
        width,
        spaceCharacter,
        spaceNotes: spaceNotes.slice(0, 8),
        sectionRide: sectionRideNotes.slice(0, 6),
        pitch: pitchNotes,
        intoBusPeak: Number((peakPreMix * fader).toFixed(4)),
      });
      console.info("[fast-produce] layer", JSON.stringify(layerDiag[layerDiag.length - 1]));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      skipReasons.push(`${label}: ${msg}`);
      console.warn("[fast-produce] skip layer", label, msg);
    }
  }

  if (!layers.length) {
    throw new Error(
      `Could not decode any vocal takes${skipReasons.length ? ` (${skipReasons.join("; ")})` : ""}`
    );
  }

  for (const L of layers) {
    const end = Math.floor((L.startMs / 1000) * sampleRate) + L.pcm.left.length;
    if (end > totalSamples) totalSamples = end;
  }
  if (totalSamples > beat.left.length) {
    const nl = new Float32Array(totalSamples);
    const nr = new Float32Array(totalSamples);
    nl.set(beat.left);
    nr.set(beat.right);
    beat.left = nl;
    beat.right = nr;
  }

  // --- Phase 1: Vocal Arrangement Mind (section map + automation) ---
  const leadLayer = layers.find((L) => L.role === "lead") || layers[0]!;
  let arrangement: ArrangementPlan | null = null;
  try {
    arrangement = buildArrangementPlan({
      beat,
      vocal: leadLayer.pcm,
      bpm: opts.bpm ?? null,
      durationMs: Math.round((totalSamples / sampleRate) * 1000),
    });
    for (const L of layers) {
      // Automation depth by role — lead rides sections fully; supports less
      const roleScale =
        L.role === "lead"
          ? 1
          : L.role === "double"
            ? 0.55
            : L.role.startsWith("harmony")
              ? 0.42
              : L.role === "adlib"
                ? 0.38
                : L.role === "background"
                  ? 0.32
                  : 0.5;
      // Scale section automation depth by vibe (raw = gentler rides, polished = bolder)
      const vibeRideScale =
        vibeDeltas.vibeKey === "raw_soulful"
          ? 0.55
          : vibeDeltas.vibeKey === "intimate_warm"
            ? 0.75
            : vibeDeltas.vibeKey === "ethereal_dreamy"
              ? 1.15
              : vibeDeltas.vibeKey === "polished_pop" || vibeDeltas.vibeKey === "punchy_forward"
                ? 1.1
                : 1.0;
      applySectionAutomation(L.pcm, arrangement, {
        roleScale: roleScale * vibeRideScale,
        layerStartMs: L.startMs,
      });
    }
    console.info(
      "[fast-produce] arrangement",
      JSON.stringify({
        method: arrangement.method,
        sections: arrangement.sections.map((s) => ({
          type: s.type,
          startMs: s.startMs,
          endMs: s.endMs,
          energy: s.energy,
        })),
      })
    );
  } catch (arrErr) {
    console.warn(
      "[fast-produce] arrangement skip",
      arrErr instanceof Error ? arrErr.message : arrErr
    );
    arrangement = null;
  }

  await report("arranging"); // structure applied
  await report("mixing");

  // --- Sum beat + vocals with envelope ducking ---
  const mix: PcmStereo = {
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
    sampleRate,
  };
  const bg = beatGain;
  for (let i = 0; i < totalSamples; i++) {
    mix.left[i] = (beat.left[i] || 0) * bg;
    mix.right[i] = (beat.right[i] || 0) * bg;
  }

  // Vocal envelope for ducking (sum of all vocal abs)
  const vocalEnv = new Float32Array(totalSamples);
  for (const L of layers) {
    const start = Math.min(totalSamples - 1, Math.floor((L.startMs / 1000) * sampleRate));
    const len = Math.min(L.pcm.left.length, totalSamples - start);
    // Lead drives ducking; choir/background barely so the mix doesn't pump ("ducky")
    const weight =
      L.role === "lead" ? 0.55 :
      L.role === "double" ? 0.2 :
      L.role === "adlib" ? 0.15 :
      L.role === "background" ? 0.06 :
      L.role.startsWith("harmony") ? 0.1 : 0.2;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(L.pcm.left[i] || 0) + Math.abs(L.pcm.right[i] || 0);
      vocalEnv[start + i] = Math.max(vocalEnv[start + i] || 0, a * weight);
    }
  }
  // Smooth envelope
  const envSmooth = Math.exp(-1 / (0.02 * sampleRate));
  let e = 0;
  for (let i = 0; i < totalSamples; i++) {
    e = e * envSmooth + (vocalEnv[i] || 0) * (1 - envSmooth);
    vocalEnv[i] = e;
  }
  const duckAmt = Math.min(0.55, Math.max(0.2, duckDb / 10));
  for (let i = 0; i < totalSamples; i++) {
    const duck = 1 - Math.min(0.48, (vocalEnv[i] || 0) * duckAmt * 2.8);
    mix.left[i]! *= duck;
    mix.right[i]! *= duck;
  }

  // Add vocals
  for (const L of layers) {
    const start = Math.min(totalSamples - 1, Math.floor((L.startMs / 1000) * sampleRate));
    const len = Math.min(L.pcm.left.length, totalSamples - start);
    const g = L.gain;
    for (let i = 0; i < len; i++) {
      mix.left[start + i]! += (L.pcm.left[i] || 0) * g;
      mix.right[start + i]! += (L.pcm.right[i] || 0) * g;
    }
  }

  // --- MIX bus (pre-master): light glue only — preserve headroom; avoid pumping on vocal peaks ---
  const peakBeforeGlue = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-9);
  // Milder than before: high-energy vocal peaks must not trigger aggressive bus pumping
  compressStereo(mix, {
    thresholdDb: -14,
    ratio: Math.max(1.2, Math.min(2.2, vibeDeltas.busCompressionRatio)),
    attackMs: Math.max(10, Math.min(60, vibeDeltas.busAttackMs)),
    releaseMs: 180,
    makeupDb: 0.6,
  });
  const peakAfterGlue = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-9);
  if (peakAfterGlue > dbToGain(-1.0)) {
    limitStereo(mix, -1.0);
  }
  const mixPeak = Math.max(peakOf(mix.left), peakOf(mix.right), 1e-9);
  const mixRmsProxyDb = estimateLoudnessProxyDb(mix);
  const mixWav = encodeStereoWav(mix);

  await report("mixing"); // bus glue done — keep UI moving past 80%
  await report("mastering");

  // --- MASTER: vocal-centric agent (diagnostics + adaptive EQ + glue + loudness + true-peak) ---
  // Specialist directives: protect lead 1–3 kHz presence, keep stacks wider/lower already
  // done in mix; master unifies beat+vocals without harsh limiting pump.
  const masterCtx = resolveMasterContext({
    genre: opts.genre ?? null,
    vocalSit: vibeDeltas.polishAxis < 0.4 ? "blend" : "forward",
    platform: "both",
    mood:
      vibeDeltas.vibeKey === "intimate_warm" || vibeDeltas.vibeKey === "raw_soulful"
        ? "spacious"
        : vibeDeltas.vibeKey === "ethereal_dreamy"
          ? "spacious"
          : vibeDeltas.vibeKey === "polished_pop" || vibeDeltas.vibeKey === "punchy_forward"
            ? "loud"
            : "balanced",
    targetLufsHint: undefined,
  });
  // Vibe LUFS nudge on top of genre/mood base
  masterCtx.targetLufs = Math.max(
    -14.5,
    Math.min(-9, masterCtx.targetLufs + (vibeDeltas.targetLufsNudge || 0))
  );
  const CEILING_DB = -1.0;
  const masterDecision: MasterDecision = {
    eq: [],
    compressor: null,
    limiterCeilingDb: CEILING_DB,
    targetLufs: masterCtx.targetLufs,
    makeupDb: 0,
    truePeakMarginDb: 0.35,
  };

  let master: PcmStereo;
  let proxyBeforeDb = estimateLoudnessProxyDb(mix);
  let proxyAfterDb = proxyBeforeDb;
  let loudness: {
    beforeDb: number;
    afterDb: number;
    targetDb: number;
    passes: number;
    totalGainDb: number;
  } = {
    beforeDb: proxyBeforeDb,
    afterDb: proxyBeforeDb,
    targetDb: masterCtx.targetLufs + 3.2,
    passes: 0,
    totalGainDb: 0,
  };
  let masterSummary: string | null = null;
  let masterSteps: string[] = [];
  let TARGET_LUFS = masterCtx.targetLufs;

  try {
    const agent = runMasteringAgent(mix, masterDecision, {
      genre: opts.genre ?? null,
      vocalSit: "forward",
      platform: "both",
      bpm: opts.bpm ?? null,
    });
    master = agent.pcm;
    TARGET_LUFS = agent.context.targetLufs;
    proxyBeforeDb = agent.before.integratedDb;
    proxyAfterDb = agent.after.integratedDb;
    loudness = {
      beforeDb: agent.before.integratedDb,
      afterDb: agent.after.integratedDb,
      targetDb: TARGET_LUFS,
      passes: 1,
      totalGainDb: agent.after.integratedDb - agent.before.integratedDb,
    };
    masterSummary = agent.summary;
    masterSteps = agent.steps.slice(0, 12);
  } catch (masterErr) {
    console.warn(
      "[fast-produce] master agent failed — fallback chain",
      masterErr instanceof Error ? masterErr.message : masterErr
    );
    master = cloneStereo(mix);
    // Fallback: HPF rumble, protect presence, soft air, streaming loudness, -1 dBTP
    highPassInPlace(master.left, master.sampleRate, 28);
    highPassInPlace(master.right, master.sampleRate, 28);
    applyEqStereo(master, [
      { type: "peak", freq: 180, gainDb: -1.0, q: 0.85 },
      { type: "peak", freq: 2800, gainDb: 1.2, q: 1.0 },
      { type: "peak", freq: 3800, gainDb: -0.8, q: 1.2 },
      { type: "highshelf", freq: 11000, gainDb: 0.8, q: 0.7 },
    ]);
    loudness = normalizeToStreamingTarget(master, TARGET_LUFS, CEILING_DB, 0.35);
    truePeakLimit(master, CEILING_DB, 0.35);
    proxyBeforeDb = loudness.beforeDb;
    proxyAfterDb = loudness.afterDb;
    masterSteps = ["fallback_eq_loudness"];
  }

  // Strict true-peak ceiling (−1.0 dBTP) for AAC/MP3 inter-sample safety
  truePeakLimit(master, CEILING_DB, 0.35);
  const masterPeak = Math.max(peakOf(master.left), peakOf(master.right), 1e-9);
  if (masterPeak > dbToGain(-0.8)) {
    truePeakLimit(master, -1.2, 0.2);
  }
  const masterTruePeakDbApprox = 20 * Math.log10(
    Math.max(peakOf(master.left), peakOf(master.right), 1e-12)
  );

  // Clamp any numerical overshoot before encode
  for (let i = 0; i < master.left.length; i++) {
    if (master.left[i]! > 1) master.left[i] = 1;
    if (master.left[i]! < -1) master.left[i] = -1;
    if (master.right[i]! > 1) master.right[i] = 1;
    if (master.right[i]! < -1) master.right[i] = -1;
  }

  const masterWav = encodeStereoWav(master);
  const durationMs = Math.round((mix.left.length / mix.sampleRate) * 1000);

  const diagnostics: Record<string, unknown> = {
    path: "fast-space",
    engineVersion: FAST_ENGINE_VERSION,
    layerCount: layers.length,
    durationMs,
    beatGain,
    duckDb,
    spaceCharacter,
    spaceNotes,
    masterAgent: masterSummary
      ? { summary: masterSummary, steps: masterSteps }
      : { summary: null, steps: masterSteps },
    loudness: {
      targetLufs: TARGET_LUFS,
      ceilingDbTp: CEILING_DB,
      proxyBeforeDb: Math.round(proxyBeforeDb * 10) / 10,
      proxyAfterDb: Math.round(proxyAfterDb * 10) / 10,
      totalGainDb: Math.round(loudness.totalGainDb * 100) / 100,
      passes: loudness.passes,
      beforeDb: Math.round(loudness.beforeDb * 10) / 10,
      afterDb: Math.round(loudness.afterDb * 10) / 10,
      targetDb: loudness.targetDb,
    },
    mix: {
      peak: Math.round(mixPeak * 1000) / 1000,
      peakDb: Math.round(20 * Math.log10(mixPeak + 1e-12) * 10) / 10,
      rmsProxyDb: Math.round(mixRmsProxyDb * 10) / 10,
      peakBeforeGlue: Math.round(peakBeforeGlue * 1000) / 1000,
      peakAfterGlue: Math.round(peakAfterGlue * 1000) / 1000,
    },
    master: {
      peak: Math.round(masterPeak * 1000) / 1000,
      peakDb: Math.round(20 * Math.log10(masterPeak + 1e-12) * 10) / 10,
      rmsProxyDb: Math.round(proxyAfterDb * 10) / 10,
      truePeakDbApprox: Math.round(masterTruePeakDbApprox * 10) / 10,
      ceilingDb: CEILING_DB,
    },
    layers: layers.map((L) => ({
      role: L.role,
      type: L.type,
      pan: L.pan,
      startMs: L.startMs,
      samples: L.pcm.left.length,
      duckDb: L.duckDb,
      gain: Number(L.gain.toFixed(3)),
    })),
    vocalStructure: arrangement
      ? {
          phraseCount: arrangement.phrases?.length ?? 0,
          sectionCount: arrangement.sections.length,
          overallConfidence: arrangement.confidence,
          method: arrangement.method,
          sections: arrangement.sections.map((s) => ({
            type: s.type,
            startMs: s.startMs,
            endMs: s.endMs,
            confidence: s.confidence,
          })),
        }
      : null,
    note: "Arrangement Mind: phrase+section map on continuous vocal; mix then master loudness.",
  };
  console.info(
    "[fast-produce] done",
    JSON.stringify({
      engineVersion: FAST_ENGINE_VERSION,
      layerCount: layers.length,
      durationMs,
      loudness: diagnostics.loudness,
      mixPeakDb: (diagnostics.mix as { peakDb: number }).peakDb,
      masterPeakDb: (diagnostics.master as { peakDb: number }).peakDb,
    })
  );
  return {
    wav: masterWav,
    mixWav,
    masterWav,
    layerCount: layers.length,
    durationMs,
    path: "fast-space",
    diagnostics,
    engineVersion: FAST_ENGINE_VERSION,
  };
}

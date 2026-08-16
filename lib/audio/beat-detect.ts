/**
 * Lightweight beat / tempo analysis for uploaded beats.
 * Pipeline (classical MIR):
 *   PCM → frame energy → onset strength (positive flux)
 *   → autocorrelation tempo → optional beat grid
 *
 * No native deps — runs in browser (AudioContext) or Node (Float32Array).
 * Good enough for planning; not a full librosa/madmom replacement.
 */

export type BeatAnalysis = {
  duration_ms: number;
  bpm: number;
  confidence: number;
  beat_times_ms: number[];
  method: "energy_acf";
  sample_rate: number;
  frames: number;
};

const MIN_BPM = 60;
const MAX_BPM = 180;
const TARGET_SR = 22050;
const FRAME_SIZE = 1024;
const HOP = 512;

/** Mix to mono */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const inv = 1 / channels.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][i] || 0;
    out[i] = s * inv;
  }
  return out;
}

/** Simple linear resample to target rate */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/** Frame RMS energy */
function frameEnergy(samples: Float32Array, frameSize: number, hop: number): Float32Array {
  const nFrames = Math.max(0, Math.floor((samples.length - frameSize) / hop) + 1);
  const energy = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[start + i] || 0;
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / frameSize);
  }
  return energy;
}

/** Positive first-difference of energy (= simple onset strength) */
function onsetStrength(energy: Float32Array): Float32Array {
  const o = new Float32Array(energy.length);
  for (let i = 1; i < energy.length; i++) {
    const d = energy[i] - energy[i - 1];
    o[i] = d > 0 ? d : 0;
  }
  // light smooth
  for (let i = 1; i < o.length - 1; i++) {
    o[i] = 0.25 * o[i - 1] + 0.5 * o[i] + 0.25 * o[i + 1];
  }
  return o;
}

/** Autocorrelation of onset strength over tempo lag range */
function estimateTempo(
  onset: Float32Array,
  fps: number
): { bpm: number; confidence: number; periodFrames: number } {
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * fps));
  const maxLag = Math.min(onset.length - 1, Math.ceil((60 / MIN_BPM) * fps));
  if (maxLag <= minLag + 1) {
    return { bpm: 90, confidence: 0, periodFrames: Math.round(fps * 0.666) };
  }

  // Mean-center onset for cleaner ACF
  let mean = 0;
  for (let i = 0; i < onset.length; i++) mean += onset[i];
  mean /= onset.length || 1;

  const acf = new Float32Array(maxLag + 1);
  let maxAcf = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = onset.length - lag;
    for (let i = 0; i < n; i++) {
      sum += (onset[i] - mean) * (onset[i + lag] - mean);
    }
    acf[lag] = sum / (n || 1);
    if (acf[lag] > maxAcf) maxAcf = acf[lag];
  }

  // Peak pick with preference for mid-tempo (perceptual prior ~90–140)
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1]) {
      const bpm = (60 * fps) / lag;
      // soft prior: prefer 80–140
      const prior = Math.exp(-0.5 * Math.pow((bpm - 110) / 45, 2));
      const score = (maxAcf > 0 ? acf[lag] / maxAcf : 0) * (0.55 + 0.45 * prior);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
  }

  let bpm = (60 * fps) / bestLag;

  // Resolve common half/double confusion toward 70–150
  if (bpm < 70 && bpm * 2 <= MAX_BPM) {
    const doubleLag = Math.round(bestLag / 2);
    if (doubleLag >= minLag && acf[doubleLag] > acf[bestLag] * 0.7) {
      bpm *= 2;
      bestLag = doubleLag;
    }
  } else if (bpm > 150 && bpm / 2 >= MIN_BPM) {
    const halfLag = bestLag * 2;
    if (halfLag <= maxLag && acf[halfLag] > acf[bestLag] * 0.65) {
      bpm /= 2;
      bestLag = halfLag;
    }
  }

  bpm = Math.round(bpm * 10) / 10;
  const confidence = Math.max(0, Math.min(1, bestScore));
  return { bpm, confidence, periodFrames: bestLag };
}

/** Place beats from first strong onset, stepping by period */
function placeBeats(
  onset: Float32Array,
  periodFrames: number,
  fps: number,
  durationMs: number
): number[] {
  if (periodFrames < 2 || onset.length < periodFrames) return [];

  // Find best phase: try offsets 0..period-1, maximize sum of onset at beat frames
  let bestPhase = 0;
  let bestSum = -Infinity;
  const limit = Math.min(periodFrames, onset.length);
  for (let phase = 0; phase < limit; phase++) {
    let sum = 0;
    for (let i = phase; i < onset.length; i += periodFrames) sum += onset[i];
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }

  const times: number[] = [];
  for (let i = bestPhase; i < onset.length; i += periodFrames) {
    const ms = Math.round((i / fps) * 1000);
    if (ms >= 0 && ms < durationMs) times.push(ms);
  }
  return times;
}

/** Core analysis on mono PCM */
export function analyzePcm(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const duration_ms = Math.max(0, Math.round((samples.length / sampleRate) * 1000));
  if (samples.length < sampleRate * 0.5) {
    return {
      duration_ms,
      bpm: 90,
      confidence: 0,
      beat_times_ms: [],
      method: "energy_acf",
      sample_rate: sampleRate,
      frames: 0,
    };
  }

  const mono = resampleLinear(samples, sampleRate, TARGET_SR);
  const energy = frameEnergy(mono, FRAME_SIZE, HOP);
  const onset = onsetStrength(energy);
  const fps = TARGET_SR / HOP;
  const { bpm, confidence, periodFrames } = estimateTempo(onset, fps);
  const beat_times_ms = placeBeats(onset, periodFrames, fps, duration_ms);

  return {
    duration_ms,
    bpm,
    confidence,
    beat_times_ms,
    method: "energy_acf",
    sample_rate: sampleRate,
    frames: onset.length,
  };
}

/** Browser / Web Audio path */
export async function analyzeAudioBuffer(buffer: AudioBuffer): Promise<BeatAnalysis> {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  return analyzePcm(toMono(channels), buffer.sampleRate);
}

/** Decode a File/Blob in the browser and analyze */
export async function analyzeAudioFile(file: Blob): Promise<BeatAnalysis> {
  const Ctx =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      : null;
  if (!Ctx) {
    throw new Error("AudioContext not available");
  }
  const ctx = new Ctx();
  try {
    const ab = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(ab.slice(0));
    return await analyzeAudioBuffer(audioBuf);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Parse raw PCM WAV (16-bit LE mono/stereo) — useful server-side without decoder */
export function analyzeWavArrayBuffer(ab: ArrayBuffer): BeatAnalysis | null {
  const view = new DataView(ab);
  if (view.byteLength < 44) return null;
  const tag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (tag !== "RIFF") return null;

  let offset = 12;
  let sampleRate = 44100;
  let channels = 1;
  let bits = 16;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || bits !== 16) return null;

  const nSamples = Math.floor(dataSize / (channels * 2));
  const mono = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      s += view.getInt16(dataOffset + (i * channels + c) * 2, true) / 32768;
    }
    mono[i] = s / channels;
  }
  return analyzePcm(mono, sampleRate);
}

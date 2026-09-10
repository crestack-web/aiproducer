import { convertBufferToWav } from "@/lib/audio/convert-to-wav";
import { decodeWav, isWavBuffer } from "@/lib/audio/wav";
import { monoToStereo, resampleMono } from "../dsp";
import type { PcmStereo } from "../types";

const TARGET_SR = 44100;
const MAX_DURATION_MS = 8 * 60 * 1000;
const MIN_DURATION_MS = 200;

export type NormalizedAudio = {
  pcm: PcmStereo;
  originalFormat: string;
  durationMs: number;
  bytesIn: number;
};

export async function normalizeToInternalPcm(
  buffer: Buffer,
  pathHint?: string
): Promise<NormalizedAudio> {
  if (!buffer || buffer.length < 100) {
    throw new Error("Audio file is empty or too small");
  }
  if (buffer.length > 120 * 1024 * 1024) {
    throw new Error("Audio file exceeds size limit");
  }

  let wav = buffer;
  let originalFormat = isWavBuffer(buffer) ? "wav" : "unknown";

  if (!isWavBuffer(buffer)) {
    const conv = await convertBufferToWav(buffer, pathHint);
    wav = conv.buffer;
    originalFormat = (pathHint || "").toLowerCase().includes("mp3") ? "mp3" : "converted";
  }

  if (!isWavBuffer(wav)) {
    throw new Error("Could not normalize audio to WAV");
  }

  const decoded = decodeWav(wav);
  let mono = decoded.samples;
  let sr = decoded.sampleRate;
  if (sr !== TARGET_SR) {
    mono = resampleMono(mono, sr, TARGET_SR);
    sr = TARGET_SR;
  }

  const durationMs = Math.round((mono.length / sr) * 1000);
  if (durationMs < MIN_DURATION_MS) {
    throw new Error("Audio is too short to produce");
  }
  if (durationMs > MAX_DURATION_MS) {
    throw new Error("Audio exceeds maximum duration (8 minutes)");
  }

  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i] || 0);
    if (a > peak) peak = a;
  }
  if (peak < 1e-5) {
    throw new Error("Audio appears silent");
  }

  const pcm = monoToStereo(mono, sr);
  return { pcm, originalFormat, durationMs, bytesIn: buffer.length };
}

/**
 * Place a section take onto the full song timeline at startMs (beat position).
 * Output vocal buffer is always at least as long as the beat so multi-section
 * mixes span the whole song, not just the first take.
 */
export function placeOnTimeline(
  vocal: PcmStereo,
  beat: PcmStereo,
  startMs: number
): { vocal: PcmStereo; beat: PcmStereo; length: number } {
  const sr = vocal.sampleRate || beat.sampleRate || 44100;
  const start = Math.max(0, Math.floor((Math.max(0, startMs) / 1000) * sr));
  const total = Math.max(beat.left.length, start + vocal.left.length, 1);
  const vL = new Float32Array(total);
  const vR = new Float32Array(total);
  const bL = new Float32Array(total);
  const bR = new Float32Array(total);
  bL.set(beat.left.subarray(0, Math.min(beat.left.length, total)));
  bR.set(beat.right.subarray(0, Math.min(beat.right.length, total)));
  const n = Math.min(vocal.left.length, Math.max(0, total - start));
  for (let i = 0; i < n; i++) {
    vL[start + i] = vocal.left[i] || 0;
    vR[start + i] = vocal.right[i] || 0;
  }
  return {
    vocal: { left: vL, right: vR, sampleRate: sr },
    beat: { left: bL, right: bR, sampleRate: sr },
    length: total,
  };
}

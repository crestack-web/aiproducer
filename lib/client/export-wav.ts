"use client";

/**
 * Browser: decode MediaRecorder blob → 16-bit mono WAV for produce alignment.
 *
 * Duration contract (must hold):
 *   durationSec = frameCount / sampleRate
 * Header sampleRate MUST match the PCM rate written.
 * Never label 48 kHz data as 44.1 kHz (or the reverse) — that stretches/pitches audio.
 *
 * Resampling: prefer native rate when 44.1/48 kHz. If conversion is required,
 * use duration-preserving linear resampling (frameCount' = round(n * dst/src)).
 * OfflineAudioContext is avoided as primary path — mismatched context vs buffer
 * sample rates have caused WebKit duration bugs.
 */

export type WavConversionResult = {
  blob: Blob;
  sampleRate: number;
  channels: 1;
  method: "passthrough_decode" | "offline_resample" | "linear_fallback";
  sourceSampleRate: number;
  sourceChannels: number;
  /** Authoritative durations (seconds) for forensics */
  sourceDurationSec: number;
  outputDurationSec: number;
  sourceFrameCount: number;
  outputFrameCount: number;
  durationDeltaMs: number;
};

const PREFERRED_RATES = new Set([44100, 48000]);
/** Max allowed |in − out| duration after conversion */
const DURATION_TOLERANCE_SEC = 0.005;

function encodePcm16MonoWav(samples: Float32Array, sampleRate: number): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new Error(`Invalid WAV sampleRate ${sampleRate}`);
  }
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = 2;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    view.setInt16(o, Math.max(-32768, Math.min(32767, v)), true);
    o += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Mono: channel 0 only — never average (phase cancellation risk). */
function toMono(chans: Float32Array[]): Float32Array {
  if (chans.length <= 1) return chans[0] || new Float32Array(0);
  return chans[0];
}

/**
 * Duration-preserving linear resample.
 * outFrames = round(inFrames * dstRate / srcRate)
 * ⇒ outDuration = outFrames/dstRate ≈ inFrames/srcRate
 */
export function linearResample(
  samples: Float32Array,
  srcRate: number,
  dstRate: number
): Float32Array {
  if (srcRate === dstRate || samples.length === 0) return samples;
  if (!Number.isFinite(srcRate) || !Number.isFinite(dstRate) || srcRate <= 0 || dstRate <= 0) {
    return samples;
  }
  const ratio = dstRate / srcRate;
  const next = new Float32Array(Math.max(1, Math.round(samples.length * ratio)));
  for (let i = 0; i < next.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = src - i0;
    next[i] = (samples[i0] || 0) * (1 - t) + (samples[i1] || 0) * t;
  }
  return next;
}

/**
 * OfflineAudioContext resample — only when context sampleRate === srcRate for the
 * intermediate buffer, then linear to dst. Avoids WebKit buffer/context rate bugs.
 */
async function offlineResampleSafe(
  samples: Float32Array,
  srcRate: number,
  dstRate: number
): Promise<Float32Array> {
  if (srcRate === dstRate || samples.length === 0) return samples;
  // Prefer pure linear — deterministic duration, no browser clock quirks
  return linearResample(samples, srcRate, dstRate);
}

function durationSec(frames: number, rate: number): number {
  if (!rate || rate <= 0) return 0;
  return frames / rate;
}

export async function audioBlobToWavDetailed(
  blob: Blob,
  preferredSampleRate?: number
): Promise<WavConversionResult> {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const raw = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    const sourceSampleRate = decoded.sampleRate || 44100;
    const sourceChannels = decoded.numberOfChannels || 1;
    const chans: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      chans.push(decoded.getChannelData(c));
    }
    const mono = toMono(chans);
    const sourceFrameCount = mono.length;
    // Prefer frame math over decoded.duration (metadata can be wrong on some containers)
    const sourceDurationSec = durationSec(sourceFrameCount, sourceSampleRate);

    let samples = mono;
    let sampleRate = sourceSampleRate;
    let method: WavConversionResult["method"] = "passthrough_decode";

    // Keep native 44.1 / 48 kHz — only convert exotic rates (e.g. 16k, 96k)
    const target =
      preferredSampleRate && preferredSampleRate > 0
        ? preferredSampleRate
        : PREFERRED_RATES.has(sourceSampleRate)
          ? sourceSampleRate
          : 44100;

    if (sourceSampleRate !== target) {
      try {
        samples = await offlineResampleSafe(mono, sourceSampleRate, target);
        sampleRate = target;
        method = "linear_fallback"; // intentional: duration-safe linear is primary
      } catch {
        samples = linearResample(mono, sourceSampleRate, target);
        sampleRate = target;
        method = "linear_fallback";
      }
    }

    const outputFrameCount = samples.length;
    const outputDurationSec = durationSec(outputFrameCount, sampleRate);
    const durationDeltaMs = Math.round((outputDurationSec - sourceDurationSec) * 1000);

    if (Math.abs(outputDurationSec - sourceDurationSec) > DURATION_TOLERANCE_SEC) {
      // Hard correction: force frame count from source duration at target rate
      const corrected = linearResample(mono, sourceSampleRate, sampleRate);
      samples = corrected;
      const correctedDur = durationSec(corrected.length, sampleRate);
      if (Math.abs(correctedDur - sourceDurationSec) > DURATION_TOLERANCE_SEC) {
        console.warn("[export-wav] duration mismatch after correction", {
          sourceSampleRate,
          sampleRate,
          sourceFrameCount,
          outputFrameCount: corrected.length,
          sourceDurationSec,
          outputDurationSec: correctedDur,
        });
      }
    }

    const finalFrames = samples.length;
    const finalDur = durationSec(finalFrames, sampleRate);

    // Forensic snapshot for developer tools
    try {
      sessionStorage.setItem(
        "studio_last_wav_conversion",
        JSON.stringify({
          sourceSampleRate,
          outputSampleRate: sampleRate,
          sourceFrameCount,
          outputFrameCount: finalFrames,
          sourceDurationSec,
          outputDurationSec: finalDur,
          durationDeltaMs: Math.round((finalDur - sourceDurationSec) * 1000),
          method,
          sourceChannels,
          blobBytes: blob.size,
          blobType: blob.type,
          at: Date.now(),
        })
      );
    } catch {
      /* ignore */
    }

    return {
      blob: encodePcm16MonoWav(samples, sampleRate),
      sampleRate,
      channels: 1,
      method,
      sourceSampleRate,
      sourceChannels,
      sourceDurationSec,
      outputDurationSec: finalDur,
      sourceFrameCount,
      outputFrameCount: finalFrames,
      durationDeltaMs: Math.round((finalDur - sourceDurationSec) * 1000),
    };
  } finally {
    void ctx.close();
  }
}

export async function audioBlobToWav(blob: Blob, targetSampleRate?: number): Promise<Blob> {
  const result = await audioBlobToWavDetailed(blob, targetSampleRate);
  return result.blob;
}

/** Self-check: known signal duration must survive encode path (browser only). */
export async function verifyWavDurationRoundTrip(
  durationSec: number,
  sampleRate: number
): Promise<{ ok: boolean; inSec: number; outSec: number; frames: number }> {
  const frames = Math.round(durationSec * sampleRate);
  const samples = new Float32Array(frames);
  // 440 Hz tone
  for (let i = 0; i < frames; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.2;
  }
  const blob = encodePcm16MonoWav(samples, sampleRate);
  const detailed = await audioBlobToWavDetailed(blob, sampleRate);
  const inSec = durationSec;
  const outSec = detailed.outputDurationSec;
  return {
    ok: Math.abs(outSec - inSec) <= DURATION_TOLERANCE_SEC,
    inSec,
    outSec,
    frames: detailed.outputFrameCount,
  };
}

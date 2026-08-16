/**
 * Deterministic audio-analysis fixture (no network, no secrets).
 * Run: npx --yes tsx scripts/test-audio-analysis.ts
 */

import { analyzeMonoPcm, analyzeMetadataOnly } from "../lib/audio/analysis";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function sineWave(seconds: number, hz: number, sampleRate: number, amp = 0.4): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * amp;
  }
  return out;
}

function withLeadingSilence(samples: Float32Array, silenceSamples: number): Float32Array {
  const out = new Float32Array(samples.length + silenceSamples);
  out.set(samples, silenceSamples);
  return out;
}

function main() {
  const sampleRate = 44100;
  const tone = sineWave(1.0, 220, sampleRate, 0.5);
  const withSilence = withLeadingSilence(tone, Math.floor(sampleRate * 0.5)); // 500ms silence

  const analysis = analyzeMonoPcm({
    samples: withSilence,
    sampleRate,
    channels: 1,
    projectId: "test-project",
    sectionId: "test-section",
    role: "LEAD",
    timelineStartMs: 42800,
    timelineEndMs: 62000,
    expectedDurationMs: 19200,
  });

  assert(analysis.method === "pcm_energy_v1", "method");
  assert(analysis.sampleRate === 44100, "sampleRate");
  assert(analysis.channels === 1, "channels");
  assert(analysis.durationMs != null && analysis.durationMs > 1400 && analysis.durationMs < 1600, `duration ${analysis.durationMs}`);
  assert(analysis.loudness.rms != null && analysis.loudness.rms > 0.05, `rms ${analysis.loudness.rms}`);
  assert(analysis.loudness.peak != null && analysis.loudness.peak > 0.3, `peak ${analysis.loudness.peak}`);
  assert(analysis.loudness.integratedLufs === null, "lufs must be null");
  assert(analysis.quality.clippingDetected === false, "clipping");
  assert(analysis.quality.leadingSilenceMs != null && analysis.quality.leadingSilenceMs >= 400, `lead silence ${analysis.quality.leadingSilenceMs}`);
  assert(analysis.timeline.expectedDurationMs === 19200, "expected duration");
  assert(analysis.timeline.startTimeMs === 42800, "start time");
  assert(analysis.timeline.endTimeMs === 62000, "end time");
  assert(analysis.timeline.actualDurationMs === analysis.durationMs, "actual duration link");

  // Clipping fixture
  const clipped = sineWave(0.3, 440, sampleRate, 1.0);
  for (let i = 0; i < clipped.length; i += 100) clipped[i] = 0.999;
  const clipA = analyzeMonoPcm({ samples: clipped, sampleRate, channels: 1 });
  assert(clipA.quality.clippingDetected === true, "clipping detected");

  // Metadata-only honesty
  const meta = analyzeMetadataOnly({
    durationMs: 5000,
    expectedDurationMs: 4800,
    timelineStartMs: 0,
    timelineEndMs: 4800,
  });
  assert(meta.method === "metadata_only_v1", "meta method");
  assert(meta.loudness.rms === null, "meta rms null");
  assert(meta.pitch.available === false, "meta pitch false");
  assert(meta.loudness.integratedLufs === null, "meta lufs null");

  console.log("OK audio-analysis fixtures passed");
  console.log(
    JSON.stringify(
      {
        durationMs: analysis.durationMs,
        sampleRate: analysis.sampleRate,
        channels: analysis.channels,
        rms: analysis.loudness.rms,
        peak: analysis.loudness.peak,
        leadingSilenceMs: analysis.quality.leadingSilenceMs,
        timeline: analysis.timeline,
        lufs: analysis.loudness.integratedLufs,
      },
      null,
      2
    )
  );
}

main();

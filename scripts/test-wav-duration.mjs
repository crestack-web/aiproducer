/**
 * Duration-preservation checks for linear resample math (no browser).
 * Run: node scripts/test-wav-duration.mjs
 */

function linearResample(samples, srcRate, dstRate) {
  if (srcRate === dstRate || samples.length === 0) return samples;
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

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

// 5.000s @ 48k → 48k passthrough
{
  const frames = 48000 * 5;
  const samples = new Float32Array(frames);
  const out = linearResample(samples, 48000, 48000);
  assert(out.length === frames, "48k passthrough frame count");
  assert(Math.abs(out.length / 48000 - 5) < 0.001, "48k duration 5.000s");
}

// 5.000s @ 48k → 44.1k
{
  const frames = 48000 * 5;
  const samples = new Float32Array(frames);
  const out = linearResample(samples, 48000, 44100);
  const dur = out.length / 44100;
  assert(Math.abs(dur - 5) < 0.002, `48k→44.1k duration ≈5s (got ${dur.toFixed(4)})`);
  assert(out.length === Math.round(frames * (44100 / 48000)), "48k→44.1k frame formula");
}

// 5.000s @ 44.1k → 48k
{
  const frames = 44100 * 5;
  const samples = new Float32Array(frames);
  const out = linearResample(samples, 44100, 48000);
  const dur = out.length / 48000;
  assert(Math.abs(dur - 5) < 0.002, `44.1k→48k duration ≈5s (got ${dur.toFixed(4)})`);
}

// Wrong header simulation: 48k data labeled 44.1 would yield duration 5.442s
{
  const frames = 48000 * 5;
  const wrongDur = frames / 44100;
  assert(Math.abs(wrongDur - 5.442) < 0.01, "documents classic mislabel stretch (~5.44s)");
  assert(Math.abs(wrongDur - 5) > 0.4, "mislabeled rate is NOT same duration");
}

if (process.exitCode) {
  console.error("\nDuration checks failed.");
  process.exit(1);
}
console.log("\nAll WAV duration math checks passed.");

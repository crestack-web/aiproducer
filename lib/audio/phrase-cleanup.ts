/**
 * Phrase cleanup — close long gaps between phrases (same idea as Produce tighten).
 * amount 0 = no change; 1 = aggressively shrink internal silences.
 */

export type PhraseCleanupOptions = {
  /** 0–1 strength */
  amount: number;
  /** RMS window ms */
  windowMs?: number;
  /** Absolute peak threshold for "silence" at amount=1 */
  silencePeak?: number;
  /** Minimum gap (ms) left between phrases at amount=1 */
  minGapMs?: number;
  /** Ignore gaps shorter than this (ms) */
  ignoreGapMs?: number;
  /** Also trim leading/trailing silence */
  trimEdges?: boolean;
};

function rmsWindow(samples: Float32Array, i0: number, i1: number): number {
  let s = 0;
  const n = Math.max(1, i1 - i0);
  for (let i = i0; i < i1; i++) {
    const v = samples[i] || 0;
    s += v * v;
  }
  return Math.sqrt(s / n);
}

/**
 * Close internal phrase gaps on a mono buffer. Returns a new Float32Array (may be shorter).
 */
export function closePhraseGapsMono(
  samples: Float32Array,
  sampleRate: number,
  opts: PhraseCleanupOptions
): Float32Array {
  const amount = Math.max(0, Math.min(1, opts.amount || 0));
  if (amount < 0.02 || samples.length < sampleRate * 0.2) {
    return samples;
  }

  const windowMs = opts.windowMs ?? 12;
  const win = Math.max(32, Math.floor((windowMs / 1000) * sampleRate));
  const silencePeak = opts.silencePeak ?? 0.018 + (1 - amount) * 0.02;
  const minGapMs = opts.minGapMs ?? 45;
  const ignoreGapMs = opts.ignoreGapMs ?? 90;
  const minGap = Math.floor((minGapMs / 1000) * sampleRate);
  const ignoreGap = Math.floor((ignoreGapMs / 1000) * sampleRate);

  // Classify each window as speech / silence
  const nWin = Math.ceil(samples.length / win);
  const isSpeech = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) {
    const a = w * win;
    const b = Math.min(samples.length, a + win);
    isSpeech[w] = rmsWindow(samples, a, b) > silencePeak ? 1 : 0;
  }
  // median-ish smooth: require 2 of 3
  for (let w = 1; w < nWin - 1; w++) {
    const s = isSpeech[w - 1] + isSpeech[w] + isSpeech[w + 1];
    if (s >= 2) isSpeech[w] = 1;
    else if (s === 0) isSpeech[w] = 0;
  }

  type Seg = { start: number; end: number; speech: boolean };
  const segs: Seg[] = [];
  let w0 = 0;
  for (let w = 1; w <= nWin; w++) {
    if (w === nWin || isSpeech[w] !== isSpeech[w0]) {
      segs.push({
        start: w0 * win,
        end: Math.min(samples.length, w * win),
        speech: isSpeech[w0] === 1,
      });
      w0 = w;
    }
  }

  const out: number[] = [];
  const fade = Math.max(8, Math.floor(0.004 * sampleRate));

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.speech) {
      for (let j = seg.start; j < seg.end; j++) out.push(samples[j] || 0);
      continue;
    }
    // silence
    const gapLen = seg.end - seg.start;
    const isEdge = i === 0 || i === segs.length - 1;
    if (isEdge && opts.trimEdges) {
      // drop most edge silence
      const keep = Math.floor(gapLen * (1 - amount * 0.85));
      const take = Math.min(gapLen, Math.max(0, keep));
      const from = i === 0 ? seg.end - take : seg.start;
      for (let j = 0; j < take; j++) out.push(samples[from + j] || 0);
      continue;
    }
    if (isEdge) {
      // keep edge silence as-is
      for (let j = seg.start; j < seg.end; j++) out.push(samples[j] || 0);
      continue;
    }
    if (gapLen < ignoreGap) {
      for (let j = seg.start; j < seg.end; j++) out.push(samples[j] || 0);
      continue;
    }
    // Shrink internal gap toward minGap
    const target = Math.max(minGap, Math.floor(gapLen * (1 - amount * 0.92)));
    const take = Math.min(gapLen, target);
    const center = Math.floor((seg.start + seg.end) / 2);
    const a = Math.max(seg.start, center - Math.floor(take / 2));
    for (let j = 0; j < take; j++) {
      let v = samples[a + j] || 0;
      // micro fades at join ends
      if (j < fade) v *= j / fade;
      if (j >= take - fade) v *= (take - j) / fade;
      out.push(v);
    }
  }

  const result = new Float32Array(Math.max(1, out.length));
  for (let i = 0; i < out.length; i++) result[i] = out[i];
  return result;
}

/** In-place-style stereo: rewrite left/right with closed gaps (same length ratio). */
export function closePhraseGapsStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  amount: number
): { left: Float32Array; right: Float32Array } {
  if (amount < 0.02) return { left, right };
  // Use mid for detection, apply same keep-map by re-running mono path on each channel
  // with identical segmentation via mid
  const n = Math.min(left.length, right.length);
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = 0.5 * ((left[i] || 0) + (right[i] || 0));
  const cleanedMid = closePhraseGapsMono(mid, sampleRate, { amount, trimEdges: false });
  // If length unchanged substantially, still re-process L/R the same way independently
  // for true gap close we need shared segment map — approximate: process L, scale R by same ratio
  const l2 = closePhraseGapsMono(left.subarray(0, n) as Float32Array, sampleRate, {
    amount,
    trimEdges: false,
  });
  const r2 = closePhraseGapsMono(right.subarray(0, n) as Float32Array, sampleRate, {
    amount,
    trimEdges: false,
  });
  // Match lengths
  const len = Math.min(l2.length, r2.length, cleanedMid.length || l2.length);
  return {
    left: l2.subarray(0, len) as Float32Array,
    right: r2.subarray(0, len) as Float32Array,
  };
}

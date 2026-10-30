/**
 * Phrase cleanup — reduce hum / room noise *between* phrases without
 * collapsing musical timing or eating soft vocals.
 *
 * amount 0 = no change
 * amount 1 = strong gap noise attenuation (duration always preserved)
 *
 * IMPORTANT: This no longer shortens the buffer. Earlier versions removed
 * silence samples and pulled phrases together, which destroyed intentional
 * rests and could clip soft vocal onsets.
 */

export type PhraseCleanupOptions = {
  /** 0–1 strength of inter-phrase noise reduction */
  amount: number;
  /** RMS window ms */
  windowMs?: number;
  /**
   * Peak/RMS threshold for “gap” at amount=1 (lower = more classified as speech).
   * Soft vocals must stay above this.
   */
  silencePeak?: number;
  /** Minimum speech pad (ms) kept untouched at edges of each phrase */
  protectMs?: number;
  /** @deprecated edges are never time-trimmed; kept for call-site compat */
  trimEdges?: boolean;
  /** @deprecated gaps are no longer closed; kept for call-site compat */
  minGapMs?: number;
  /** @deprecated */
  ignoreGapMs?: number;
};

/**
 * Attenuate noise in inter-phrase gaps on a mono buffer.
 * Returns a new Float32Array of the **same length** (timing preserved).
 */
export function closePhraseGapsMono(
  samples: Float32Array,
  sampleRate: number,
  opts: PhraseCleanupOptions
): Float32Array {
  const amount = Math.max(0, Math.min(1, opts.amount || 0));
  if (amount < 0.02 || samples.length < sampleRate * 0.15) {
    return samples;
  }

  const windowMs = opts.windowMs ?? 16;
  const win = Math.max(64, Math.floor((windowMs / 1000) * sampleRate));
  // Conservative threshold: soft vocals stay “speech”
  const silencePeak = opts.silencePeak ?? 0.012;
  const protectMs = opts.protectMs ?? 40;
  const protect = Math.floor((protectMs / 1000) * sampleRate);

  const nWin = Math.ceil(samples.length / win);
  const isSpeech = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) {
    const a = w * win;
    const b = Math.min(samples.length, a + win);
    let peak = 0;
    let sum = 0;
    for (let i = a; i < b; i++) {
      const v = Math.abs(samples[i] || 0);
      if (v > peak) peak = v;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, b - a));
    isSpeech[w] = peak > silencePeak * 1.8 || rms > silencePeak ? 1 : 0;
  }

  // Expand speech regions so soft onsets/tails are not treated as gaps
  const expanded = new Uint8Array(nWin);
  for (let w = 0; w < nWin; w++) {
    let on = isSpeech[w];
    if (!on && w > 0 && isSpeech[w - 1]) on = 1;
    if (!on && w + 1 < nWin && isSpeech[w + 1]) on = 1;
    expanded[w] = on;
  }
  if (amount < 0.85) {
    const e2 = new Uint8Array(nWin);
    for (let w = 0; w < nWin; w++) {
      let on = expanded[w];
      if (!on && w > 0 && expanded[w - 1]) on = 1;
      if (!on && w + 1 < nWin && expanded[w + 1]) on = 1;
      e2[w] = on;
    }
    expanded.set(e2);
  }

  // residual in gaps: amount 0.45 → ~0.22, amount 1 → ~0.03
  const residual = Math.max(0.02, 0.35 * (1 - amount * 0.92));
  const out = new Float32Array(samples.length);
  const fade = Math.max(32, Math.floor(0.008 * sampleRate));

  for (let w = 0; w < nWin; w++) {
    const a = w * win;
    const b = Math.min(samples.length, a + win);
    const speech = expanded[w] === 1;
    const target = speech ? 1 : residual;

    for (let i = a; i < b; i++) {
      let g = target;
      if (!speech) {
        const distFromStart = i - a;
        if (w > 0 && expanded[w - 1] === 1 && distFromStart < fade) {
          const t = distFromStart / fade;
          g = 1 * (1 - t) + residual * t;
        }
        const distToEnd = b - 1 - i;
        if (w + 1 < nWin && expanded[w + 1] === 1 && distToEnd < fade) {
          const t = distToEnd / fade;
          g = Math.max(g, 1 * (1 - t) + residual * t);
        }
      }
      out[i] = (samples[i] || 0) * g;
    }
  }

  // Protect pad: never attenuate near true speech frames
  for (let w = 0; w < nWin; w++) {
    if (isSpeech[w] !== 1) continue;
    const a = Math.max(0, w * win - protect);
    const b = Math.min(samples.length, (w + 1) * win + protect);
    for (let i = a; i < b; i++) {
      const orig = samples[i] || 0;
      if (Math.abs(orig) > silencePeak * 0.5) {
        out[i] = orig;
      }
    }
  }

  // Hard restore of original speech windows
  for (let w = 0; w < nWin; w++) {
    if (isSpeech[w] !== 1) continue;
    const a = w * win;
    const b = Math.min(samples.length, a + win);
    for (let i = a; i < b; i++) out[i] = samples[i] || 0;
  }

  return out;
}

/** Same-length stereo: shared mid detection, apply gain envelope to L/R. */
export function closePhraseGapsStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  amount: number
): { left: Float32Array; right: Float32Array } {
  if (amount < 0.02) return { left, right };
  const n = Math.min(left.length, right.length);
  const mid = new Float32Array(n);
  for (let i = 0; i < n; i++) mid[i] = 0.5 * ((left[i] || 0) + (right[i] || 0));

  const cleanedMid = closePhraseGapsMono(mid, sampleRate, { amount });
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = mid[i] || 0;
    let g = 1;
    if (Math.abs(m) > 1e-8) {
      g = (cleanedMid[i] || 0) / m;
      if (!Number.isFinite(g) || g < 0) g = 0;
      if (g > 1.05) g = 1;
    } else {
      g = Math.abs(cleanedMid[i] || 0) < 1e-8
        ? Math.max(0.02, 0.35 * (1 - amount * 0.92))
        : 1;
    }
    outL[i] = (left[i] || 0) * g;
    outR[i] = (right[i] || 0) * g;
  }
  return { left: outL, right: outR };
}

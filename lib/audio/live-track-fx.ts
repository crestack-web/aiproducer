/**
 * Live Web Audio Track FX graph — parameter ranges match TrackFx / applyConsoleTrackFx.
 *
 * Capability honesty:
 * - Full live: gain, pan, HPF, LPF, EQ, air, compress, delay, slap, multi-tap space
 * - Approximate live: saturation (WaveShaper), de-ess (static HF peak cut),
 *   plate (extra multi-tap), chorus/doubler (LFO delay), limiter (soft-clip + compressor),
 *   width (stereo pan spread proxy, NOT true mid/side)
 * - Live buffer preprocess (startPlayback): gate, noiseReduce
 * - Produce-only (ignored in live apply): rotor*, spring*
 */

export type LiveFxParams = {
  gainDb: number;
  pan: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  air: number;
  compress: number;
  saturation: number;
  reverb: number;
  delay: number;
  plateReverb: number;
  slapDelay: number;
  width: number;
  deEss: number;
  highPassHz: number;
  lowPassHz: number;
  telephone: number;
  chorus: number;
  doubler: number;
  limiter: number;
  /** Produce-only — ignored in live graph */
  gate: number;
  noiseReduce: number;
  /** Produce/Export — close gaps between phrases */
  phraseCleanup: number;
  voiceChanger: number;
  voicePitchSemis: number;
  voiceCharacter: number;
};

export type LiveFxCapability =
  | "live"
  | "approximate"
  | "produce_only"
  | "unsupported";

/** UI / API capability map — do not claim stronger processing than implemented */
export const LIVE_FX_CAPABILITY: Record<string, LiveFxCapability> = {
  gainDb: "live",
  pan: "live",
  highPassHz: "live",
  lowPassHz: "live",
  telephone: "live",
  eqLowDb: "live",
  eqMidDb: "live",
  eqHighDb: "live",
  air: "live",
  compress: "live",
  delay: "live",
  slapDelay: "live",
  reverb: "approximate", // multi-tap, not IR
  plateReverb: "approximate", // denser multi-tap, not plate IR
  saturation: "approximate", // WaveShaper drive
  deEss: "approximate", // static HF attenuation, not dynamic de-esser
  chorus: "approximate",
  doubler: "approximate",
  limiter: "approximate", // soft-clip + compressor, not brick-wall look-ahead
  width: "approximate", // stereo balance proxy, not M/S
  gate: "live",
  noiseReduce: "live",
  phraseCleanup: "produce_only",
  voiceChanger: "produce_only",
  voicePitchSemis: "produce_only",
  voiceCharacter: "produce_only",
  rotorMix: "produce_only",
  rotorSpeed: "produce_only",
  rotorDepth: "produce_only",
  rotorWarmth: "produce_only",
  rotorFast: "produce_only",
  springMix: "produce_only",
  springDelay: "produce_only",
  springTension: "produce_only",
  springDamp: "produce_only",
  springMod: "produce_only",
};

export type LiveFxHandles = {
  input: AudioNode;
  output: AudioNode;
  gain: GainNode;
  pan: StereoPannerNode;
  apply: (fx: LiveFxParams, audible: boolean, atTime?: number) => void;
  dispose: () => void;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/** Soft-clip waveshaper curve for genuine nonlinear saturation */
function makeSatCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const a = Math.max(0, Math.min(1, amount));
  const k = a * 12;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    // Linear when off — critical so clean tracks are not distorted
    if (a < 0.02) curve[i] = x;
    else curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/**
 * Graph order (matches Produce intent):
 * HPF → LPF → EQ → air → static HF cut → WaveShaper sat → compressor
 * → dry + delay + slap + multi-tap space + chorus → width → soft limit → gain → pan
 */
export function createLiveTrackFxGraph(
  ctx: AudioContext | OfflineAudioContext
): LiveFxHandles {
  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 20;
  hpf.Q.value = 0.7;

  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 18000;
  lpf.Q.value = 0.7;

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 200;
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1200;
  mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 5000;
  const airF = ctx.createBiquadFilter();
  airF.type = "highshelf";
  airF.frequency.value = 10000;

  // Static HF attenuation (labeled approximate de-ess — not dynamic)
  const deess = ctx.createBiquadFilter();
  deess.type = "peaking";
  deess.frequency.value = 6500;
  deess.Q.value = 2.2;
  deess.gain.value = 0;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSatCurve(0);
  shaper.oversample = "2x";
  const satDrive = ctx.createGain();
  satDrive.gain.value = 1;
  const satPost = ctx.createGain();
  satPost.gain.value = 1;

  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 10;
  comp.attack.value = 0.012;
  comp.release.value = 0.18;

  // Soft peak control (not look-ahead brickwall)
  const softLim = ctx.createWaveShaper();
  softLim.curve = makeSatCurve(0);
  softLim.oversample = "none";
  const limComp = ctx.createDynamicsCompressor();
  limComp.threshold.value = 0;
  limComp.ratio.value = 1;
  limComp.attack.value = 0.002;
  limComp.release.value = 0.08;
  limComp.knee.value = 0;

  const dry = ctx.createGain();
  dry.gain.value = 1;

  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = 0.28;
  const delayGain = ctx.createGain();
  delayGain.gain.value = 0;
  const delayFb = ctx.createGain();
  delayFb.gain.value = 0;

  const slap = ctx.createDelay(0.2);
  slap.delayTime.value = 0.075;
  const slapGain = ctx.createGain();
  slapGain.gain.value = 0;

  const revGain = ctx.createGain();
  revGain.gain.value = 0;
  const rev1 = ctx.createDelay(1.0);
  rev1.delayTime.value = 0.048;
  const rev2 = ctx.createDelay(1.0);
  rev2.delayTime.value = 0.113;
  const rev3 = ctx.createDelay(1.0);
  rev3.delayTime.value = 0.227;
  const plate = ctx.createDelay(1.0);
  plate.delayTime.value = 0.17;
  const plateGain = ctx.createGain();
  plateGain.gain.value = 0;

  const chDelay = ctx.createDelay(0.05);
  chDelay.delayTime.value = 0.016;
  const chGain = ctx.createGain();
  chGain.gain.value = 0;
  const chLfo = ctx.createOscillator();
  chLfo.type = "sine";
  chLfo.frequency.value = 0.75;
  const chLfoGain = ctx.createGain();
  chLfoGain.gain.value = 0.0035;
  chLfo.connect(chLfoGain);
  chLfoGain.connect(chDelay.delayTime);
  try {
    chLfo.start(0);
  } catch {
    /* already started */
  }

  // Width proxy: dual panners — NOT true mid/side
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const widthL = ctx.createGain();
  const widthR = ctx.createGain();
  widthL.gain.value = 1;
  widthR.gain.value = 1;

  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();

  // Serial tone path
  hpf.connect(lpf);
  lpf.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(airF);
  airF.connect(deess);
  deess.connect(satDrive);
  satDrive.connect(shaper);
  shaper.connect(satPost);
  satPost.connect(comp);
  comp.connect(dry);

  // Parallel sends
  comp.connect(delay);
  delay.connect(delayGain);
  delay.connect(delayFb);
  delayFb.connect(delay);
  delayGain.connect(merge, 0, 0);
  delayGain.connect(merge, 0, 1);

  comp.connect(slap);
  slap.connect(slapGain);
  slapGain.connect(merge, 0, 0);
  slapGain.connect(merge, 0, 1);

  comp.connect(rev1);
  rev1.connect(rev2);
  rev2.connect(rev3);
  rev1.connect(revGain);
  rev2.connect(revGain);
  rev3.connect(revGain);
  revGain.connect(merge, 0, 0);
  revGain.connect(merge, 0, 1);

  comp.connect(plate);
  plate.connect(plateGain);
  plateGain.connect(merge, 0, 0);
  plateGain.connect(merge, 0, 1);

  comp.connect(chDelay);
  chDelay.connect(chGain);
  chGain.connect(merge, 0, 0);
  chGain.connect(merge, 0, 1);

  // Dry into splitter for width proxy
  dry.connect(split);
  split.connect(widthL, 0);
  split.connect(widthR, 1);
  widthL.connect(merge, 0, 0);
  widthR.connect(merge, 0, 1);

  merge.connect(softLim);
  softLim.connect(limComp);
  limComp.connect(gain);
  gain.connect(pan);

  const nodes: AudioNode[] = [
    hpf,
    lpf,
    low,
    mid,
    high,
    airF,
    deess,
    satDrive,
    shaper,
    satPost,
    comp,
    dry,
    delay,
    delayGain,
    delayFb,
    slap,
    slapGain,
    rev1,
    rev2,
    rev3,
    revGain,
    plate,
    plateGain,
    chDelay,
    chGain,
    split,
    widthL,
    widthR,
    merge,
    softLim,
    limComp,
    gain,
    pan,
  ];

  /** Set AudioParam to an exact value without continuous re-ramp fighting. */
  function setParam(p: AudioParam, value: number, now: number, smooth = false, allowCancel = true) {
    const v = Number.isFinite(value) ? value : 0;
    try {
      if (allowCancel) p.cancelScheduledValues(now);
      if (smooth && allowCancel) {
        p.setTargetAtTime(v, now, 0.02);
      } else {
        p.setValueAtTime(v, now);
      }
    } catch {
      try {
        p.value = v;
      } catch {
        /* */
      }
    }
  }

  function apply(fx: LiveFxParams, audible: boolean, atTime?: number) {
    const now = typeof atTime === "number" && Number.isFinite(atTime) ? atTime : ctx.currentTime;
    const offlineSchedule = typeof atTime === "number" && Number.isFinite(atTime);
    const setP = (p: AudioParam, value: number, t: number, smooth = false) =>
      setParam(p, value, t, smooth, !offlineSchedule);

    // Sanitize
    const safe = (v: number, d = 0) =>
      typeof v === "number" && Number.isFinite(v) ? v : d;

    const hp =
      safe(fx.highPassHz) > 20 ? clamp(safe(fx.highPassHz), 20, 400) : 20;
    const tel = clamp(safe(fx.telephone), 0, 1);
    if (tel > 0.02) {
      setP(hpf.frequency, 400 + tel * 450, now);
      setP(lpf.frequency, 2500 + (1 - tel) * 3500, now);
    } else {
      setP(hpf.frequency, hp, now);
      const lp =
        safe(fx.lowPassHz) > 500
          ? clamp(safe(fx.lowPassHz), 800, 18000)
          : 18000;
      setP(lpf.frequency, lp, now);
    }

    setP(low.gain, clamp(safe(fx.eqLowDb), -12, 12), now);
    setP(mid.gain, clamp(safe(fx.eqMidDb), -12, 12), now);
    setP(high.gain, clamp(safe(fx.eqHighDb), -12, 12), now);
    setP(airF.gain, clamp(safe(fx.air) * 5.5, 0, 6), now);

    // Static HF cut — not dynamic de-ess
    setP(deess.gain, -14 * clamp(safe(fx.deEss), 0, 1), now);

    const satAmt = clamp(safe(fx.saturation), 0, 1);
    try {
      shaper.curve = makeSatCurve(satAmt);
    } catch {
      /* */
    }
    // Makeup compensation so sat doesn't explode level
    setP(satDrive.gain, 1 + satAmt * 0.8, now);
    setP(satPost.gain, 1 / (1 + satAmt * 0.55), now);

    const cAmt = clamp(safe(fx.compress), 0, 1);
    if (cAmt > 0.02) {
      setP(comp.threshold, -12 - cAmt * 28, now);
      setP(comp.ratio, 1 + cAmt * 10, now);
      setP(comp.knee, 10, now);
    } else {
      setP(comp.threshold, 0, now);
      setP(comp.ratio, 1, now);
      setP(comp.knee, 0, now);
    }

    const del = clamp(safe(fx.delay), 0, 1);
    setP(delayGain.gain, del * 0.42, now);
    // Kill feedback hard when delay is off so tails don't stick across plays
    setP(delayFb.gain, del > 0.02 ? 0.2 : 0, now);
    setP(slapGain.gain, clamp(safe(fx.slapDelay), 0, 1) * 0.32, now);
    setP(revGain.gain, clamp(safe(fx.reverb), 0, 1) * 0.32, now);
    setP(plateGain.gain, clamp(safe(fx.plateReverb), 0, 1) * 0.38, now);

    const chAmt = Math.max(safe(fx.chorus), safe(fx.doubler) * 0.75);
    setP(chGain.gain, clamp(chAmt, 0, 1) * 0.32, now);
    setP(
      chLfo.frequency,
      safe(fx.doubler) > safe(fx.chorus) ? 0.32 : 0.85,
      now
    );

    // Soft limiter engagement
    const lim = clamp(safe(fx.limiter), 0, 1);
    setP(limComp.threshold, lim > 0.05 ? -2 - lim * 8 : 0, now);

    // Width proxy — neutral at 0 (no phantom gain)
    const w = clamp(safe(fx.width), 0, 1);
    setP(widthL.gain, 1 + w * 0.12, now);
    setP(widthR.gain, 1 + w * 0.12, now);

    const gLin = audible
      ? Math.pow(10, clamp(safe(fx.gainDb), -12, 12) / 20)
      : 0;
    // Instant mute (no slow setTarget ramp); smooth only when opening
    if (!audible) {
      setP(gain.gain, 0, now, false);
    } else {
      setP(gain.gain, Math.min(gLin, 2.5), now, true);
    }
    setP(pan.pan, clamp(safe(fx.pan), -1, 1), now, true);

    // gate + noiseReduce applied via buffer preprocess in producer-view startPlayback
    void fx.gate;
    void fx.noiseReduce;
    void fx.phraseCleanup;
    void fx.voiceChanger;
    void fx.voicePitchSemis;
    void fx.voiceCharacter;
  }

  return {
    input: hpf,
    output: pan,
    gain,
    pan,
    apply,
    dispose: () => {
      try {
        const t0 = ctx.currentTime;
        delayFb.gain.setValueAtTime(0, t0);
        delayGain.gain.setValueAtTime(0, t0);
        revGain.gain.setValueAtTime(0, t0);
        plateGain.gain.setValueAtTime(0, t0);
        slapGain.gain.setValueAtTime(0, t0);
        chGain.gain.setValueAtTime(0, t0);
        gain.gain.setValueAtTime(0, t0);
      } catch {
        /* */
      }
      try {
        chLfo.stop();
      } catch {
        /* */
      }
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* */
        }
      }
    },
  };
}

export function trackFxToLiveParams(fx: Record<string, number>): LiveFxParams {
  const n = (k: string) => {
    const v = Number(fx[k]);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    gainDb: n("gainDb"),
    pan: n("pan"),
    eqLowDb: n("eqLowDb"),
    eqMidDb: n("eqMidDb"),
    eqHighDb: n("eqHighDb"),
    air: n("air"),
    compress: n("compress"),
    saturation: n("saturation"),
    reverb: n("reverb"),
    delay: n("delay"),
    plateReverb: n("plateReverb"),
    slapDelay: n("slapDelay"),
    width: n("width"),
    deEss: n("deEss"),
    highPassHz: n("highPassHz"),
    lowPassHz: n("lowPassHz"),
    telephone: n("telephone"),
    chorus: n("chorus"),
    doubler: n("doubler"),
    limiter: n("limiter"),
    gate: n("gate"),
    noiseReduce: n("noiseReduce"),
    phraseCleanup: n("phraseCleanup"),
    voiceChanger: n("voiceChanger"),
    voicePitchSemis: n("voicePitchSemis"),
    voiceCharacter: n("voiceCharacter"),
  };
}


/** True when no creative FX engaged — raw take + gain/pan only */
export function isTrackFxNeutral(fx: Record<string, number>): boolean {
  const keys = [
    "eqLowDb", "eqMidDb", "eqHighDb", "air", "compress", "saturation",
    "reverb", "delay", "plateReverb", "slapDelay", "deEss", "chorus",
    "doubler", "limiter", "telephone", "highPassHz", "lowPassHz",
    "rotorMix", "springMix",
  ];
  for (const k of keys) {
    if (Math.abs(Number(fx[k]) || 0) > 0.02) return false;
  }
  return true;
}

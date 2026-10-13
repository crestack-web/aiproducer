/**
 * Live Web Audio Track FX graph — parameter ranges match TrackFx / applyConsoleTrackFx.
 * Built once per play start; parameters updated via setLiveTrackFx without rebuilding.
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
  gate: number;
};

export type LiveFxHandles = {
  input: AudioNode;
  output: AudioNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** Call on every fxById change while playing */
  apply: (fx: LiveFxParams, audible: boolean) => void;
  dispose: () => void;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/**
 * Graph (approx Produce order):
 * src → HPF → LPF/telephone → EQ (low/mid/high/air) → sat pre → compressor
 *   → dry + delay + slap + multi-tap reverb/plate + chorus taps → width → gain → pan → out
 */
export function createLiveTrackFxGraph(ctx: AudioContext): LiveFxHandles {
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
  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 10000;

  // De-ess: dynamic-ish via peaking cut (static amount driven by param)
  const deess = ctx.createBiquadFilter();
  deess.type = "peaking";
  deess.frequency.value = 6500;
  deess.Q.value = 2.5;

  const satPre = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;

  const dry = ctx.createGain();
  const delay = ctx.createDelay(1.2);
  delay.delayTime.value = 0.28;
  const delayGain = ctx.createGain();
  const delayFb = ctx.createGain();
  delayFb.gain.value = 0.22;

  const slap = ctx.createDelay(0.2);
  slap.delayTime.value = 0.075;
  const slapGain = ctx.createGain();

  const revGain = ctx.createGain();
  const rev1 = ctx.createDelay(1.0);
  rev1.delayTime.value = 0.05;
  const rev2 = ctx.createDelay(1.0);
  rev2.delayTime.value = 0.12;
  const rev3 = ctx.createDelay(1.0);
  rev3.delayTime.value = 0.23;
  const plateExtra = ctx.createDelay(1.0);
  plateExtra.delayTime.value = 0.18;
  const plateGain = ctx.createGain();

  // Chorus / doubler: short modulated delays
  const chDelay = ctx.createDelay(0.05);
  chDelay.delayTime.value = 0.018;
  const chGain = ctx.createGain();
  const chLfo = ctx.createOscillator();
  chLfo.frequency.value = 0.8;
  const chLfoGain = ctx.createGain();
  chLfoGain.gain.value = 0.004;
  chLfo.connect(chLfoGain);
  chLfoGain.connect(chDelay.delayTime);
  try {
    chLfo.start();
  } catch {
    /* */
  }

  const widthGain = ctx.createGain();
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner();

  // Wire serial path
  hpf.connect(lpf);
  lpf.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(air);
  air.connect(deess);
  deess.connect(satPre);
  satPre.connect(comp);
  comp.connect(dry);
  dry.connect(widthGain);

  // Sends from compressor
  comp.connect(delay);
  delay.connect(delayGain);
  delay.connect(delayFb);
  delayFb.connect(delay);
  delayGain.connect(widthGain);

  comp.connect(slap);
  slap.connect(slapGain);
  slapGain.connect(widthGain);

  comp.connect(rev1);
  rev1.connect(rev2);
  rev2.connect(rev3);
  rev1.connect(revGain);
  rev2.connect(revGain);
  rev3.connect(revGain);
  revGain.connect(widthGain);

  comp.connect(plateExtra);
  plateExtra.connect(plateGain);
  plateGain.connect(widthGain);

  comp.connect(chDelay);
  chDelay.connect(chGain);
  chGain.connect(widthGain);

  widthGain.connect(limiter);
  limiter.connect(gain);
  gain.connect(pan);

  const t0 = () => ctx.currentTime;

  function apply(fx: LiveFxParams, audible: boolean) {
    const now = t0();
    const ramp = 0.03;

    // Filters
    const hp = fx.highPassHz > 20 ? clamp(fx.highPassHz, 20, 400) : 20;
    hpf.frequency.setTargetAtTime(hp, now, ramp);
    if (fx.telephone > 0.02) {
      hpf.frequency.setTargetAtTime(400 + fx.telephone * 400, now, ramp);
      lpf.frequency.setTargetAtTime(2800 + (1 - fx.telephone) * 4000, now, ramp);
    } else {
      const lp = fx.lowPassHz > 500 ? clamp(fx.lowPassHz, 800, 18000) : 18000;
      lpf.frequency.setTargetAtTime(lp, now, ramp);
    }

    low.gain.setTargetAtTime(fx.eqLowDb || 0, now, ramp);
    mid.gain.setTargetAtTime(fx.eqMidDb || 0, now, ramp);
    high.gain.setTargetAtTime(fx.eqHighDb || 0, now, ramp);
    air.gain.setTargetAtTime(clamp((fx.air || 0) * 5.5, 0, 6), now, ramp);
    deess.gain.setTargetAtTime(-12 * clamp(fx.deEss || 0, 0, 1), now, ramp);

    const cAmt = clamp(fx.compress || 0, 0, 1);
    comp.threshold.setTargetAtTime(-10 - cAmt * 30, now, ramp);
    comp.ratio.setTargetAtTime(1 + cAmt * 11, now, ramp);

    satPre.gain.setTargetAtTime(1 + clamp(fx.saturation || 0, 0, 1) * 1.5, now, ramp);

    delayGain.gain.setTargetAtTime(clamp(fx.delay || 0, 0, 1) * 0.45, now, ramp);
    slapGain.gain.setTargetAtTime(clamp(fx.slapDelay || 0, 0, 1) * 0.35, now, ramp);
    revGain.gain.setTargetAtTime(clamp(fx.reverb || 0, 0, 1) * 0.35, now, ramp);
    plateGain.gain.setTargetAtTime(clamp(fx.plateReverb || 0, 0, 1) * 0.4, now, ramp);

    const chAmt = Math.max(fx.chorus || 0, (fx.doubler || 0) * 0.7);
    chGain.gain.setTargetAtTime(clamp(chAmt, 0, 1) * 0.35, now, ramp);
    chLfo.frequency.setTargetAtTime(fx.doubler > fx.chorus ? 0.35 : 0.85, now, ramp);

    // Limiter engage
    const lim = clamp(fx.limiter || 0, 0, 1);
    limiter.threshold.setTargetAtTime(lim > 0.05 ? -3 - lim * 6 : 0, now, ramp);

    // Width: approximate with slight mid gain (true MS needs ChannelSplitter)
    widthGain.gain.setTargetAtTime(1 + clamp(fx.width || 0, 0, 1) * 0.15, now, ramp);

    const gLin = audible ? Math.pow(10, clamp(fx.gainDb || 0, -12, 12) / 20) : 0;
    gain.gain.setTargetAtTime(gLin, now, ramp);
    pan.pan.setTargetAtTime(clamp(fx.pan || 0, -1, 1), now, ramp);
  }

  return {
    input: hpf,
    output: pan,
    gain,
    pan,
    apply,
    dispose: () => {
      try {
        chLfo.stop();
      } catch {
        /* */
      }
      try {
        hpf.disconnect();
        pan.disconnect();
      } catch {
        /* */
      }
    },
  };
}

export function trackFxToLiveParams(fx: Record<string, number>): LiveFxParams {
  return {
    gainDb: Number(fx.gainDb) || 0,
    pan: Number(fx.pan) || 0,
    eqLowDb: Number(fx.eqLowDb) || 0,
    eqMidDb: Number(fx.eqMidDb) || 0,
    eqHighDb: Number(fx.eqHighDb) || 0,
    air: Number(fx.air) || 0,
    compress: Number(fx.compress) || 0,
    saturation: Number(fx.saturation) || 0,
    reverb: Number(fx.reverb) || 0,
    delay: Number(fx.delay) || 0,
    plateReverb: Number(fx.plateReverb) || 0,
    slapDelay: Number(fx.slapDelay) || 0,
    width: Number(fx.width) || 0,
    deEss: Number(fx.deEss) || 0,
    highPassHz: Number(fx.highPassHz) || 0,
    lowPassHz: Number(fx.lowPassHz) || 0,
    telephone: Number(fx.telephone) || 0,
    chorus: Number(fx.chorus) || 0,
    doubler: Number(fx.doubler) || 0,
    limiter: Number(fx.limiter) || 0,
    gate: Number(fx.gate) || 0,
  };
}

/**
 * Shared Console transport — AudioContext clock, buffer cache, multi-solo mixer.
 * Used by Producer View for playback and overdub monitoring.
 *
 * Authoritative time: AudioContext.currentTime + song epoch.
 * Do not drive song position from independent setInterval clocks.
 */
import { CAPTURE_PIPELINE_LATENCY_MS } from "@/lib/audio/session-timeline";

export type TransportState =
  | "stopped"
  | "preparing"
  | "ready"
  | "playing"
  | "paused";

export type TransportClipSpec = {
  clipId: string;
  trackId: string;
  kind: "beat" | "vocal";
  startMs: number;
  endMs: number;
  offsetMs: number;
  /** Primary fetch URL (prefer same-origin proxy) */
  url: string;
  fallbackUrl?: string | null;
};

export type DecodeFn = (
  ctx: AudioContext,
  url: string,
  fallback?: string | null
) => Promise<AudioBuffer | null>;

type ActiveSource = {
  source: AudioBufferSourceNode;
  trackId: string;
};

/** Module-level buffer cache shared across transport instances in one page session */
const sharedBufferCache = new Map<string, AudioBuffer>();

export function getSharedBufferCache(): Map<string, AudioBuffer> {
  return sharedBufferCache;
}

export function cacheAudioBuffer(url: string, buf: AudioBuffer): void {
  if (url && buf) sharedBufferCache.set(url, buf);
}

export function getCachedBuffer(url: string | null | undefined): AudioBuffer | null {
  if (!url) return null;
  return sharedBufferCache.get(url) || null;
}

export type MixerSnapshot = {
  muted: Set<string>;
  /** Empty = no solo; non-empty = only these track ids audible */
  soloed: Set<string>;
  gainDb: Map<string, number>;
};

export function isTrackAudible(
  trackId: string,
  mixer: MixerSnapshot
): boolean {
  if (mixer.muted.has(trackId)) return false;
  if (mixer.soloed.size > 0) return mixer.soloed.has(trackId);
  return true;
}

/**
 * Configurable capture compensation (ms). Prefer env override; default from session-timeline.
 * Positive value shifts recorded takes earlier on the timeline.
 */
export function getCaptureLatencyCompMs(): number {
  const env = Number(process.env.NEXT_PUBLIC_CAPTURE_LATENCY_COMP_MS);
  if (Number.isFinite(env) && env >= 0 && env <= 250) return env;
  return CAPTURE_PIPELINE_LATENCY_MS;
}

export class ConsoleTransport {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private trackGains = new Map<string, GainNode>();
  private sources: ActiveSource[] = [];
  private gen = 0;
  private state: TransportState = "stopped";
  private epochCtx = 0;
  private epochSongMs = 0;
  private pausedSongMs = 0;
  private loopRange: { startMs: number; endMs: number } | null = null;
  private raf = 0;
  private onTick: ((songMs: number) => void) | null = null;
  private onState: ((s: TransportState) => void) | null = null;
  private mixer: MixerSnapshot = {
    muted: new Set(),
    soloed: new Set(),
    gainDb: new Map(),
  };

  setOnTick(fn: ((songMs: number) => void) | null) {
    this.onTick = fn;
  }
  setOnState(fn: ((s: TransportState) => void) | null) {
    this.onState = fn;
  }

  getState(): TransportState {
    return this.state;
  }

  private setState(s: TransportState) {
    this.state = s;
    this.onState?.(s);
  }

  getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  getMaster(): GainNode | null {
    this.getContext();
    return this.master;
  }

  async resume(): Promise<void> {
    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* */
      }
    }
  }

  /** Song time in ms from transport epoch (AudioContext clock). */
  getSongTimeMs(): number {
    if (this.state === "paused" || this.state === "stopped") {
      return this.pausedSongMs;
    }
    if (this.state !== "playing" || !this.ctx) return this.epochSongMs;
    const elapsed = (this.ctx.currentTime - this.epochCtx) * 1000;
    return Math.max(0, this.epochSongMs + elapsed);
  }

  setLoop(range: { startMs: number; endMs: number } | null) {
    this.loopRange = range;
  }

  setMuted(trackId: string, muted: boolean) {
    if (muted) this.mixer.muted.add(trackId);
    else this.mixer.muted.delete(trackId);
    this.applyMixerToGains();
  }

  /** Multi-solo: toggle membership. Empty set = solo off for all. */
  toggleSolo(trackId: string) {
    if (this.mixer.soloed.has(trackId)) this.mixer.soloed.delete(trackId);
    else this.mixer.soloed.add(trackId);
    this.applyMixerToGains();
  }

  setSoloed(ids: string[]) {
    this.mixer.soloed = new Set(ids);
    this.applyMixerToGains();
  }

  clearSolo() {
    this.mixer.soloed.clear();
    this.applyMixerToGains();
  }

  getSoloed(): string[] {
    return [...this.mixer.soloed];
  }

  getMuted(): string[] {
    return [...this.mixer.muted];
  }

  isAudible(trackId: string): boolean {
    return isTrackAudible(trackId, this.mixer);
  }

  setTrackGainDb(trackId: string, gainDb: number) {
    this.mixer.gainDb.set(trackId, gainDb);
    const g = this.trackGains.get(trackId);
    const ctx = this.ctx;
    if (g && ctx) {
      const on = this.isAudible(trackId);
      const lin = on
        ? Math.pow(10, Math.max(-24, Math.min(12, gainDb)) / 20)
        : 0;
      try {
        g.gain.setTargetAtTime(lin, ctx.currentTime, 0.02);
      } catch {
        g.gain.value = lin;
      }
    }
  }

  private ensureTrackGain(trackId: string): GainNode {
    const ctx = this.getContext()!;
    let g = this.trackGains.get(trackId);
    if (!g) {
      g = ctx.createGain();
      g.connect(this.master!);
      this.trackGains.set(trackId, g);
    }
    return g;
  }

  private applyMixerToGains() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [trackId, g] of this.trackGains) {
      const on = this.isAudible(trackId);
      const gainDb = this.mixer.gainDb.get(trackId) ?? 0;
      const lin = on
        ? Math.pow(10, Math.max(-24, Math.min(12, gainDb)) / 20)
        : 0;
      try {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setValueAtTime(lin, ctx.currentTime);
      } catch {
        g.gain.value = lin;
      }
    }
  }

  /**
   * Decode and cache clips. Sets state preparing → ready|stopped.
   * Does not start playback.
   */
  async prepare(
    specs: TransportClipSpec[],
    decode: DecodeFn
  ): Promise<{ ready: number; failed: number }> {
    const ctx = this.getContext();
    if (!ctx) return { ready: 0, failed: specs.length };
    this.setState("preparing");
    await this.resume();
    let ready = 0;
    let failed = 0;
    await Promise.all(
      specs.map(async (spec) => {
        if (sharedBufferCache.has(spec.url)) {
          ready++;
          return;
        }
        if (spec.fallbackUrl && sharedBufferCache.has(spec.fallbackUrl)) {
          sharedBufferCache.set(
            spec.url,
            sharedBufferCache.get(spec.fallbackUrl)!
          );
          ready++;
          return;
        }
        const buf = await decode(ctx, spec.url, spec.fallbackUrl ?? null);
        if (buf) {
          sharedBufferCache.set(spec.url, buf);
          if (spec.fallbackUrl) sharedBufferCache.set(spec.fallbackUrl, buf);
          ready++;
        } else failed++;
      })
    );
    this.setState(ready > 0 || specs.length === 0 ? "ready" : "stopped");
    return { ready, failed };
  }

  private stopSourcesOnly() {
    for (const { source } of this.sources) {
      try {
        source.stop();
      } catch {
        /* */
      }
      try {
        source.disconnect();
      } catch {
        /* */
      }
    }
    this.sources = [];
  }

  private stopRaf() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private tick = () => {
    if (this.state !== "playing") {
      this.raf = 0;
      return;
    }
    let ms = this.getSongTimeMs();
    if (this.loopRange && ms >= this.loopRange.endMs) {
      void this.play(this.loopRange.startMs, null);
      return;
    }
    this.onTick?.(ms);
    this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * Schedule all clips from song position `fromMs`.
   * `connectNode(trackId)` optional: return a node to play through (e.g. FX graph input);
   * otherwise uses per-track gain → master.
   *
   * If `specs` is null, only restarts the clock (used for loop) — caller should pass specs.
   */
  async play(
    fromMs: number,
    specs: TransportClipSpec[] | null,
    opts?: {
      connectNode?: (trackId: string) => AudioNode | null;
      /** When true, require at least beat buffer before advancing playhead (readiness) */
      waitForEssential?: boolean;
      essentialTrackIds?: string[];
      decode?: DecodeFn;
    }
  ): Promise<void> {
    const ctx = this.getContext();
    if (!ctx || !this.master) return;
    const gen = ++this.gen;
    await this.resume();
    if (gen !== this.gen) return;

    this.stopSourcesOnly();
    this.stopRaf();

    const startMs = Math.max(0, fromMs);

    // Optional prepare essential assets before moving playhead
    if (specs && opts?.waitForEssential && opts.decode) {
      this.setState("preparing");
      const essential = specs.filter(
        (s) =>
          !opts.essentialTrackIds ||
          opts.essentialTrackIds.includes(s.trackId) ||
          s.kind === "beat"
      );
      await this.prepare(essential, opts.decode);
      if (gen !== this.gen) return;
    }

    this.epochSongMs = startMs;
    this.epochCtx = ctx.currentTime;
    this.pausedSongMs = startMs;
    this.setState("playing");
    this.raf = requestAnimationFrame(this.tick);

    if (!specs || specs.length === 0) return;

    const startSec = startMs / 1000;
    const t0 = this.epochCtx;

    // Schedule: prefer already-cached; decode missing in parallel then start
    await Promise.all(
      specs.map(async (spec) => {
        if (gen !== this.gen) return;
        let buf =
          sharedBufferCache.get(spec.url) ||
          (spec.fallbackUrl
            ? sharedBufferCache.get(spec.fallbackUrl)
            : undefined) ||
          null;
        if (!buf && opts?.decode) {
          buf = await opts.decode(ctx, spec.url, spec.fallbackUrl ?? null);
          if (buf) {
            sharedBufferCache.set(spec.url, buf);
            if (spec.fallbackUrl) sharedBufferCache.set(spec.fallbackUrl, buf);
          }
        }
        if (!buf || gen !== this.gen) return;
        if (!this.isAudible(spec.trackId)) {
          // Still create silent path so later unmute can work only after reschedule —
          // for live unmute without reschedule we need a gain node. Create gain at 0.
        }

        const trackGain = this.ensureTrackGain(spec.trackId);
        const gainDb = this.mixer.gainDb.get(spec.trackId) ?? 0;
        const on = this.isAudible(spec.trackId);
        trackGain.gain.value = on
          ? Math.pow(10, Math.max(-24, Math.min(12, gainDb)) / 20)
          : 0;

        const dest = opts?.connectNode?.(spec.trackId) || trackGain;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        try {
          src.connect(dest);
        } catch {
          src.connect(trackGain);
        }

        const songNow = startSec + Math.max(0, ctx.currentTime - t0);

        if (spec.kind === "vocal") {
          const layerStart = spec.startMs / 1000;
          const layerEnd = Math.max(layerStart + 0.05, spec.endMs / 1000);
          const mediaOff = Math.max(0, spec.offsetMs / 1000);
          const clipDur = Math.max(0.05, layerEnd - layerStart);
          if (songNow >= layerEnd) return;
          if (songNow >= layerStart) {
            const into = mediaOff + (songNow - layerStart);
            const remain = Math.max(0.05, layerEnd - songNow);
            if (into >= buf.duration) return;
            src.start(
              ctx.currentTime,
              into,
              Math.min(remain, buf.duration - into)
            );
          } else {
            const when = t0 + (layerStart - startSec);
            src.start(
              Math.max(ctx.currentTime, when),
              mediaOff,
              Math.min(clipDur, buf.duration - mediaOff)
            );
          }
        } else {
          if (songNow >= buf.duration) return;
          src.start(ctx.currentTime, songNow);
        }
        this.sources.push({ source: src, trackId: spec.trackId });
      })
    );
  }

  pause() {
    if (this.state !== "playing") return;
    this.pausedSongMs = this.getSongTimeMs();
    this.stopSourcesOnly();
    this.stopRaf();
    this.setState("paused");
    this.onTick?.(this.pausedSongMs);
  }

  stop() {
    this.gen++;
    this.stopSourcesOnly();
    this.stopRaf();
    this.pausedSongMs = 0;
    this.epochSongMs = 0;
    this.setState("stopped");
    this.onTick?.(0);
  }

  /** Pause without resetting position (for UI freezes). */
  freezePosition(): number {
    const ms = this.getSongTimeMs();
    this.pause();
    return ms;
  }
}

/** Singleton for the Console session (one per page). */
let singleton: ConsoleTransport | null = null;

export function getConsoleTransport(): ConsoleTransport {
  if (!singleton) singleton = new ConsoleTransport();
  return singleton;
}

export function resetConsoleTransportForTests() {
  singleton?.stop();
  singleton = null;
  sharedBufferCache.clear();
}

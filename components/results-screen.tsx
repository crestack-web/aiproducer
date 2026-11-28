"use client";

/**
 * Results screen — the moment after Produce that turns a finished song into a paid download.
 * - Plays the chorus first (one-bar lead-in), falling back to the loudest 20 s.
 * - "Your take" / "Produced by AP" switch, sample-locked and loudness-matched.
 * - Streaming quality badge measured on the actual master (BS.1770 LUFS, true peak, clipping).
 * - $4.99 unlock card; downloads only after payment.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { SESSION_PRICE_USD } from "@/lib/plans";
import {
  loudnessMatchGain,
  measureQualityBadge,
  pcmFromAudioBuffer,
  resolveStartSec,
  type QualityBadge,
  type ResultsLayer,
} from "@/lib/results/analysis";
import { measureIntegratedLufs } from "@/lib/ap-engine/master/lufs";

type Mode = "produced" | "raw";

export type ResultsScreenProps = {
  projectId: string;
  title: string;
  masterUrl: string;
  downloadUnlocked: boolean;
  onUnlock: () => void;
  onDownload: () => void;
};

const GOLD = "#CD8921";
const CROSSFADE_S = 0.08;

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

async function fetchDecode(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`audio ${res.status}`);
  const ab = await res.arrayBuffer();
  return await ctx.decodeAudioData(ab);
}

/** Render beat + raw takes at their placements into one buffer the length of the master. */
async function renderRawMix(opts: {
  ctx: AudioContext;
  beatUrl: string | null;
  layers: ResultsLayer[];
  durationSec: number;
  sampleRate: number;
}): Promise<AudioBuffer | null> {
  const takes = opts.layers.filter((l) => l.audio_url);
  if (!takes.length) return null;
  const length = Math.max(1, Math.ceil(opts.durationSec * opts.sampleRate));
  const off = new OfflineAudioContext(2, length, opts.sampleRate);
  const decoded = await Promise.all(
    [opts.beatUrl, ...takes.map((t) => t.audio_url as string)].map((u) =>
      u ? fetchDecode(opts.ctx, u).catch(() => null) : Promise.resolve(null)
    )
  );
  const [beatBuf, ...takeBufs] = decoded;
  if (!takeBufs.some(Boolean)) return null;
  if (beatBuf) {
    const s = off.createBufferSource();
    s.buffer = beatBuf;
    s.connect(off.destination);
    s.start(0);
  }
  takeBufs.forEach((b, i) => {
    if (!b) return;
    const s = off.createBufferSource();
    s.buffer = b;
    s.connect(off.destination);
    const startSec = Math.max(0, (takes[i].start_ms || 0) / 1000);
    if (startSec < opts.durationSec) s.start(startSec);
  });
  return await off.startRendering();
}

export function ResultsScreen(props: ResultsScreenProps) {
  const { projectId, title, masterUrl, downloadUnlocked, onUnlock, onDownload } = props;
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<AudioBuffer | null>(null);
  const rawRef = useRef<AudioBuffer | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<{ produced: GainNode; raw: GainNode } | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const rawGainRef = useRef(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawReady, setRawReady] = useState(false);
  const [mode, setMode] = useState<Mode>("produced");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cue, setCue] = useState<{ startSec: number; from: "chorus" | "loudest" | "start" }>({
    startSec: 0,
    from: "start",
  });
  const [hasPlayed, setHasPlayed] = useState(false);
  const [chorusDone, setChorusDone] = useState(false);
  const [badge, setBadge] = useState<QualityBadge | null>(null);
  const [badgeOpen, setBadgeOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const stopSources = useCallback(() => {
    for (const s of sourcesRef.current) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = [];
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // Load master, measure badge, find chorus, then build the raw comparison in the background.
  useEffect(() => {
    let cancelled = false;
    const Ctor: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) {
      setError("Audio playback isn't supported in this browser.");
      setLoading(false);
      return;
    }
    const ctx = new Ctor();
    ctxRef.current = ctx;
    (async () => {
      try {
        const [master, preview] = await Promise.all([
          fetchDecode(ctx, masterUrl),
          fetch(`/api/projects/${projectId}/session-preview`, { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        if (cancelled) return;
        masterRef.current = master;
        setDuration(master.duration);
        const pcm = pcmFromAudioBuffer(master);
        const layers: ResultsLayer[] = Array.isArray(preview?.layers) ? preview.layers : [];
        const bpm: number | null = typeof preview?.bpm === "number" ? preview.bpm : null;
        const c = resolveStartSec({ pcm, layers, bpm });
        setCue(c);
        offsetRef.current = c.startSec;
        setPosition(c.startSec);
        setLoading(false);
        // Badge can take a moment on long songs — run after first paint
        setTimeout(() => {
          if (cancelled) return;
          try {
            setBadge(measureQualityBadge(pcm));
          } catch {
            setBadge(null);
          }
        }, 50);
        const raw = await renderRawMix({
          ctx,
          beatUrl: typeof preview?.beat_url === "string" ? preview.beat_url : null,
          layers,
          durationSec: master.duration,
          sampleRate: master.sampleRate,
        }).catch(() => null);
        if (cancelled || !raw) return;
        rawRef.current = raw;
        rawGainRef.current = loudnessMatchGain(pcmFromAudioBuffer(raw), measureIntegratedLufs(pcm));
        setRawReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load your song");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      stopSources();
      void ctx.close().catch(() => undefined);
    };
  }, [masterUrl, projectId, stopSources]);

  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const pos = ctx.currentTime - startedAtRef.current;
    setPosition(pos);
    if (!chorusDone && cue.from === "chorus" && pos > cue.startSec + 25) setChorusDone(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [chorusDone, cue]);

  const play = useCallback(
    async (fromSec?: number) => {
      const ctx = ctxRef.current;
      const master = masterRef.current;
      if (!ctx || !master) return;
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      stopSources();
      const offset = Math.max(0, Math.min(master.duration - 0.05, fromSec ?? offsetRef.current));
      const gP = ctx.createGain();
      const gR = ctx.createGain();
      gP.gain.value = mode === "produced" || !rawRef.current ? 1 : 0;
      gR.gain.value = mode === "raw" && rawRef.current ? rawGainRef.current : 0;
      gP.connect(ctx.destination);
      gR.connect(ctx.destination);
      gainsRef.current = { produced: gP, raw: gR };
      const sP = ctx.createBufferSource();
      sP.buffer = master;
      sP.connect(gP);
      const srcs = [sP];
      if (rawRef.current) {
        const sR = ctx.createBufferSource();
        sR.buffer = rawRef.current;
        sR.connect(gR);
        srcs.push(sR);
      }
      const when = ctx.currentTime + 0.03;
      for (const s of srcs) s.start(when, offset);
      sP.onended = () => {
        setPlaying(false);
        offsetRef.current = 0;
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      };
      sourcesRef.current = srcs;
      startedAtRef.current = when - offset;
      setPlaying(true);
      setHasPlayed(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [mode, stopSources, tick]
  );

  const pause = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    offsetRef.current = Math.max(0, ctx.currentTime - startedAtRef.current);
    stopSources();
    setPlaying(false);
  }, [stopSources]);

  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      setMode(next);
      setShowHint(false);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* no haptics */
      }
      const ctx = ctxRef.current;
      const g = gainsRef.current;
      if (!ctx || !g) return;
      const t = ctx.currentTime;
      const targetP = next === "produced" ? 1 : 0;
      const targetR = next === "raw" ? rawGainRef.current : 0;
      g.produced.gain.cancelScheduledValues(t);
      g.raw.gain.cancelScheduledValues(t);
      g.produced.gain.setValueAtTime(g.produced.gain.value, t);
      g.raw.gain.setValueAtTime(g.raw.gain.value, t);
      g.produced.gain.linearRampToValueAtTime(targetP, t + CROSSFADE_S);
      g.raw.gain.linearRampToValueAtTime(targetR, t + CROSSFADE_S);
    },
    [mode]
  );

  // One-time hint 3 s after the chorus starts playing
  useEffect(() => {
    if (!playing || !rawReady || typeof window === "undefined") return;
    const key = "ap_results_switch_hint_seen";
    if (window.localStorage.getItem(key)) return;
    const id = window.setTimeout(() => {
      setShowHint(true);
      window.localStorage.setItem(key, "1");
    }, 3000);
    return () => window.clearTimeout(id);
  }, [playing, rawReady]);

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sec = ((e.clientX - rect.left) / rect.width) * duration;
    offsetRef.current = sec;
    setPosition(sec);
    if (playing) void play(sec);
  };

  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  const cuePct = duration ? (cue.startSec / duration) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
      {/* Header + badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 20 }}>{title}</div>
        {badge?.passed ? (
          <button
            type="button"
            onClick={() => setBadgeOpen((v) => !v)}
            style={{
              border: `1px solid ${GOLD}`,
              color: GOLD,
              background: "rgba(205,137,33,0.08)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
            aria-expanded={badgeOpen}
          >
            Streaming ready · {badge.lufs.toFixed(1)} LUFS · No clipping
          </button>
        ) : null}
      </div>
      {badgeOpen && badge ? (
        <div style={{ border: "1px solid rgba(127,127,127,0.25)", borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.6 }}>
          <div>Loudness: {badge.lufs.toFixed(1)} LUFS (streaming range −14 to −8)</div>
          <div>Peak: {badge.truePeakDbtp.toFixed(1)} dBTP (safe for Spotify, Apple Music and YouTube)</div>
          <div>Clipping: none detected</div>
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            Your song will play at full level on streaming platforms without distortion.
          </div>
        </div>
      ) : null}

      {/* Player */}
      <div style={{ border: "1px solid rgba(127,127,127,0.25)", borderRadius: 16, padding: 16 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", opacity: 0.7 }}>Loading your song…</div>
        ) : error ? (
          <div style={{ padding: 24, textAlign: "center", color: "#d33" }}>{error}</div>
        ) : (
          <>
            <div
              onClick={seek}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(position)}
              style={{ position: "relative", height: 44, borderRadius: 8, background: "rgba(127,127,127,0.15)", cursor: "pointer", overflow: "hidden" }}
            >
              <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "rgba(205,137,33,0.35)" }} />
              {cue.from === "chorus" ? (
                <div title="Chorus" style={{ position: "absolute", top: 0, bottom: 0, left: `${cuePct}%`, width: 3, background: GOLD }} />
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              <span>{fmtTime(position)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => (playing ? pause() : void play())}
                style={{ background: GOLD, color: "#111", border: 0, borderRadius: 999, padding: "12px 22px", fontWeight: 700, cursor: "pointer" }}
              >
                {playing ? "Pause" : hasPlayed ? "Play" : cue.from === "chorus" ? "Hear your chorus" : "Play your song"}
              </button>
              {hasPlayed && (chorusDone || cue.from !== "chorus") && cue.startSec > 0 ? (
                <button
                  type="button"
                  onClick={() => void play(0)}
                  style={{ background: "transparent", border: "1px solid rgba(127,127,127,0.4)", borderRadius: 999, padding: "8px 14px", cursor: "pointer", color: "inherit" }}
                >
                  Play from the start
                </button>
              ) : null}
            </div>

            {/* Raw vs produced switch */}
            {rawReady ? (
              <div style={{ position: "relative", marginTop: 14 }}>
                <div role="tablist" aria-label="Compare versions" style={{ display: "flex", borderRadius: 999, background: "rgba(127,127,127,0.15)", padding: 4 }}>
                  {(["raw", "produced"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => switchMode(m)}
                      style={{
                        flex: 1,
                        border: 0,
                        borderRadius: 999,
                        padding: "10px 12px",
                        fontWeight: 600,
                        cursor: "pointer",
                        background: mode === m ? GOLD : "transparent",
                        color: mode === m ? "#111" : "inherit",
                        transition: "background 120ms",
                      }}
                    >
                      {m === "raw" ? "Your take" : "Produced by AP"}
                    </button>
                  ))}
                </div>
                {showHint ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: GOLD, textAlign: "center" }}>
                    Flip to hear your raw take
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Unlock / download */}
      {downloadUnlocked ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onDownload}
            style={{ flex: 1, background: GOLD, color: "#111", border: 0, borderRadius: 12, padding: "14px 18px", fontWeight: 700, cursor: "pointer" }}
          >
            Download MP3 / WAV
          </button>
        </div>
      ) : (
        <div style={{ border: `1px solid ${GOLD}`, borderRadius: 16, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Keep this song</div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
            ${SESSION_PRICE_USD.toFixed(2)} <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.7 }}>one-time</span>
          </div>
          <ul style={{ margin: "10px 0 14px", paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
            <li>WAV + MP3 for this song</li>
            <li>Use it anywhere: streaming, socials, shows</li>
            <li>No subscription</li>
          </ul>
          <button
            type="button"
            onClick={onUnlock}
            style={{ width: "100%", background: GOLD, color: "#111", border: 0, borderRadius: 12, padding: "14px 18px", fontWeight: 700, cursor: "pointer" }}
          >
            Pay ${SESSION_PRICE_USD.toFixed(2)} and download
          </button>
          <button
            type="button"
            onClick={onUnlock}
            style={{ marginTop: 10, width: "100%", background: "transparent", border: 0, color: "inherit", opacity: 0.75, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
          >
            Making more songs? Credit packs from $25
          </button>
        </div>
      )}
    </div>
  );
}

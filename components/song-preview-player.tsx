"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { Waveform, makeWave, CoverArt } from "@/components/studio-player";

export type SongPreviewLayer = {
  task_id: string;
  type?: string;
  title?: string | null;
  section_label?: string | null;
  start_ms: number;
  end_ms?: number | null;
  duration_ms?: number | null;
  audio_url: string;
};

type Props = {
  beatUrl: string | null;
  beatDurationMs?: number | null;
  layers: SongPreviewLayer[];
  title?: string;
  seed?: string;
};

function formatMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Client-side arrangement player: full beat + each vocal take at its section start_ms.
 * Used before Produce so the artist can hear the complete song sketch.
 */
export function SongPreviewPlayer({
  beatUrl,
  beatDurationMs,
  layers,
  title = "Full song preview",
  seed = "song-preview",
}: Props) {
  const { colors: C } = useTheme();
  const beatRef = useRef<HTMLAudioElement | null>(null);
  const vocalRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [clockMs, setClockMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const bars = useMemo(() => makeWave(seed, 56), [seed]);

  const durationMs = useMemo(() => {
    const fromBeat = beatDurationMs && beatDurationMs > 0 ? beatDurationMs : 0;
    const fromLayers = layers.reduce((max, l) => {
      const end =
        l.end_ms != null
          ? l.end_ms
          : l.start_ms + (l.duration_ms || 0);
      return Math.max(max, end);
    }, 0);
    return Math.max(fromBeat, fromLayers, 30_000);
  }, [beatDurationMs, layers]);

  const stopRaf = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const pauseAll = useCallback(() => {
    beatRef.current?.pause();
    vocalRefs.current.forEach((el) => {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    });
    stopRaf();
    setPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      pauseAll();
    };
  }, [pauseAll]);

  function registerVocal(id: string, el: HTMLAudioElement | null) {
    if (el) vocalRefs.current.set(id, el);
    else vocalRefs.current.delete(id);
  }

  useEffect(() => {
    const keep = new Set(layers.map((l) => l.task_id));
    vocalRefs.current.forEach((_el, id) => {
      if (!keep.has(id)) vocalRefs.current.delete(id);
    });
    pauseAll();
    setProgress(0);
    setClockMs(0);
  }, [layers, beatUrl, pauseAll]);

  async function ensureReady(el: HTMLAudioElement, label = "audio") {
    if (el.readyState >= 2) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: string) => {
        if (settled) return;
        settled = true;
        el.removeEventListener("canplay", onReady);
        el.removeEventListener("canplaythrough", onReady);
        el.removeEventListener("error", onErr);
        clearTimeout(timer);
        if (err) reject(new Error(err));
        else resolve();
      };
      const onReady = () => finish();
      const onErr = () =>
        finish(
          `Could not load ${label}. The take may still be uploading, or this browser cannot play the file format.`
        );
      const timer = setTimeout(
        () => finish(`Timed out loading ${label}. Tap Refresh preview and try again.`),
        12_000
      );
      el.addEventListener("canplay", onReady);
      el.addEventListener("canplaythrough", onReady);
      el.addEventListener("error", onErr);
      try {
        el.load();
      } catch {
        finish(`Could not load ${label}`);
      }
    });
  }

  async function toggle() {
    setError(null);
    if (playing) {
      pauseAll();
      return;
    }

    const beat = beatRef.current;
    if (!beat && !layers.length) {
      setError("Nothing to play yet");
      return;
    }

    try {
      if (beat) {
        await ensureReady(beat, "beat");
        beat.volume = 0.35;
        beat.currentTime = 0;
      }
      const failedVocals: string[] = [];
      for (const layer of layers) {
        const el = vocalRefs.current.get(layer.task_id);
        if (!el) {
          failedVocals.push(layer.section_label || layer.title || layer.type || "vocal");
          console.warn("[song-preview] missing audio element for layer", layer.task_id, layer.audio_url?.slice?.(0, 64));
          continue;
        }
        try {
          await ensureReady(el, layer.section_label || layer.title || "vocal");
          el.muted = false;
          el.volume = 1;
          el.playbackRate = 1;
          el.currentTime = 0;
          el.pause();
        } catch (ve) {
          failedVocals.push(layer.section_label || layer.title || layer.type || "vocal");
          console.warn("[song-preview] vocal load failed", layer.task_id, ve);
        }
      }
      if (failedVocals.length && !beat) {
        throw new Error(
          `Could not load vocals (${failedVocals.join(", ")}). Try Refresh preview.`
        );
      }

      startedRef.current = true;
      if (beat) {
        try {
          await beat.play();
        } catch (pe) {
          throw new Error(
            pe instanceof Error
              ? pe.message
              : "Beat playback was blocked. Tap play again."
          );
        }
      }

      for (const layer of layers) {
        if ((layer.start_ms || 0) > 80) continue;
        const el = vocalRefs.current.get(layer.task_id);
        if (el) {
          void el.play().catch((e) => {
            console.warn("[song-preview] early vocal play failed", layer.task_id, e);
          });
        }
      }
      if (failedVocals.length) {
        setError(
          `Some takes could not play (${failedVocals.join(", ")}). ${Math.max(0, layers.length - failedVocals.length)} of ${layers.length} vocals may still play — try Refresh preview.`
        );
      }
      if (layers.length === 0) {
        setError(
          "No vocal takes on this preview. Record selected parts, wait for Saved, then Refresh preview."
        );
      }

      setPlaying(true);
      const wallStart = performance.now();
      const clockOriginMs = beat ? beat.currentTime * 1000 : 0;

      const tick = () => {
        let now: number;
        if (beat && !beat.paused) {
          now = beat.currentTime * 1000;
        } else if (beat?.ended) {
          now = durationMs;
        } else if (beat && beat.paused && beat.currentTime > 0) {
          now = beat.currentTime * 1000;
        } else {
          now = clockOriginMs + (performance.now() - wallStart);
        }

        setClockMs(now);
        setProgress(Math.min(1, now / durationMs));

        for (const layer of layers) {
          const el = vocalRefs.current.get(layer.task_id);
          if (!el) continue;
          const start = layer.start_ms || 0;
          const end =
            layer.end_ms != null
              ? layer.end_ms
              : start + (layer.duration_ms || el.duration * 1000 || 0);

          if (now >= start && now < end - 40) {
            if (el.paused) {
              const offsetSec = Math.max(0, (now - start) / 1000);
              try {
                el.muted = false;
                el.volume = 1;
                if (Math.abs(el.currentTime - offsetSec) > 0.35) {
                  el.currentTime = offsetSec;
                }
              } catch {
                /* ignore */
              }
              void el.play().catch(() => undefined);
            }
          } else if (now >= end && !el.paused) {
            el.pause();
          }
        }

        if (beat?.ended || now >= durationMs - 50) {
          pauseAll();
          setProgress(1);
          setClockMs(durationMs);
          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Playback failed");
      pauseAll();
    }
  }

  function seekTo(ratio: number) {
    const ms = Math.max(0, Math.min(durationMs, ratio * durationMs));
    pauseAll();
    const beat = beatRef.current;
    if (beat) {
      try {
        beat.currentTime = ms / 1000;
      } catch {
        /* ignore */
      }
    }
    setClockMs(ms);
    setProgress(ms / durationMs);
  }

  const layerSummary =
    layers.length === 0
      ? "Beat only — no vocal takes loaded for preview"
      : `${layers.length} vocal take${layers.length === 1 ? "" : "s"} on the timeline`;

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        background: C.surface,
        boxShadow: C.cardShadow,
      }}
    >
      {beatUrl && (
        <audio
          ref={beatRef}
          src={beatUrl}
          preload="auto"
          playsInline
        />
      )}
      {layers.map((l) => (
        <audio
          key={`${l.task_id}-${l.audio_url}`}
          ref={(el) => registerVocal(l.task_id, el)}
          src={l.audio_url}
          preload="auto"
          playsInline
        />
      ))}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <CoverArt seed={seed} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
            {layerSummary} · {formatMs(clockMs)} / {formatMs(durationMs)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? "Pause" : "Play full song"}
          disabled={!beatUrl && layers.length === 0}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            color: "#1A1208",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
            opacity: !beatUrl && layers.length === 0 ? 0.5 : 1,
          }}
        >
          {playing ? (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13l11-6.5L8 5.5Z" />
            </svg>
          )}
        </button>
      </div>

      <div
        style={{ marginTop: 12, cursor: "pointer" }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          seekTo(ratio);
        }}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <Waveform bars={bars} progress={progress} activeColor={C.signal} height={40} />
      </div>

      {layers.length > 0 && (
        <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none" }}>
          {layers.map((l) => (
            <li
              key={l.task_id}
              style={{
                fontSize: 12,
                color: C.textMuted,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "4px 0",
                borderTop: `1px solid ${C.border}`,
              }}
            >
              <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>
                {l.section_label || l.title || l.type || "Vocal"}
              </span>
              <span style={{ flexShrink: 0 }}>
                {formatMs(l.start_ms)}
                {l.end_ms != null ? ` → ${formatMs(l.end_ms)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p style={{ color: C.danger, fontSize: 13, marginTop: 8, marginBottom: 0 }}>{error}</p>
      )}

      <p style={{ fontSize: 12, color: C.textMuted, marginTop: 10, marginBottom: 0 }}>
        Rough preview (beat + your takes in place). Produce runs RoEx preview mix/master next.
      </p>
    </div>
  );
}

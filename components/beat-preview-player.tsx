"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/lib/theme";

export function formatAudioTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

type UseBeatAudioOptions = {
  onError?: (message: string) => void;
};

/** Single shared Audio element for list beat previews (Studio / Library). */
export function useBeatAudio(opts?: UseBeatAudioOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  /** Track stays selected when paused (for mini player). */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trackMeta, setTrackMeta] = useState<{
    title: string;
    subtitle?: string;
    seed?: string;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const onErrorRef = useRef(opts?.onError);
  onErrorRef.current = opts?.onError;

  useEffect(() => {
    playingIdRef.current = playingId;
  }, [playingId]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startRaf = useCallback(() => {
    stopRaf();
    const tick = () => {
      const a = audioRef.current;
      if (a && !a.paused) {
        setCurrentTime(a.currentTime);
        if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf]);

  useEffect(() => {
    return () => {
      stopRaf();
      try {
        audioRef.current?.pause();
      } catch {
        /* ignore */
      }
    };
  }, [stopRaf]);

  const ensureUrl = useCallback(
    async (projectId: string): Promise<string | null> => {
      const key = `beat:${projectId}`;
      if (urls[key] || urls[projectId]) return urls[key] || urls[projectId];
      const res = await fetch(`/api/projects/${projectId}/beat`);
      if (!res.ok) return null;
      const j = await res.json();
      const url = typeof j.audio_url === "string" ? j.audio_url : null;
      if (url) setUrls((prev) => ({ ...prev, [key]: url, [projectId]: url }));
      return url;
    },
    [urls]
  );

  /** Signed master URL for Library Songs playback (per job / version). */
  const ensureMasterUrl = useCallback(
    async (
      projectId: string,
      opts?: { jobId?: string; version?: number }
    ): Promise<string | null> => {
      const key = `master:${projectId}:${opts?.jobId || (opts?.version != null ? `v${opts.version}` : "latest")}`;
      if (urls[key]) return urls[key];
      const q = new URLSearchParams();
      if (opts?.jobId) q.set("jobId", opts.jobId);
      else if (opts?.version != null) q.set("version", String(opts.version));
      const qs = q.toString();
      const res = await fetch(
        `/api/projects/${projectId}/master${qs ? `?${qs}` : ""}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) return null;
      const j = (await res.json().catch(() => ({}))) as {
        audio_url?: string;
        download_url?: string;
      };
      const url =
        typeof j.audio_url === "string"
          ? j.audio_url
          : typeof j.download_url === "string"
            ? j.download_url
            : null;
      if (url) setUrls((prev) => ({ ...prev, [key]: url }));
      return url;
    },
    [urls]
  );

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      a.addEventListener("ended", () => {
        setPlayingId(null);
        setIsPlaying(false);
        stopRaf();
        setCurrentTime(0);
      });
      a.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
      });
      a.addEventListener("timeupdate", () => setCurrentTime(a.currentTime));
      audioRef.current = a;
    }
    return audioRef.current;
  }, [stopRaf]);

  type TrackMetaInput = { title: string; subtitle?: string; seed?: string };

  const playWithResolver = useCallback(
    async (
      playId: string,
      resolveUrl: () => Promise<string | null>,
      meta?: TrackMetaInput
    ) => {
      try {
        const a = ensureAudio();
        // Same track playing → pause but keep mini player
        if (activeIdRef.current === playId && a && !a.paused) {
          a.pause();
          stopRaf();
          setPlayingId(null);
          setIsPlaying(false);
          return;
        }
        // Same track paused → resume
        if (activeIdRef.current === playId && a && a.paused && a.src) {
          await a.play();
          setPlayingId(playId);
          setIsPlaying(true);
          startRaf();
          return;
        }
        setLoadingId(playId);
        const url = await resolveUrl();
        setLoadingId(null);
        if (!url) {
          onErrorRef.current?.("Could not load this track for playback.");
          return;
        }
        if (activeIdRef.current && activeIdRef.current !== playId) a.pause();
        if (a.src !== url) {
          a.src = url;
          setCurrentTime(0);
          setDuration(0);
        }
        if (meta) setTrackMeta(meta);
        await a.play();
        setActiveId(playId);
        setPlayingId(playId);
        setIsPlaying(true);
        startRaf();
      } catch (e) {
        setLoadingId(null);
        setPlayingId(null);
        setIsPlaying(false);
        stopRaf();
        onErrorRef.current?.(e instanceof Error ? e.message : "Playback failed");
      }
    },
    [ensureAudio, startRaf, stopRaf]
  );

  const toggle = useCallback(
    async (projectId: string, meta?: TrackMetaInput) => {
      await playWithResolver(projectId, () => ensureUrl(projectId), meta);
    },
    [playWithResolver, ensureUrl]
  );

  /** Play a produced master (Library Songs). playId should be unique per take. */
  const toggleMaster = useCallback(
    async (
      playId: string,
      projectId: string,
      opts?: { jobId?: string; version?: number; title?: string; subtitle?: string; seed?: string }
    ) => {
      const { jobId, version, title, subtitle, seed } = opts || {};
      await playWithResolver(
        playId,
        () => ensureMasterUrl(projectId, { jobId, version }),
        title
          ? { title, subtitle, seed: seed || title }
          : undefined
      );
    },
    [playWithResolver, ensureMasterUrl]
  );

  const pause = useCallback(() => {
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    stopRaf();
    setPlayingId(null);
    setIsPlaying(false);
  }, [stopRaf]);

  const resume = useCallback(async () => {
    const a = audioRef.current;
    const id = activeIdRef.current;
    if (!a || !id) return;
    try {
      await a.play();
      setPlayingId(id);
      setIsPlaying(true);
      startRaf();
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "Playback failed");
    }
  }, [startRaf]);

  const seek = useCallback(
    (seconds: number) => {
      const a = audioRef.current;
      if (!a || !playingIdRef.current) return;
      const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
      const next = Math.max(0, Math.min(dur || seconds, seconds));
      try {
        a.currentTime = next;
        setCurrentTime(next);
      } catch {
        /* ignore */
      }
    },
    [duration]
  );

  const skip = useCallback(
    (deltaSec: number) => {
      const a = audioRef.current;
      if (!a || !playingIdRef.current) return;
      seek(a.currentTime + deltaSec);
    },
    [seek]
  );

  const stop = useCallback(() => {
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    stopRaf();
    setPlayingId(null);
    setIsPlaying(false);
    setActiveId(null);
    setTrackMeta(null);
    setCurrentTime(0);
  }, [stopRaf]);

  const stopIfPlaying = useCallback(
    (projectId: string) => {
      if (playingIdRef.current === projectId) stop();
    },
    [stop]
  );

  return {
    playingId,
    activeId,
    isPlaying,
    trackMeta,
    loadingId,
    currentTime,
    duration,
    toggle,
    toggleMaster,
    pause,
    resume,
    seek,
    skip,
    stop,
    stopIfPlaying,
    ensureUrl,
    ensureMasterUrl,
  };
}

type BeatPreviewTransportProps = {
  active: boolean;
  currentTime: number;
  duration: number;
  onSeek: (sec: number) => void;
  onSkip: (delta: number) => void;
  disabled?: boolean;
};

/** Scrubber + time + ±10s (Suno-style). */
export function BeatPreviewTransport({
  active,
  currentTime,
  duration,
  onSeek,
  onSkip,
  disabled,
}: BeatPreviewTransportProps) {
  const { colors: C } = useTheme();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  if (!active) return null;

  const dur = duration > 0 ? duration : 0;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (currentTime / dur) * 100)) : 0;

  function seekFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el || dur <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * dur);
  }

  const chip: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.brass,
    fontSize: 11,
    fontWeight: 700,
    cursor: disabled ? "wait" : "pointer",
    fontFamily: "inherit",
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 10,
        width: "100%",
        minWidth: 0,
      }}
    >
      <button type="button" aria-label="Back 10 seconds" disabled={disabled} onClick={() => onSkip(-10)} style={chip}>
        −10
      </button>
      <span
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: C.textMuted,
          minWidth: 36,
          textAlign: "right",
          fontFamily: "inherit",
        }}
      >
        {formatAudioTime(currentTime)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!dragging.current || disabled) return;
          seekFromClientX(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "ArrowLeft") onSkip(-5);
          if (e.key === "ArrowRight") onSkip(5);
        }}
        style={{
          flex: 1,
          height: 28,
          display: "flex",
          alignItems: "center",
          cursor: disabled ? "default" : "pointer",
          minWidth: 48,
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 6,
            borderRadius: 999,
            background: C.border,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${C.brass}, #F0BC80)`,
              borderRadius: 999,
            }}
          />
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: C.textMuted,
          minWidth: 36,
          fontFamily: "inherit",
        }}
      >
        {formatAudioTime(dur)}
      </span>
      <button type="button" aria-label="Forward 10 seconds" disabled={disabled} onClick={() => onSkip(10)} style={chip}>
        +10
      </button>
    </div>
  );
}

export function BeatPlayButton({
  isPlaying,
  loading,
  disabled,
  onClick,
}: {
  isPlaying: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { colors: C } = useTheme();
  return (
    <button
      type="button"
      aria-label={isPlaying ? "Pause beat" : "Play beat"}
      disabled={disabled || loading}
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        borderRadius: 999,
        border: "none",
        flexShrink: 0,
        cursor: disabled || loading ? "wait" : "pointer",
        background: isPlaying ? `linear-gradient(180deg, #F0BC80, ${C.brass})` : C.bgDeep || C.surface,
        color: isPlaying ? "#1A1208" : C.brass,
        display: "grid",
        placeItems: "center",
        fontSize: 14,
        fontWeight: 700,
        fontFamily: "inherit",
        opacity: disabled || loading ? 0.6 : 1,
      }}
    >
      {loading ? "…" : isPlaying ? "❚❚" : "▶"}
    </button>
  );
}

export type BeatActionsSheetIcon =
  | "booth"
  | "console"
  | "download"
  | "delete"
  | "link"
  | "edit"
  | "play"
  | "share"
  | "more";

export type BeatActionsSheetItem = {
  key: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Visual icon key — falls back to key if omitted. */
  icon?: BeatActionsSheetIcon | string;
};

/** Suno-style ⋮ → bottom/side sheet of actions (no crowded card chips). */
export function BeatActionsSheet({
  open,
  title,
  subtitle,
  items,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  items: BeatActionsSheetItem[];
  onClose: () => void;
}) {
  const { colors: C } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "rgba(0,0,0,0.55)",
          cursor: "pointer",
          padding: 0,
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          margin: 0,
          borderRadius: "18px 18px 0 0",
          background: C.surface || "#1A1510",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.45)",
          padding: "12px 14px calc(28px + env(safe-area-inset-bottom, 0px))",
          boxSizing: "border-box",
          maxHeight: "min(88vh, 680px)",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: C.border,
            margin: "0 auto 10px",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
            padding: "0 4px 8px",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>More</div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              border: "none",
              background: "rgba(255,255,255,0.06)",
              color: C.textMuted,
              cursor: "pointer",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          >
            ˅
          </button>
        </div>
        <div style={{ marginBottom: 10, padding: "0 4px 12px", borderBottom: `1px solid ${C.border}` }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginTop: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {items.map((it) => {
            const iconKey = String(it.icon || it.key);
            return (
              <button
                key={it.key}
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  if (it.disabled) return;
                  it.onClick();
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  textAlign: "left",
                  padding: "14px 8px",
                  borderRadius: 0,
                  border: "none",
                  borderBottom: `1px solid rgba(255,255,255,0.04)`,
                  background: "transparent",
                  color: it.danger ? "#E07070" : C.text,
                  fontSize: 15,
                  fontWeight: 500,
                  cursor: it.disabled ? "wait" : "pointer",
                  fontFamily: "inherit",
                  opacity: it.disabled ? 0.5 : 1,
                  width: "100%",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    color: it.danger ? "#E07070" : C.textMuted,
                  }}
                  aria-hidden
                >
                  <SheetIcon name={iconKey} />
                </span>
                <span style={{ flex: 1 }}>{it.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function BeatMoreButton({ onClick, active }: { onClick: () => void; active?: boolean }) {
  const { colors: C } = useTheme();
  return (
    <button
      type="button"
      aria-label="More actions"
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        border: `1px solid ${active ? C.brassLine || C.brass : C.border}`,
        background: active ? C.brassSoft || "transparent" : "transparent",
        color: active ? C.brass : C.textMuted,
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        fontSize: 18,
        fontWeight: 800,
        letterSpacing: 1,
        fontFamily: "inherit",
        lineHeight: 1,
      }}
    >
      ⋮
    </button>
  );
}


/** Sticky mini player (Library Songs / Beats) — Mureka-style bottom bar. */
export function LibraryMiniPlayer({
  open,
  title,
  subtitle,
  seed,
  isPlaying,
  loading,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
  onSkip,
  onClose,
  onExpand,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  seed?: string;
  isPlaying: boolean;
  loading?: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onSkip: (delta: number) => void;
  onClose?: () => void;
  /** Tap cover/title → full-screen player (Suno / Mureka). */
  onExpand?: () => void;
}) {
  const { colors: C } = useTheme();
  if (!open) return null;
  if (typeof document === "undefined") return null;
  const dur = duration > 0 ? duration : 0;
  const pct = dur > 0 ? Math.min(100, (currentTime / dur) * 100) : 0;

  return createPortal(
    <div
      role="region"
      aria-label="Now playing"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        /* Sit above bottom nav (~74px) without covering it */
        bottom: "calc(78px + env(safe-area-inset-bottom, 0px))",
        zIndex: 50,
        borderRadius: 18,
        background: C.surface || "#1a1a1a",
        border: `1px solid ${C.border}`,
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        overflow: "hidden",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* progress */}
      <div
        style={{ height: 3, background: "rgba(255,255,255,0.08)", cursor: "pointer" }}
        onClick={(e) => {
          if (dur <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          onSeek(x * dur);
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${C.brass}, #F0BC80)`,
            transition: "width 0.15s linear",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px 12px",
        }}
      >
        <button
          type="button"
          onClick={() => onExpand?.()}
          aria-label="Open full player"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: onExpand ? "pointer" : "default",
            textAlign: "left",
            fontFamily: "inherit",
            color: "inherit",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              overflow: "hidden",
              flexShrink: 0,
              background: C.bgDeep || "#111",
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                background: `linear-gradient(145deg, ${C.brass}55, #2a1a0a 60%, #0d0d0d)`,
                display: "grid",
                placeItems: "center",
                color: C.brass,
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {(title || "S").slice(0, 1).toUpperCase()}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: C.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title || "Now playing"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: C.textMuted,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle ||
                `${formatAudioTime(currentTime)} / ${formatAudioTime(dur)}`}
            </div>
          </div>
        </button>
        <button
          type="button"
          aria-label="Back 10 seconds"
          onClick={() => onSkip(-10)}
          style={miniCtrl(C)}
        >
          ‹‹
        </button>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={loading}
          onClick={onTogglePlay}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            color: "#1A1208",
            fontWeight: 700,
            fontSize: 14,
            cursor: loading ? "wait" : "pointer",
            flexShrink: 0,
            fontFamily: "inherit",
          }}
        >
          {loading ? "…" : isPlaying ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          aria-label="Forward 10 seconds"
          onClick={() => onSkip(10)}
          style={miniCtrl(C)}
        >
          ››
        </button>
        {onClose && (
          <button
            type="button"
            aria-label="Close player"
            onClick={onClose}
            style={{ ...miniCtrl(C), fontSize: 16, opacity: 0.7 }}
          >
            ×
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}



/** Full-screen now-playing (Suno / Mureka style). */
export function LibraryFullPlayer({
  open,
  title,
  subtitle,
  seed,
  isPlaying,
  loading,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
  onSkip,
  onClose,
  onDownload,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  seed?: string;
  isPlaying: boolean;
  loading?: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onSkip: (delta: number) => void;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const { colors: C } = useTheme();
  if (!open) return null;
  if (typeof document === "undefined") return null;
  const dur = duration > 0 ? duration : 0;
  const pct = dur > 0 ? Math.min(100, (currentTime / dur) * 100) : 0;
  const letter = (title || "S").slice(0, 1).toUpperCase();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 220,
        background: C.bg || C.bgDeep || "#0c0c0c",
        display: "flex",
        flexDirection: "column",
        padding:
          "calc(12px + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px))",
        color: C.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          aria-label="Close full player"
          onClick={onClose}
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            border: `1px solid ${C.border}`,
            background: "transparent",
            color: C.textMuted,
            fontSize: 18,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          ˅
        </button>
        <span
          style={{
            fontSize: 12,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: C.textMuted,
            fontWeight: 600,
          }}
        >
          Now playing
        </span>
        <div style={{ width: 40 }} />
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          minHeight: 0,
          padding: "12px 0",
        }}
      >
        <div
          style={{
            width: "min(78vw, 320px)",
            aspectRatio: "1",
            borderRadius: 24,
            overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
            background: `linear-gradient(145deg, ${C.brass}66, #3a2410 45%, #0a0a0a)`,
            display: "grid",
            placeItems: "center",
          }}
        >
          <span
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 72,
              fontWeight: 600,
              color: C.brass,
              opacity: 0.9,
            }}
          >
            {letter}
          </span>
        </div>

        <div style={{ width: "100%", maxWidth: 360, textAlign: "left" }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title || "Untitled"}
          </div>
          <div
            style={{
              fontSize: 14,
              color: C.textMuted,
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle || "AP Studio"}
          </div>
        </div>

        {/* scrubber */}
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(currentTime)}
            tabIndex={0}
            onClick={(e) => {
              if (dur <= 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              onSeek(x * dur);
            }}
            style={{
              height: 28,
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              touchAction: "none",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                height: 4,
                borderRadius: 999,
                background: "rgba(255,255,255,0.12)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  borderRadius: 999,
                  background: C.text || "#fff",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `calc(${pct}% - 6px)`,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: C.text || "#fff",
                }}
              />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: C.textMuted,
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
            }}
          >
            <span>{formatAudioTime(currentTime)}</span>
            <span>{formatAudioTime(dur)}</span>
          </div>
        </div>

        {/* transport */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
            width: "100%",
            maxWidth: 360,
          }}
        >
          <button
            type="button"
            aria-label="Back 10 seconds"
            onClick={() => onSkip(-10)}
            style={fullCtrl(C)}
          >
            ‹‹
          </button>
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={loading}
            onClick={onTogglePlay}
            style={{
              width: 72,
              height: 72,
              borderRadius: 999,
              border: "none",
              background: C.text || "#fff",
              color: C.bg || "#0c0c0c",
              fontSize: 22,
              fontWeight: 700,
              cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit",
              display: "grid",
              placeItems: "center",
            }}
          >
            {loading ? "…" : isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            aria-label="Forward 10 seconds"
            onClick={() => onSkip(10)}
            style={fullCtrl(C)}
          >
            ››
          </button>
        </div>

        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            style={{
              marginTop: 8,
              padding: "12px 28px",
              borderRadius: 999,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.text,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Download
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

function fullCtrl(C: { border: string; textMuted: string }): React.CSSProperties {
  return {
    width: 48,
    height: 48,
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: C.textMuted,
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "grid",
    placeItems: "center",
  };
}

function miniCtrl(C: { border: string; textMuted: string; surface?: string }): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 999,
    border: `1px solid ${C.border}`,
    background: "transparent",
    color: C.textMuted,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "inherit",
    display: "grid",
    placeItems: "center",
    padding: 0,
  };
}

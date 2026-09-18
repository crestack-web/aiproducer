"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  const rafRef = useRef<number | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const onErrorRef = useRef(opts?.onError);
  onErrorRef.current = opts?.onError;

  useEffect(() => {
    playingIdRef.current = playingId;
  }, [playingId]);

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
      if (urls[projectId]) return urls[projectId];
      const res = await fetch(`/api/projects/${projectId}/beat`);
      if (!res.ok) return null;
      const j = await res.json();
      const url = typeof j.audio_url === "string" ? j.audio_url : null;
      if (url) setUrls((prev) => ({ ...prev, [projectId]: url }));
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

  const toggle = useCallback(
    async (projectId: string) => {
      try {
        const a = ensureAudio();
        if (playingIdRef.current === projectId && a && !a.paused) {
          a.pause();
          stopRaf();
          setPlayingId(null);
          return;
        }
        setLoadingId(projectId);
        const url = await ensureUrl(projectId);
        setLoadingId(null);
        if (!url) {
          onErrorRef.current?.("Could not load this beat for playback.");
          return;
        }
        if (playingIdRef.current && playingIdRef.current !== projectId) a.pause();
        if (a.src !== url) {
          a.src = url;
          setCurrentTime(0);
          setDuration(0);
        }
        await a.play();
        setPlayingId(projectId);
        startRaf();
      } catch (e) {
        setLoadingId(null);
        setPlayingId(null);
        stopRaf();
        onErrorRef.current?.(e instanceof Error ? e.message : "Playback failed");
      }
    },
    [ensureAudio, ensureUrl, startRaf, stopRaf]
  );

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
  }, [stopRaf]);

  const stopIfPlaying = useCallback(
    (projectId: string) => {
      if (playingIdRef.current === projectId) stop();
    },
    [stop]
  );

  return {
    playingId,
    loadingId,
    currentTime,
    duration,
    toggle,
    seek,
    skip,
    stop,
    stopIfPlaying,
    ensureUrl,
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

export type BeatActionsSheetItem = {
  key: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
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
          margin: "0 0 env(safe-area-inset-bottom, 0)",
          borderRadius: "18px 18px 0 0",
          background: C.surface || "#1A1510",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.45)",
          padding: "12px 14px 20px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: C.border,
            margin: "0 auto 12px",
          }}
        />
        <div style={{ marginBottom: 12, padding: "0 4px" }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: C.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{subtitle}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((it) => (
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
                textAlign: "left",
                padding: "14px 12px",
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: C.bgDeep || "transparent",
                color: it.danger ? "#E07070" : C.text,
                fontSize: 14,
                fontWeight: 600,
                cursor: it.disabled ? "wait" : "pointer",
                fontFamily: "inherit",
                opacity: it.disabled ? 0.5 : 1,
              }}
            >
              {it.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: 6,
              textAlign: "center",
              padding: "14px 12px",
              borderRadius: 12,
              border: `1px solid ${C.border}`,
              background: "transparent",
              color: C.textMuted,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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

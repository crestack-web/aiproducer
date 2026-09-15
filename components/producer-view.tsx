"use client";

/**
 * Producer View — Phase 1 (read-only, mobile-first)
 * Visualizes beat + section markers + vocal layers on a timeline.
 * Does not introduce a new source of truth; reads existing task/take data.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

export type ProducerLayer = {
  id: string;
  label: string;
  role: string;
  sectionLabel?: string;
  startMs: number;
  endMs: number;
  audioUrl?: string | null;
  color?: string;
};

export type ProducerSection = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
};

type Props = {
  projectTitle?: string;
  beatUrl: string | null;
  beatDurationMs?: number | null;
  sections: ProducerSection[];
  layers: ProducerLayer[];
  onClose?: () => void;
  onOpenTweak?: () => void;
};

const ROLE_COLORS: Record<string, string> = {
  lead: "#A78BFA",
  double: "#818CF8",
  harmony: "#C084FC",
  harmony_high: "#E879F9",
  harmony_mid: "#C084FC",
  harmony_low: "#A855F7",
  adlib: "#F472B6",
  background: "#94A3B8",
  intro: "#67E8F9",
  outro: "#67E8F9",
  beat: "#34D399",
};

function roleColor(role: string) {
  const k = (role || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_COLORS[k]) return ROLE_COLORS[k];
  if (k.includes("harmon")) return ROLE_COLORS.harmony;
  if (k.includes("adlib") || k.includes("ad-lib")) return ROLE_COLORS.adlib;
  if (k.includes("double")) return ROLE_COLORS.double;
  return "#7BEBD4";
}

function formatMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function ProducerView({
  projectTitle,
  beatUrl,
  beatDurationMs: durationProp,
  sections,
  layers,
  onClose,
  onOpenTweak,
}: Props) {
  const { colors: C } = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [durationMs, setDurationMs] = useState(durationProp || 0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>("beat");
  const [pxPerSec, setPxPerSec] = useState(48);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [muted, setMuted] = useState<Record<string, boolean>>({});

  const totalMs = useMemo(() => {
    let max = durationMs || 0;
    for (const s of sections) max = Math.max(max, s.endMs);
    for (const l of layers) max = Math.max(max, l.endMs);
    return Math.max(max, 30_000);
  }, [durationMs, sections, layers]);

  const timelineW = Math.max(320, (totalMs / 1000) * pxPerSec);

  useEffect(() => {
    if (!beatUrl) return;
    const el = audioRef.current;
    if (!el) return;
    function onMeta() {
      const d = el!.duration;
      if (Number.isFinite(d) && d > 0) setDurationMs(Math.round(d * 1000));
    }
    function onTime() {
      setPlayheadMs(Math.round(el!.currentTime * 1000));
    }
    function onEnd() {
      setPlaying(false);
    }
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [beatUrl]);

  function togglePlay() {
    const el = audioRef.current;
    if (!el || !beatUrl) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  function seekTo(ms: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    setPlayheadMs(ms);
  }

  const tracks = useMemo(() => {
    const list: {
      id: string;
      label: string;
      kind: "beat" | "vocal";
      color: string;
      startMs: number;
      endMs: number;
      sub?: string;
    }[] = [];
    list.push({
      id: "beat",
      label: "Beat",
      kind: "beat",
      color: ROLE_COLORS.beat,
      startMs: 0,
      endMs: totalMs,
    });
    for (const l of layers) {
      list.push({
        id: l.id,
        label: l.label,
        kind: "vocal",
        color: l.color || roleColor(l.role),
        startMs: l.startMs,
        endMs: Math.max(l.endMs, l.startMs + 500),
        sub: l.sectionLabel,
      });
    }
    return list;
  }, [layers, totalMs]);

  const msToX = (ms: number) => (ms / 1000) * pxPerSec;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "70vh",
        background: C.bg,
        color: C.text,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={iconBtn(C)}
            aria-label="Close Producer View"
          >
            ←
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: C.textMuted, fontWeight: 600 }}>
            PRODUCER VIEW
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {projectTitle || "Session"}
          </div>
        </div>
        <button type="button" onClick={() => setPxPerSec((z) => Math.max(24, z - 12))} style={iconBtn(C)}>
          −
        </button>
        <button type="button" onClick={() => setPxPerSec((z) => Math.min(120, z + 12))} style={iconBtn(C)}>
          +
        </button>
      </div>

      {/* Transport */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={togglePlay}
          disabled={!beatUrl}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: C.brass,
            color: "#1A1208",
            fontWeight: 800,
            fontSize: 16,
            cursor: beatUrl ? "pointer" : "not-allowed",
            opacity: beatUrl ? 1 : 0.5,
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: C.textMuted }}>
          {formatMs(playheadMs)} / {formatMs(totalMs)}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.textFaint }}>Read-only · Phase 1</span>
      </div>

      {beatUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={audioRef} src={beatUrl} preload="metadata" />
      )}

      {/* Timeline scroll area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          WebkitOverflowScrolling: "touch",
          position: "relative",
        }}
      >
        {/* Section marker lane */}
        <div style={{ position: "sticky", top: 0, zIndex: 5, background: C.bg }}>
          <div style={{ display: "flex", minWidth: timelineW + 100 }}>
            <div style={{ width: 100, flexShrink: 0, padding: "8px 8px", fontSize: 11, color: C.textFaint }}>
              Sections
            </div>
            <div
              style={{
                position: "relative",
                height: 36,
                width: timelineW,
                borderBottom: `1px solid ${C.border}`,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0) - 0;
                // account for label column offset: click is on the lane itself so x is relative to lane
                const ms = (x / pxPerSec) * 1000;
                seekTo(Math.max(0, Math.min(totalMs, ms)));
              }}
            >
              {sections.map((s) => (
                <div
                  key={s.id}
                  title={s.label}
                  style={{
                    position: "absolute",
                    left: msToX(s.startMs),
                    width: Math.max(4, msToX(s.endMs) - msToX(s.startMs)),
                    top: 6,
                    height: 24,
                    borderRadius: 6,
                    background: "rgba(231,169,97,0.18)",
                    border: `1px solid ${C.brass}88`,
                    fontSize: 10,
                    fontWeight: 700,
                    color: C.brass,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "4px 6px",
                    boxSizing: "border-box",
                  }}
                >
                  {s.label}
                </div>
              ))}
              {/* playhead on section lane */}
              <div
                style={{
                  position: "absolute",
                  left: msToX(playheadMs),
                  top: 0,
                  bottom: 0,
                  width: 2,
                  background: C.danger || "#F07167",
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            </div>
          </div>
        </div>

        {/* Tracks */}
        {tracks.map((tr) => {
          const expanded = expandedId === tr.id;
          const isMuted = muted[tr.id];
          const isSolo = soloId === tr.id;
          const dimmed = soloId ? !isSolo : isMuted;
          return (
            <div
              key={tr.id}
              style={{
                display: "flex",
                minWidth: timelineW + 100,
                borderBottom: `1px solid ${C.border}`,
                opacity: dimmed ? 0.4 : 1,
                background: expanded ? C.surface : "transparent",
              }}
            >
              {/* Track header */}
              <div
                style={{
                  width: 100,
                  flexShrink: 0,
                  padding: "8px 6px",
                  position: "sticky",
                  left: 0,
                  zIndex: 3,
                  background: C.bg,
                  borderRight: `1px solid ${C.border}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : tr.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.text,
                    fontWeight: 700,
                    fontSize: 12,
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: tr.color,
                      marginRight: 6,
                    }}
                  />
                  {tr.label}
                </button>
                {tr.sub && (
                  <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2, paddingLeft: 14 }}>
                    {tr.sub}
                  </div>
                )}
                <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                  <button
                    type="button"
                    title="Mute"
                    onClick={() => setMuted((m) => ({ ...m, [tr.id]: !m[tr.id] }))}
                    style={miniChip(C, isMuted)}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    title="Solo"
                    onClick={() => setSoloId(soloId === tr.id ? null : tr.id)}
                    style={miniChip(C, isSolo)}
                  >
                    S
                  </button>
                </div>
              </div>

              {/* Lane */}
              <div
                style={{
                  position: "relative",
                  width: timelineW,
                  height: expanded ? 72 : 40,
                  transition: "height 0.15s ease",
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  seekTo(Math.max(0, Math.min(totalMs, (x / pxPerSec) * 1000)));
                }}
              >
                {/* grid lines */}
                {Array.from({ length: Math.ceil(totalMs / 10000) + 1 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: msToX(i * 10000),
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: "rgba(255,255,255,0.04)",
                      pointerEvents: "none",
                    }}
                  />
                ))}
                {/* clip */}
                <div
                  style={{
                    position: "absolute",
                    left: msToX(tr.startMs),
                    width: Math.max(6, msToX(tr.endMs) - msToX(tr.startMs)),
                    top: expanded ? 12 : 8,
                    height: expanded ? 48 : 24,
                    borderRadius: 6,
                    background: tr.color,
                    opacity: 0.85,
                    boxShadow: `0 0 0 1px ${tr.color}`,
                    overflow: "hidden",
                  }}
                >
                  {/* fake waveform bars */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: "100%",
                      gap: 1,
                      padding: "0 4px",
                      opacity: 0.55,
                    }}
                  >
                    {Array.from({ length: Math.min(40, Math.max(8, Math.floor((tr.endMs - tr.startMs) / 400))) }).map(
                      (_, i) => (
                        <div
                          key={i}
                          style={{
                            flex: 1,
                            height: `${30 + ((i * 17) % 60)}%`,
                            background: "rgba(0,0,0,0.35)",
                            borderRadius: 1,
                            minWidth: 2,
                          }}
                        />
                      )
                    )}
                  </div>
                </div>
                {/* playhead */}
                <div
                  style={{
                    position: "absolute",
                    left: msToX(playheadMs),
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: "#F07167",
                    pointerEvents: "none",
                    zIndex: 4,
                  }}
                />
              </div>
            </div>
          );
        })}

        {layers.length === 0 && (
          <p style={{ padding: 16, color: C.textMuted, fontSize: 13 }}>
            No recorded vocal layers yet. Record sections in the booth — they will appear here as
            tracks against the beat.
          </p>
        )}
      </div>

      {/* Bottom sheet-ish prompt entry (Phase 1: opens existing tweak flow) */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 14px calc(12px + env(safe-area-inset-bottom))",
          borderTop: `1px solid ${C.border}`,
          background: C.surface,
        }}
      >
        <button
          type="button"
          onClick={onOpenTweak}
          disabled={!onOpenTweak}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "12px 14px",
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            background: C.bg,
            color: C.textMuted,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: onOpenTweak ? "pointer" : "default",
          }}
        >
          Ask AP to tweak… (e.g. “make the chorus louder”)
        </button>
      </div>
    </div>
  );
}

function iconBtn(C: { border: string; surface: string; text: string }): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function miniChip(C: { border: string; brass: string; brassSoft: string; text: string }, on: boolean): React.CSSProperties {
  return {
    width: 24,
    height: 22,
    borderRadius: 6,
    border: `1px solid ${on ? C.brass : C.border}`,
    background: on ? C.brassSoft : "transparent",
    color: C.text,
    fontSize: 10,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

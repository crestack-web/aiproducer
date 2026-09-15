"use client";

/**
 * Producer View — Phase 1 (read-only, mobile-first)
 * Visualizes beat + section markers + vocal layers on a timeline.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function WaveBars({
  count,
  color,
  tall,
}: {
  count: number;
  color: string;
  tall?: boolean;
}) {
  const n = Math.min(64, Math.max(12, count));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        gap: 1.5,
        padding: "0 6px",
        opacity: 0.9,
      }}
    >
      {Array.from({ length: n }).map((_, i) => {
        const h = 22 + ((i * 37 + i * i * 3) % (tall ? 70 : 55));
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${h}%`,
              minWidth: 2,
              maxWidth: 5,
              borderRadius: 1,
              background: "rgba(0,0,0,0.28)",
              boxShadow: `0 0 0 1px ${color}33 inset`,
            }}
          />
        );
      })}
    </div>
  );
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
  const [pxPerSec, setPxPerSec] = useState(56);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [muted, setMuted] = useState<Record<string, boolean>>({});

  const totalMs = useMemo(() => {
    let max = durationMs || 0;
    for (const s of sections) max = Math.max(max, s.endMs || 0);
    for (const l of layers) max = Math.max(max, l.endMs || 0);
    return Math.max(max, 45_000);
  }, [durationMs, sections, layers]);

  const timelineW = Math.max(360, (totalMs / 1000) * pxPerSec);

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
    const clamped = Math.max(0, Math.min(totalMs, ms));
    if (el) el.currentTime = clamped / 1000;
    setPlayheadMs(clamped);
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

  const bg = C.bg || "#0a0a0c";
  const surface = C.surface || "rgba(255,255,255,0.06)";
  const border = C.border || "rgba(255,255,255,0.12)";
  const text = C.text || "#F4F1EC";
  const mutedText = C.textMuted || "#9B96A3";
  const faint = C.textFaint || "#5C5866";
  const brass = C.brass || "#E7A961";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        maxWidth: "100%",
        background: bg,
        color: text,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          paddingTop: "max(12px, env(safe-area-inset-top))",
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
          background: surface,
        }}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={iconBtn(border, surface, text)}
            aria-label="Close Producer View"
          >
            ←
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: brass,
              fontWeight: 700,
            }}
          >
            PRODUCER VIEW
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {projectTitle || "Session"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPxPerSec((z) => Math.max(28, z - 12))}
          style={iconBtn(border, surface, text)}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setPxPerSec((z) => Math.min(140, z + 12))}
          style={iconBtn(border, surface, text)}
        >
          +
        </button>
      </div>

      {/* Transport */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={togglePlay}
          disabled={!beatUrl}
          style={{
            width: 48,
            height: 48,
            borderRadius: 999,
            border: "none",
            background: beatUrl ? `linear-gradient(180deg, #F0BC80, ${brass})` : faint,
            color: "#1A1208",
            fontWeight: 800,
            fontSize: 16,
            cursor: beatUrl ? "pointer" : "not-allowed",
            boxShadow: beatUrl ? "0 4px 14px rgba(231,169,97,0.35)" : "none",
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, color: mutedText }}>
          {formatMs(playheadMs)}
          <span style={{ color: faint }}> / {formatMs(totalMs)}</span>
        </div>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            color: faint,
            border: `1px solid ${border}`,
            borderRadius: 999,
            padding: "4px 10px",
          }}
        >
          Read-only
        </span>
      </div>

      {beatUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={audioRef} src={beatUrl} preload="metadata" />
      )}

      {!beatUrl && (
        <div
          style={{
            margin: "12px 14px 0",
            padding: 12,
            borderRadius: 12,
            background: "rgba(232,117,106,0.12)",
            border: "1px solid rgba(232,117,106,0.35)",
            color: mutedText,
            fontSize: 13,
          }}
        >
          No beat loaded for this session — timeline still shows sections and vocal layers.
        </div>
      )}

      {/* Timeline scroll */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          WebkitOverflowScrolling: "touch",
          position: "relative",
          background: bg,
        }}
      >
        {/* Section markers */}
        <div style={{ position: "sticky", top: 0, zIndex: 6, background: bg }}>
          <div style={{ display: "flex", minWidth: timelineW + 108 }}>
            <div
              style={{
                width: 108,
                flexShrink: 0,
                padding: "10px 8px",
                fontSize: 11,
                fontWeight: 700,
                color: faint,
                letterSpacing: "0.04em",
              }}
            >
              SECTIONS
            </div>
            <div
              style={{
                position: "relative",
                height: 40,
                width: timelineW,
                borderBottom: `1px solid ${border}`,
                background: surface,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                seekTo((x / pxPerSec) * 1000);
              }}
            >
              {sections.length === 0 && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    color: faint,
                  }}
                >
                  No section markers yet
                </div>
              )}
              {sections.map((s) => (
                <div
                  key={s.id}
                  title={`${s.label} ${formatMs(s.startMs)}–${formatMs(s.endMs)}`}
                  style={{
                    position: "absolute",
                    left: msToX(s.startMs),
                    width: Math.max(8, msToX(s.endMs) - msToX(s.startMs)),
                    top: 6,
                    height: 28,
                    borderRadius: 8,
                    background: "rgba(231,169,97,0.22)",
                    border: `1.5px solid ${brass}`,
                    fontSize: 11,
                    fontWeight: 700,
                    color: text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "5px 8px",
                    boxSizing: "border-box",
                  }}
                >
                  {s.label}
                </div>
              ))}
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
                  boxShadow: "0 0 8px rgba(240,113,103,0.6)",
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
                minWidth: timelineW + 108,
                borderBottom: `1px solid ${border}`,
                opacity: dimmed ? 0.35 : 1,
                background: expanded ? surface : "transparent",
              }}
            >
              <div
                style={{
                  width: 108,
                  flexShrink: 0,
                  padding: "10px 8px",
                  position: "sticky",
                  left: 0,
                  zIndex: 3,
                  background: bg,
                  borderRight: `1px solid ${border}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : tr.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: text,
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
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: tr.color,
                      marginRight: 6,
                      boxShadow: `0 0 8px ${tr.color}88`,
                    }}
                  />
                  {tr.label}
                </button>
                {tr.sub && (
                  <div
                    style={{
                      fontSize: 10,
                      color: faint,
                      marginTop: 3,
                      paddingLeft: 16,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tr.sub}
                  </div>
                )}
                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                  <button
                    type="button"
                    title="Mute"
                    onClick={() => setMuted((m) => ({ ...m, [tr.id]: !m[tr.id] }))}
                    style={miniChip(border, brass, isMuted, text)}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    title="Solo"
                    onClick={() => setSoloId(soloId === tr.id ? null : tr.id)}
                    style={miniChip(border, brass, isSolo, text)}
                  >
                    S
                  </button>
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  width: timelineW,
                  height: expanded ? 88 : 52,
                  transition: "height 0.15s ease",
                  background: "rgba(0,0,0,0.15)",
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  seekTo((x / pxPerSec) * 1000);
                }}
              >
                {Array.from({ length: Math.ceil(totalMs / 10000) + 1 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: msToX(i * 10000),
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: "rgba(255,255,255,0.06)",
                      pointerEvents: "none",
                    }}
                  />
                ))}
                <div
                  style={{
                    position: "absolute",
                    left: msToX(tr.startMs),
                    width: Math.max(10, msToX(tr.endMs) - msToX(tr.startMs)),
                    top: expanded ? 14 : 10,
                    height: expanded ? 60 : 32,
                    borderRadius: 8,
                    background: `linear-gradient(180deg, ${tr.color}ee, ${tr.color}99)`,
                    boxShadow: `0 2px 12px ${tr.color}44`,
                    overflow: "hidden",
                  }}
                >
                  <WaveBars
                    count={Math.floor((tr.endMs - tr.startMs) / 280)}
                    color={tr.color}
                    tall={expanded}
                  />
                </div>
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
                    boxShadow: "0 0 8px rgba(240,113,103,0.55)",
                  }}
                />
              </div>
            </div>
          );
        })}

        {layers.length === 0 && (
          <div
            style={{
              margin: 16,
              padding: 16,
              borderRadius: 14,
              border: `1px dashed ${border}`,
              color: mutedText,
              fontSize: 14,
              lineHeight: 1.5,
              maxWidth: 420,
            }}
          >
            <strong style={{ color: text }}>No vocal layers yet</strong>
            <p style={{ margin: "8px 0 0" }}>
              Record sections in the booth (lead, harmony, ad-libs). Completed takes show up here as
              colored tracks against the beat.
            </p>
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>

      {/* Bottom prompt */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 14px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          borderTop: `1px solid ${border}`,
          background: surface,
        }}
      >
        <button
          type="button"
          onClick={onOpenTweak}
          disabled={!onOpenTweak}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "14px 16px",
            borderRadius: 14,
            border: `1px solid ${border}`,
            background: bg,
            color: onOpenTweak ? mutedText : faint,
            fontSize: 14,
            fontFamily: "inherit",
            cursor: onOpenTweak ? "pointer" : "default",
          }}
        >
          {onOpenTweak
            ? "Ask AP to tweak… (e.g. “make the chorus louder”)"
            : "Produce the song to unlock prompt tweaks"}
        </button>
      </div>
    </div>
  );
}

function iconBtn(border: string, surface: string, text: string): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    borderRadius: 12,
    border: `1px solid ${border}`,
    background: surface,
    color: text,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 16,
  };
}

function miniChip(
  border: string,
  brass: string,
  on: boolean,
  text: string
): React.CSSProperties {
  return {
    width: 26,
    height: 24,
    borderRadius: 6,
    border: `1px solid ${on ? brass : border}`,
    background: on ? "rgba(231,169,97,0.2)" : "transparent",
    color: text,
    fontSize: 10,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

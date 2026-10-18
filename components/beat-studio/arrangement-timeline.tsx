"use client";

/**
 * Arrangement timeline — tracks × clips, sections, playhead.
 * Mobile-first; horizontal scroll for longer songs.
 */

import React, { useMemo, useRef, useState } from "react";
import type { BeatStudioDoc, SongSectionKind } from "@/lib/beat-studio/types";
import {
  addClip,
  addSection,
  barTicks,
  deleteClip,
  deleteSection,
  duplicateClip,
  moveClip,
  renameSection,
  resizeClip,
  setTrackMuted,
  setTrackSolo,
  songBars,
  snapTick,
} from "@/lib/beat-studio/arrangement";

const brass = "#E7A961";
const border = "rgba(255,255,255,0.1)";
const muted = "rgba(244,241,236,0.55)";
const text = "#F4F1EC";
const surface = "rgba(18,18,24,0.96)";

const CLIP_COLORS = [
  "rgba(231,169,97,0.85)",
  "rgba(123,235,212,0.75)",
  "rgba(167,139,250,0.8)",
  "rgba(248,113,113,0.8)",
  "rgba(96,165,250,0.8)",
  "rgba(52,211,153,0.8)",
];

const SECTION_KINDS: { id: SongSectionKind; label: string }[] = [
  { id: "intro", label: "Intro" },
  { id: "verse", label: "Verse" },
  { id: "pre_chorus", label: "Pre-Chorus" },
  { id: "chorus", label: "Chorus" },
  { id: "bridge", label: "Bridge" },
  { id: "outro", label: "Outro" },
  { id: "custom", label: "Custom" },
];

const INSTRUMENT_EMOJI: Record<string, string> = {
  drum_kit: "🥁",
  pluck: "🎹",
  synth_lead: "✨",
  synth_bass: "🎸",
};

type Props = {
  doc: BeatStudioDoc;
  onChange: (doc: BeatStudioDoc) => void;
  /** Playhead tick during song playback; null when stopped / pattern preview */
  playheadTick?: number | null;
  playingSong?: boolean;
  /** Open the pattern editor for a track (BandLab-style) */
  onEditTrack?: (trackId: string) => void;
  /** Beat / song name shown on the timeline header */
  songLabel?: string;
};

export default function ArrangementTimeline({
  doc,
  onChange,
  playheadTick = null,
  playingSong = false,
  onEditTrack,
  songLabel,
}: Props) {
  const [pxPerBar, setPxPerBar] = useState(48);
  const [selected, setSelected] = useState<{ trackId: string; clipId: string } | null>(null);
  const [drag, setDrag] = useState<{
    trackId: string;
    clipId: string;
    originX: number;
    originStart: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const bt = barTicks(doc);
  const bars = songBars(doc);
  const widthPx = bars * pxPerBar;
  const patternList = useMemo(() => Object.values(doc.patterns), [doc.patterns]);

  const tickToX = (tick: number) => (tick / bt) * pxPerBar;
  const xToTick = (x: number) => (x / pxPerBar) * bt;

  function onClipPointerDown(
    e: React.PointerEvent,
    trackId: string,
    clipId: string,
    startTick: number
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelected({ trackId, clipId });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ trackId, clipId, originX: e.clientX, originStart: startTick });
  }

  function onClipPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.originX;
    const newStart = snapTick(drag.originStart + xToTick(dx), doc, "bar");
    onChange(moveClip(doc, drag.trackId, drag.clipId, newStart, "bar"));
  }

  function onClipPointerUp(e: React.PointerEvent) {
    if (drag) {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    }
    setDrag(null);
  }

  function placePattern(trackId: string, patternId: string) {
    const pattern = doc.patterns[patternId];
    if (!pattern) return;
    // Place after last clip on track, or at 0
    const track = doc.tracks.find((t) => t.id === trackId);
    let start = 0;
    for (const c of track?.clips ?? []) {
      const end = c.startTick + (c.durationTicks ?? pattern.lengthTicks);
      if (end > start) start = end;
    }
    onChange(addClip(doc, trackId, patternId, start, { durationTicks: pattern.lengthTicks }));
  }

  function addSectionAtEnd(kind: SongSectionKind) {
    const label = SECTION_KINDS.find((k) => k.id === kind)?.label ?? kind;
    const start = doc.songLengthTicks;
    const len = bt * 4; // 4 bars default
    onChange(addSection(doc, { name: label, kind, startTick: start, lengthTicks: len }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
      {songLabel ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: brass,
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "0 2px",
          }}
          title={songLabel}
        >
          {songLabel}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, maxWidth: "100%" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setShowTools((v) => !v)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: showTools ? "rgba(231,169,97,0.15)" : "transparent",
              color: showTools ? brass : muted,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {showTools ? "Hide tools" : "Tools"}
          </button>
          {selected && (
            <>
              <button type="button" style={chipBtn} onClick={() => onChange(duplicateClip(doc, selected.trackId, selected.clipId))}>
                Duplicate
              </button>
              <button
                type="button"
                style={{ ...chipBtn, borderColor: "rgba(248,113,113,0.5)", color: "#f87171" }}
                onClick={() => {
                  onChange(deleteClip(doc, selected.trackId, selected.clipId));
                  setSelected(null);
                }}
              >
                Delete
              </button>
            </>
          )}
          <label style={{ marginLeft: "auto", fontSize: 10, color: muted, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            Zoom
            <input
              type="range"
              min={28}
              max={80}
              value={pxPerBar}
              onChange={(e) => setPxPerBar(Number(e.target.value))}
              style={{ width: 64 }}
            />
          </label>
        </div>
        {showTools && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: muted, fontWeight: 600 }}>SECTIONS</span>
            {SECTION_KINDS.filter((k) => k.id !== "custom").map((k) => (
              <button key={k.id} type="button" style={chipBtn} onClick={() => addSectionAtEnd(k.id)}>
                + {k.label}
              </button>
            ))}
            {selected && (
              <>
                <button
                  type="button"
                  style={chipBtn}
                  onClick={() => {
                    const clip = doc.tracks.find((t) => t.id === selected.trackId)?.clips.find((c) => c.id === selected.clipId);
                    if (!clip) return;
                    const btLocal = barTicks(doc);
                    const cur = clip.durationTicks ?? doc.patterns[clip.patternId]?.lengthTicks ?? btLocal;
                    onChange(resizeClip(doc, selected.trackId, selected.clipId, cur + btLocal, "bar"));
                  }}
                >
                  +1 bar
                </button>
                <button
                  type="button"
                  style={chipBtn}
                  onClick={() => {
                    const clip = doc.tracks.find((t) => t.id === selected.trackId)?.clips.find((c) => c.id === selected.clipId);
                    if (!clip) return;
                    const btLocal = barTicks(doc);
                    const cur = clip.durationTicks ?? doc.patterns[clip.patternId]?.lengthTicks ?? btLocal;
                    onChange(resizeClip(doc, selected.trackId, selected.clipId, Math.max(btLocal, cur - btLocal), "bar"));
                  }}
                >
                  −1 bar
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          borderRadius: 12,
          border: `1px solid ${border}`,
          background: surface,
          WebkitOverflowScrolling: "touch",
          maxWidth: "100%",
          touchAction: "pan-x",
        }}
      >
        <div style={{ position: "relative", width: Math.max(widthPx + 96, 280), minWidth: "100%" }}>
          {/* Section labels */}
          <div style={{ position: "relative", height: 28, marginLeft: 88, borderBottom: `1px solid ${border}` }}>
            {doc.sections.map((s) => (
              <div
                key={s.id}
                title={s.name}
                style={{
                  position: "absolute",
                  left: tickToX(s.startTick),
                  width: Math.max(24, tickToX(s.lengthTicks)),
                  top: 4,
                  height: 20,
                  borderRadius: 6,
                  background: "rgba(123,235,212,0.15)",
                  border: "1px solid rgba(123,235,212,0.35)",
                  fontSize: 10,
                  color: text,
                  padding: "2px 6px",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
                onDoubleClick={() => {
                  const name = window.prompt("Section name", s.name);
                  if (name != null) onChange(renameSection(doc, s.id, name));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (window.confirm(`Remove section “${s.name}”?`)) {
                    onChange(deleteSection(doc, s.id));
                  }
                }}
              >
                {s.name}
              </div>
            ))}
          </div>

          {/* Ruler */}
          <div
            style={{
              display: "flex",
              marginLeft: 88,
              height: 22,
              borderBottom: `1px solid ${border}`,
              position: "relative",
            }}
          >
            {Array.from({ length: bars }, (_, i) => (
              <div
                key={i}
                style={{
                  width: pxPerBar,
                  flexShrink: 0,
                  fontSize: 10,
                  color: muted,
                  borderLeft: i % 4 === 0 ? `1px solid ${border}` : "1px solid rgba(255,255,255,0.04)",
                  paddingLeft: 4,
                }}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Tracks */}
          {doc.tracks.map((track, ti) => {
            const color = CLIP_COLORS[ti % CLIP_COLORS.length];
            return (
              <div
                key={track.id}
                style={{
                  display: "flex",
                  borderBottom: `1px solid ${border}`,
                  minHeight: 52,
                }}
              >
                <div
                  style={{
                    width: 88,
                    flexShrink: 0,
                    padding: "8px 6px",
                    fontSize: 11,
                    color: text,
                    borderRight: `1px solid ${border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onEditTrack?.(track.id)}
                    style={{
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      background: "transparent",
                      border: "none",
                      color: text,
                      textAlign: "left",
                      padding: 0,
                      cursor: onEditTrack ? "pointer" : "default",
                      fontSize: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="Edit pattern"
                  >
                    <span aria-hidden>{INSTRUMENT_EMOJI[track.instrumentId] || "🎵"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{track.name}</span>
                  </button>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      title="Mute"
                      style={{
                        ...miniBtn,
                        opacity: track.muted ? 1 : 0.55,
                        color: track.muted ? brass : text,
                      }}
                      onClick={() => onChange(setTrackMuted(doc, track.id, !track.muted))}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      title="Solo"
                      style={{
                        ...miniBtn,
                        opacity: track.solo ? 1 : 0.55,
                        color: track.solo ? "#7BEBD4" : text,
                      }}
                      onClick={() => onChange(setTrackSolo(doc, track.id, !track.solo))}
                    >
                      S
                    </button>
                  </div>
                  {patternList.length > 0 && (
                    <select
                      aria-label={`Add pattern to ${track.name}`}
                      style={{
                        fontSize: 10,
                        background: "#0c0c10",
                        color: text,
                        border: `1px solid ${border}`,
                        borderRadius: 6,
                        padding: "2px 4px",
                        maxWidth: 76,
                      }}
                      defaultValue=""
                      onChange={(e) => {
                        const pid = e.target.value;
                        e.target.value = "";
                        if (pid) placePattern(track.id, pid);
                      }}
                    >
                      <option value="" disabled>
                        + pattern
                      </option>
                      {patternList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div
                  style={{ position: "relative", width: widthPx, minHeight: 52, flex: 1 }}
                  onPointerMove={onClipPointerMove}
                  onPointerUp={onClipPointerUp}
                >
                  {/* grid lines */}
                  {Array.from({ length: bars }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: i * pxPerBar,
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: i % 4 === 0 ? border : "rgba(255,255,255,0.03)",
                      }}
                    />
                  ))}
                  {(track.clips ?? []).map((clip) => {
                    const pat = doc.patterns[clip.patternId];
                    const dur = clip.durationTicks ?? pat?.lengthTicks ?? bt;
                    const isSel = selected?.clipId === clip.id;
                    return (
                      <div
                        key={clip.id}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => onClipPointerDown(e, track.id, clip.id, clip.startTick)}
                        style={{
                          position: "absolute",
                          left: tickToX(clip.startTick),
                          width: Math.max(12, tickToX(dur) - 2),
                          top: 8,
                          height: 36,
                          borderRadius: 8,
                          background: clip.muted ? "rgba(80,80,90,0.6)" : color,
                          border: isSel ? `2px solid ${brass}` : "1px solid rgba(0,0,0,0.25)",
                          fontSize: 10,
                          fontWeight: 600,
                          color: "#0a0a0c",
                          padding: "6px 8px",
                          overflow: "hidden",
                          cursor: "grab",
                          userSelect: "none",
                          touchAction: "none",
                          opacity: track.muted ? 0.45 : 1,
                        }}
                        title={`${pat?.name ?? clip.patternId} · bar ${Math.floor(clip.startTick / bt) + 1}`}
                      >
                        {pat?.name ?? "Pattern"}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Playhead */}
          {playingSong && playheadTick != null && (
            <div
              style={{
                position: "absolute",
                left: 88 + tickToX(playheadTick),
                top: 28,
                bottom: 0,
                width: 2,
                background: brass,
                pointerEvents: "none",
                zIndex: 5,
                boxShadow: `0 0 8px ${brass}`,
              }}
            />
          )}
        </div>
      </div>

      {doc.tracks.every((t) => !(t.clips && t.clips.length)) && (
        <p style={{ fontSize: 12, color: muted, margin: 0 }}>
          Add patterns to tracks with the “+ pattern” menu on each row. Drag clips to arrange your
          song. Use sections to mark Intro, Verse, Chorus, and more.
        </p>
      )}
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "6px 10px",
  borderRadius: 999,
  border: `1px solid ${border}`,
  background: "rgba(255,255,255,0.04)",
  color: text,
  cursor: "pointer",
};

const miniBtn: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  width: 22,
  height: 22,
  borderRadius: 6,
  border: `1px solid ${border}`,
  background: "rgba(255,255,255,0.04)",
  cursor: "pointer",
};

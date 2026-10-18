"use client";

/**
 * Thin Beat Studio MVP — virtual keys, record pattern, play, save to project.metadata.beat_studio
 * Does not touch Booth recording or Console DAW graph.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyBeatStudioDoc,
  serializeBeatStudioDoc,
  beatStudioFromProjectMetadata,
  playNote,
  playPattern,
  createNote,
  quantizeTick,
  patternLengthTicks,
  type BeatStudioDoc,
  type PatternPlayer,
} from "@/lib/beat-studio";

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK = [1, 3, 6, 8, 10];
const BASE_C = 60; // middle C

type Props = {
  projectId: string;
  /** Optional initial tempo from project */
  initialTempo?: number | null;
};

export function BeatStudioPanel({ projectId, initialTempo }: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<PatternPlayer | null>(null);
  const recordingRef = useRef(false);
  const recordStartedAtRef = useRef(0);

  const [doc, setDoc] = useState<BeatStudioDoc>(() =>
    emptyBeatStudioDoc({ tempoBpm: initialTempo || 90 })
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [octave, setOctave] = useState(0);

  const getCtx = useCallback(async () => {
    if (!ctxRef.current) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  // Load from project
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) throw new Error("Could not load project");
        const j = await res.json();
        const p = j.project || j;
        const fromMeta = beatStudioFromProjectMetadata(p?.metadata);
        if (!cancelled) {
          if (fromMeta) setDoc(fromMeta);
          else if (typeof p?.tempo === "number") {
            setDoc(emptyBeatStudioDoc({ tempoBpm: p.tempo }));
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      playerRef.current?.stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [projectId]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const payload = serializeBeatStudioDoc(doc);
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { beat_studio: payload } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Save failed");
      }
      setDoc(payload);
      setStatus("Pattern saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [doc, projectId]);

  const onKey = useCallback(
    async (semitone: number) => {
      const pitch = BASE_C + octave * 12 + semitone;
      const ctx = await getCtx();
      const track = doc.tracks[0];
      const inst = track?.instrumentId || "synth_lead";
      playNote(ctx, inst, pitch, 110, 0.35);

      if (recordingRef.current) {
        const elapsed = (ctx.currentTime - recordStartedAtRef.current) * 1000;
        const startTick = quantizeTick(
          Math.round((elapsed / 1000) * (doc.tempoBpm / 60) * doc.ppq),
          Math.round(doc.ppq / 4) // 16th grid
        );
        const durationTicks = Math.round(doc.ppq / 4);
        const note = createNote(pitch, startTick, durationTicks, 110);
        setDoc((prev) => {
          const tracks = prev.tracks.map((t, i) =>
            i === 0 ? { ...t, notes: [...t.notes, note] } : t
          );
          return { ...prev, tracks };
        });
      }
    },
    [doc.ppq, doc.tempoBpm, doc.tracks, getCtx, octave]
  );

  const toggleRecord = useCallback(async () => {
    if (recording) {
      recordingRef.current = false;
      setRecording(false);
      setStatus("Recording stopped");
      return;
    }
    const ctx = await getCtx();
    recordStartedAtRef.current = ctx.currentTime;
    recordingRef.current = true;
    setRecording(true);
    setStatus("Recording — play keys");
  }, [getCtx, recording]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      playerRef.current?.stop();
      playerRef.current = null;
      setPlaying(false);
      return;
    }
    const ctx = await getCtx();
    playerRef.current?.stop();
    playerRef.current = playPattern(ctx, doc, { loop: true });
    setPlaying(true);
    setStatus("Playing pattern");
  }, [doc, getCtx, playing]);

  const clearNotes = useCallback(() => {
    setDoc((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) => (i === 0 ? { ...t, notes: [] } : t)),
    }));
    setStatus("Notes cleared");
  }, []);

  const noteCount = doc.tracks.reduce((n, t) => n + t.notes.length, 0);
  const patternTicks = patternLengthTicks(doc.bars, doc.timeSignature, doc.ppq);

  if (loading) {
    return <p style={{ color: "var(--muted, #9B96A3)" }}>Loading Beat Studio…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: 13, color: "var(--muted, #9B96A3)" }}>
          Tempo{" "}
          <input
            type="number"
            min={40}
            max={200}
            value={doc.tempoBpm}
            onChange={(e) =>
              setDoc((d) => ({ ...d, tempoBpm: Math.max(40, Math.min(200, Number(e.target.value) || 90)) }))
            }
            style={inputStyle}
          />
        </label>
        <span style={{ fontSize: 12, color: "var(--faint, #5C5866)" }}>
          {doc.bars} bars · {noteCount} notes · {patternTicks} ticks
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={toggleRecord} style={btnStyle(recording)}>
          {recording ? "Stop record" : "Record"}
        </button>
        <button type="button" onClick={togglePlay} style={btnStyle(playing)}>
          {playing ? "Stop" : "Play"}
        </button>
        <button type="button" onClick={clearNotes} style={btnStyle(false)}>
          Clear
        </button>
        <button type="button" onClick={save} disabled={saving} style={btnStyle(false, true)}>
          {saving ? "Saving…" : "Save pattern"}
        </button>
        <button type="button" onClick={() => setOctave((o) => Math.max(-2, o - 1))} style={btnStyle(false)}>
          Oct −
        </button>
        <button type="button" onClick={() => setOctave((o) => Math.min(2, o + 1))} style={btnStyle(false)}>
          Oct +
        </button>
      </div>

      {/* Keyboard */}
      <div style={{ position: "relative", height: 120, userSelect: "none" }}>
        <div style={{ display: "flex", height: "100%", gap: 2 }}>
          {WHITE.map((semi) => (
            <button
              key={semi}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                void onKey(semi);
              }}
              style={{
                flex: 1,
                borderRadius: "0 0 8px 8px",
                border: "1px solid rgba(255,255,255,.12)",
                background: "linear-gradient(180deg, #f4f1ec, #d8d2c8)",
                cursor: "pointer",
                minWidth: 0,
              }}
              aria-label={`Key ${semi}`}
            />
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: "58%",
            display: "flex",
            pointerEvents: "none",
          }}
        >
          {/* black key positions approximate between whites */}
          {[0, 1, 3, 4, 5].map((whiteIndex, i) => {
            const semi = BLACK[i];
            if (semi == null) return null;
            const leftPct = ((whiteIndex + 1) / WHITE.length) * 100 - 100 / WHITE.length / 2;
            return (
              <button
                key={semi}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onKey(semi);
                }}
                style={{
                  pointerEvents: "auto",
                  position: "absolute",
                  left: `calc(${leftPct}% - 4%)`,
                  width: "8%",
                  height: "100%",
                  borderRadius: "0 0 6px 6px",
                  border: "1px solid #111",
                  background: "linear-gradient(180deg, #3a3a42, #121218)",
                  cursor: "pointer",
                  zIndex: 2,
                }}
                aria-label={`Black key ${semi}`}
              />
            );
          })}
        </div>
      </div>

      {error && <p style={{ color: "#E07070", fontSize: 13, margin: 0 }}>{error}</p>}
      {status && !error && <p style={{ color: "var(--brass, #E7A961)", fontSize: 13, margin: 0 }}>{status}</p>}
      <p style={{ fontSize: 12, color: "var(--faint, #5C5866)", margin: 0, lineHeight: 1.45 }}>
        MVP: play keys to hear a synth. Hit Record, play a short phrase, Stop, then Play and Save.
        Pattern is stored on the project and reloads with this page — does not replace vocal Booth or Console.
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: 64,
  marginLeft: 6,
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.04)",
  color: "inherit",
};

function btnStyle(active: boolean, primary = false): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 999,
    border: primary
      ? "none"
      : `1px solid ${active ? "rgba(231,169,97,.5)" : "rgba(255,255,255,.12)"}`,
    background: primary
      ? "linear-gradient(135deg,#E8A04A,#C47820)"
      : active
        ? "rgba(231,169,97,.2)"
        : "rgba(255,255,255,.04)",
    color: primary ? "#1A1208" : active ? "#E7A961" : "inherit",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
}

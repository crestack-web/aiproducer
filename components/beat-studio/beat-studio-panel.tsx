"use client";

/**
 * Beat Studio MVP panel — isolated from producer-view / Booth recording.
 * Uses local AudioContext (see lib/beat-studio/TRANSPORT.md).
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
  sixteenthGridTicks,
  patternLengthTicks,
  VoicePool,
  type BeatStudioDoc,
  type InstrumentId,
  type PatternPlayer,
} from "@/lib/beat-studio";

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK = [1, 3, 6, 8, 10];
const BASE_C = 60;

type Props = {
  projectId: string;
  initialTempo?: number | null;
};

type HeldKey = {
  pitch: number;
  startCtxTime: number;
  voiceStop: (when?: number) => void;
};

export function BeatStudioPanel({ projectId, initialTempo }: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<PatternPlayer | null>(null);
  const poolRef = useRef(new VoicePool());
  const recordingRef = useRef(false);
  const recordOriginCtxRef = useRef(0);
  const heldRef = useRef<Map<number, HeldKey>>(new Map());

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
  const [quantize, setQuantize] = useState(false);
  const [instrumentId, setInstrumentId] = useState<InstrumentId>("pluck");

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
          if (fromMeta) {
            setDoc(fromMeta);
            const inst = fromMeta.tracks[0]?.instrumentId;
            if (inst) setInstrumentId(inst);
          } else if (typeof p?.tempo === "number") {
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
      poolRef.current.stopAll();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [projectId]);

  // Keep track instrument in sync
  useEffect(() => {
    setDoc((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) => (i === 0 ? { ...t, instrumentId } : t)),
    }));
  }, [instrumentId]);

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
        throw new Error((j as { error?: string }).error || "Save failed");
      }
      setDoc(payload);
      setStatus("Pattern saved to project");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [doc, projectId]);

  const pointerDown = useCallback(
    async (semitone: number) => {
      const pitch = BASE_C + octave * 12 + semitone;
      if (heldRef.current.has(pitch)) return;
      const ctx = await getCtx();
      const voice = playNote(
        ctx,
        instrumentId,
        pitch,
        110,
        2.5,
        ctx.currentTime,
        undefined,
        poolRef.current
      );
      heldRef.current.set(pitch, {
        pitch,
        startCtxTime: ctx.currentTime,
        voiceStop: voice.stop,
      });
    },
    [getCtx, instrumentId, octave]
  );

  const pointerUp = useCallback(
    async (semitone: number) => {
      const pitch = BASE_C + octave * 12 + semitone;
      const held = heldRef.current.get(pitch);
      if (!held) return;
      heldRef.current.delete(pitch);
      const ctx = await getCtx();
      held.voiceStop(ctx.currentTime);
      if (recordingRef.current) {
        const startSec = held.startCtxTime - recordOriginCtxRef.current;
        const durSec = Math.max(0.05, ctx.currentTime - held.startCtxTime);
        let startTick = Math.round(
          (startSec * doc.tempoBpm * doc.ppq) / 60
        );
        let durationTicks = Math.max(
          1,
          Math.round((durSec * doc.tempoBpm * doc.ppq) / 60)
        );
        if (quantize) {
          const grid = sixteenthGridTicks(doc.ppq);
          startTick = quantizeTick(startTick, grid);
          durationTicks = Math.max(grid, quantizeTick(durationTicks, grid));
        }
        const note = createNote(pitch, startTick, durationTicks, 110);
        setDoc((prev) => {
          const tracks = prev.tracks.map((t, i) =>
            i === 0 ? { ...t, notes: [...t.notes, note] } : t
          );
          return { ...prev, tracks };
        });
      }
    },
    [doc.ppq, doc.tempoBpm, getCtx, octave, quantize]
  );

  const toggleRecord = useCallback(async () => {
    if (recording) {
      // finalize any held keys
      const ctx = await getCtx();
      for (const [pitch, held] of heldRef.current) {
        held.voiceStop(ctx.currentTime);
        if (recordingRef.current) {
          const startSec = held.startCtxTime - recordOriginCtxRef.current;
          const durSec = Math.max(0.05, ctx.currentTime - held.startCtxTime);
          let startTick = Math.round((startSec * doc.tempoBpm * doc.ppq) / 60);
          let durationTicks = Math.max(1, Math.round((durSec * doc.tempoBpm * doc.ppq) / 60));
          if (quantize) {
            const grid = sixteenthGridTicks(doc.ppq);
            startTick = quantizeTick(startTick, grid);
            durationTicks = Math.max(grid, quantizeTick(durationTicks, grid));
          }
          const note = createNote(pitch, startTick, durationTicks, 110);
          setDoc((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t, i) =>
              i === 0 ? { ...t, notes: [...t.notes, note] } : t
            ),
          }));
        }
      }
      heldRef.current.clear();
      recordingRef.current = false;
      setRecording(false);
      setStatus("Recording stopped");
      return;
    }
    const ctx = await getCtx();
    recordOriginCtxRef.current = ctx.currentTime;
    recordingRef.current = true;
    setRecording(true);
    setStatus("Recording — hold keys to set duration");
  }, [doc.ppq, doc.tempoBpm, getCtx, quantize, recording]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      playerRef.current?.stop();
      playerRef.current = null;
      setPlaying(false);
      setStatus("Stopped");
      return;
    }
    const ctx = await getCtx();
    playerRef.current?.stop();
    playerRef.current = playPattern(ctx, doc, {
      loop: doc.loop !== false,
      pool: poolRef.current,
    });
    setPlaying(true);
    setStatus("Playing pattern");
  }, [doc, getCtx, playing]);

  const clearNotes = useCallback(() => {
    playerRef.current?.stop();
    playerRef.current = null;
    setPlaying(false);
    setDoc((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) => (i === 0 ? { ...t, notes: [] } : t)),
    }));
    setStatus("Notes cleared");
  }, []);

  const noteCount = doc.tracks.reduce((n, t) => n + t.notes.length, 0);
  const patternTicks = patternLengthTicks(doc.bars, doc.timeSignature, doc.ppq);
  const recentNotes = doc.tracks[0]?.notes.slice(-8) ?? [];

  if (loading) {
    return <p style={{ color: "#9B96A3" }}>Loading Beat Studio…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={labelStyle}>
          Instrument
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value as InstrumentId)}
            style={selectStyle}
          >
            <option value="pluck">Pluck</option>
            <option value="synth_lead">Lead synth</option>
            <option value="synth_bass">Bass</option>
            <option value="drum_kit">Drums (pitch bands)</option>
          </select>
        </label>
        <label style={labelStyle}>
          Tempo
          <input
            type="number"
            min={40}
            max={200}
            value={doc.tempoBpm}
            onChange={(e) =>
              setDoc((d) => ({
                ...d,
                tempoBpm: Math.max(40, Math.min(200, Number(e.target.value) || 90)),
              }))
            }
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={quantize}
            onChange={(e) => setQuantize(e.target.checked)}
          />
          Quantize 16ths
        </label>
        <span style={{ fontSize: 12, color: "#5C5866" }}>
          {doc.bars} bars · {noteCount} notes · ppq {doc.ppq}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={toggleRecord} style={btnStyle(recording)}>
          {recording ? "Stop record" : "Record"}
        </button>
        <button type="button" onClick={togglePlay} style={btnStyle(playing)}>
          {playing ? "Stop" : "Play pattern"}
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

      <div style={{ position: "relative", height: 120, userSelect: "none", touchAction: "none" }}>
        <div style={{ display: "flex", height: "100%", gap: 2 }}>
          {WHITE.map((semi) => (
            <button
              key={semi}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                void pointerDown(semi);
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                void pointerUp(semi);
              }}
              onPointerCancel={() => void pointerUp(semi)}
              style={whiteKeyStyle}
              aria-label={`Key ${semi}`}
            />
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "58%", display: "flex", pointerEvents: "none" }}>
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
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  void pointerDown(semi);
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void pointerUp(semi);
                }}
                onPointerCancel={() => void pointerUp(semi)}
                style={{
                  ...blackKeyStyle,
                  left: `calc(${leftPct}% - 4%)`,
                }}
                aria-label={`Black key ${semi}`}
              />
            );
          })}
        </div>
      </div>

      {recentNotes.length > 0 && (
        <div style={noteListStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#E7A961", marginBottom: 6 }}>
            RECENT NOTES
          </div>
          {recentNotes.map((n) => (
            <div key={n.id} style={{ fontSize: 12, color: "#9B96A3", fontFamily: "ui-monospace, monospace" }}>
              pitch {n.pitch} · start {n.startTick} · dur {n.durationTicks} · vel {n.velocity}
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#5C5866", marginTop: 4 }}>
            pattern length {patternTicks} ticks
          </div>
        </div>
      )}

      {error && <p style={{ color: "#E07070", fontSize: 13, margin: 0 }}>{error}</p>}
      {status && !error && <p style={{ color: "#E7A961", fontSize: 13, margin: 0 }}>{status}</p>}
      <p style={{ fontSize: 12, color: "#5C5866", margin: 0, lineHeight: 1.45 }}>
        Hold keys while recording to capture duration. Quantize is off by default.
        Saved on the project only — does not change Booth vocals or Console clips.
      </p>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "#9B96A3",
};
const inputStyle: React.CSSProperties = {
  width: 64,
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.04)",
  color: "inherit",
};
const selectStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.12)",
  background: "#121218",
  color: "inherit",
};
const whiteKeyStyle: React.CSSProperties = {
  flex: 1,
  borderRadius: "0 0 8px 8px",
  border: "1px solid rgba(255,255,255,.12)",
  background: "linear-gradient(180deg, #f4f1ec, #d8d2c8)",
  cursor: "pointer",
  minWidth: 0,
};
const blackKeyStyle: React.CSSProperties = {
  pointerEvents: "auto",
  position: "absolute",
  width: "8%",
  height: "100%",
  borderRadius: "0 0 6px 6px",
  border: "1px solid #111",
  background: "linear-gradient(180deg, #3a3a42, #121218)",
  cursor: "pointer",
  zIndex: 2,
};
const noteListStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.09)",
  background: "rgba(255,255,255,.03)",
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

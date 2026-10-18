"use client";

/**
 * Beat Studio — mobile-first production UI
 * Tabs: Beat (step sequencer) · Melody (piano roll) · Sounds
 * Audio: existing Web Audio engine (audio-clock scheduling)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BeatStudioDoc,
  type BeatStudioNote,
  type InstrumentId,
  emptyBeatStudioDoc,
} from "@/lib/beat-studio/types";
import { beatStudioFromProjectMetadata, serializeBeatStudioDoc } from "@/lib/beat-studio/serialize";
import {
  VoicePool,
  playNote,
  playPattern,
  createNote,
  newNoteId,
  type PatternPlayer,
} from "@/lib/beat-studio/engine";
import { patternLengthTicks, ticksToSeconds } from "@/lib/beat-studio/time";
import {
  DRUM_LANES,
  STEPS_PER_BAR,
  notesToStepGrid,
  stepGridToNotes,
  ensureDrumTrack,
  totalSteps,
  defaultStepGrid,
  type StepGrid,
  type DrumLaneId,
} from "@/lib/beat-studio/drums";
import { BEAT_PRESETS, applyPreset, type BeatPresetId } from "@/lib/beat-studio/presets";

const brass = "#E7A961";
const border = "rgba(255,255,255,0.1)";
const muted = "rgba(244,241,236,0.55)";
const text = "#F4F1EC";
const surface = "rgba(18,18,24,0.96)";

type TabId = "beat" | "melody" | "sounds";

const INSTRUMENTS: { id: InstrumentId; label: string; category: string; implemented: boolean }[] = [
  { id: "drum_kit", label: "Drum kit", category: "Drums", implemented: true },
  { id: "pluck", label: "Pluck keys", category: "Piano", implemented: true },
  { id: "synth_bass", label: "Synth bass", category: "Bass", implemented: true },
  { id: "synth_lead", label: "Synth lead", category: "Synths", implemented: true },
];

type Props = { projectId: string; initialTempo?: number };

export default function BeatStudioPanel({ projectId, initialTempo }: Props) {
  const [doc, setDoc] = useState<BeatStudioDoc>(() =>
    emptyBeatStudioDoc({ tempoBpm: initialTempo || 90, bars: 2 })
  );
  const [tab, setTab] = useState<TabId>("beat");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [octave, setOctave] = useState(0);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [rollScroll, setRollScroll] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const poolRef = useRef(new VoicePool());
  const playerRef = useRef<PatternPlayer | null>(null);
  const playT0Ref = useRef(0);
  const rafRef = useRef<number | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const steps = totalSteps(doc.bars);
  const drumTrack = useMemo(
    () =>
      doc.tracks.find((t) => t.instrumentId === "drum_kit" || t.id === "track_drums") ||
      null,
    [doc.tracks]
  );
  const melodyTrack = useMemo(
    () =>
      doc.tracks.find((t) => t.instrumentId !== "drum_kit" && t.id !== "track_drums") ||
      doc.tracks[0] ||
      null,
    [doc.tracks]
  );

  const grid: StepGrid = useMemo(() => {
    if (!drumTrack) {
      return notesToStepGrid([], steps, doc.ppq);
    }
    return notesToStepGrid(drumTrack.notes, steps, doc.ppq);
  }, [drumTrack, steps, doc.ppq]);

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
            let next = { ...fromMeta, tracks: ensureDrumTrack(fromMeta.tracks) };
            setDoc(next);
          } else {
            const base = emptyBeatStudioDoc({
              tempoBpm: typeof p?.tempo === "number" ? p.tempo : initialTempo || 90,
              bars: 2,
            });
            base.tracks = ensureDrumTrack(base.tracks);
            setDoc(base);
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [projectId, initialTempo]);

  const updateDrumGrid = useCallback((next: StepGrid) => {
    setDoc((d) => {
      const notes = stepGridToNotes(next, totalSteps(d.bars), d.ppq);
      let tracks = ensureDrumTrack(d.tracks).map((t) =>
        t.instrumentId === "drum_kit" || t.id === "track_drums"
          ? { ...t, notes }
          : t
      );
      return { ...d, tracks };
    });
  }, []);

  const toggleStep = useCallback(
    (lane: DrumLaneId, step: number) => {
      const g = { ...grid };
      for (const l of DRUM_LANES) g[l.id] = [...(grid[l.id] || [])];
      g[lane][step] = !g[lane][step];
      updateDrumGrid(g);
      // preview hit
      void (async () => {
        const ctx = await getCtx();
        const laneDef = DRUM_LANES.find((l) => l.id === lane);
        if (!laneDef) return;
        playNote(ctx, "drum_kit", laneDef.pitch, 110, 0.15, ctx.currentTime, undefined, poolRef.current);
      })();
    },
    [grid, updateDrumGrid, getCtx]
  );

  const stopPlayback = useCallback(() => {
    playerRef.current?.stop();
    playerRef.current = null;
    poolRef.current.stopAll();
    setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const startPlayback = useCallback(async () => {
    stopPlayback();
    const ctx = await getCtx();
    const d = docRef.current;
    playT0Ref.current = ctx.currentTime;
    playerRef.current = playPattern(ctx, d, {
      pool: poolRef.current,
      loop: d.loop !== false,
    });
    setPlaying(true);

    const patternSec = ticksToSeconds(patternLengthTicks(d), d.tempoBpm, d.ppq);
    const stepSec = patternSec / Math.max(1, totalSteps(d.bars));

    const tick = () => {
      const elapsed = (ctx.currentTime - playT0Ref.current) % Math.max(0.001, patternSec);
      setActiveStep(Math.floor(elapsed / stepSec) % totalSteps(d.bars));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getCtx, stopPlayback]);

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
      setStatus("Pattern saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [doc, projectId]);

  const loadPreset = useCallback((id: BeatPresetId) => {
    const preset = BEAT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    stopPlayback();
    setDoc(applyPreset(preset));
    setStatus(`Loaded “${preset.label}” — edit freely`);
    setTab("beat");
  }, [stopPlayback]);

  const setTempo = (bpm: number) => {
    const v = Math.max(40, Math.min(200, Math.round(bpm)));
    setDoc((d) => ({ ...d, tempoBpm: v }));
  };

  const setMelodyInstrument = (id: InstrumentId) => {
    if (id === "drum_kit") return;
    setDoc((d) => {
      const tracks = d.tracks.map((t) =>
        t.instrumentId !== "drum_kit" && t.id !== "track_drums"
          ? { ...t, instrumentId: id }
          : t
      );
      // ensure melody track exists
      if (!tracks.some((t) => t.instrumentId !== "drum_kit")) {
        tracks.push({
          id: "track_melody",
          name: "Melody",
          instrumentId: id,
          notes: [],
        });
      }
      return { ...d, tracks };
    });
  };

  const addMelodyNote = (pitch: number, startTick: number, durationTicks: number) => {
    setDoc((d) => {
      let tracks = ensureDrumTrack(d.tracks);
      const mi = tracks.findIndex((t) => t.instrumentId !== "drum_kit");
      if (mi < 0) {
        tracks = [
          ...tracks,
          {
            id: "track_melody",
            name: "Melody",
            instrumentId: "pluck",
            notes: [createNote(pitch, startTick, durationTicks, 100)],
          },
        ];
      } else {
        const t = tracks[mi];
        tracks = tracks.map((tr, i) =>
          i === mi
            ? { ...tr, notes: [...tr.notes, createNote(pitch, startTick, durationTicks, 100)] }
            : tr
        );
      }
      return { ...d, tracks };
    });
  };

  const deleteSelectedNote = () => {
    if (!selectedNoteId) return;
    setDoc((d) => ({
      ...d,
      tracks: d.tracks.map((t) => ({
        ...t,
        notes: t.notes.filter((n) => n.id !== selectedNoteId),
      })),
    }));
    setSelectedNoteId(null);
  };

  const clearDrums = () => {
    const g = notesToStepGrid([], steps, doc.ppq);
    updateDrumGrid(g);
  };

  if (loading) {
    return <p style={{ color: muted, padding: 16 }}>Loading Beat Studio…</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      {/* Transport */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderRadius: 16,
          background: surface,
          border: `1px solid ${border}`,
        }}
      >
        <button
          type="button"
          onClick={() => (playing ? stopPlayback() : void startPlayback())}
          style={primaryBtn}
          aria-label={playing ? "Stop" : "Play"}
        >
          {playing ? "Stop" : "Play"}
        </button>
        <label style={labelStyle}>
          BPM
          <input
            type="number"
            min={40}
            max={200}
            value={doc.tempoBpm}
            onChange={(e) => setTempo(Number(e.target.value) || 90)}
            style={numInput}
          />
        </label>
        <label style={labelStyle}>
          Bars
          <select
            value={doc.bars}
            onChange={(e) => {
              const bars = Number(e.target.value) || 2;
              setDoc((d) => ({ ...d, bars }));
            }}
            style={numInput}
          >
            {[1, 2, 4].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={doc.loop !== false}
            onChange={(e) => setDoc((d) => ({ ...d, loop: e.target.checked }))}
          />
          Loop
        </label>
        <button type="button" onClick={() => void save()} disabled={saving} style={ghostBtn}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 14,
          background: "rgba(0,0,0,0.35)",
          border: `1px solid ${border}`,
        }}
      >
        {(
          [
            ["beat", "Beat"],
            ["melody", "Melody"],
            ["sounds", "Sounds"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              flex: 1,
              padding: "10px 8px",
              borderRadius: 11,
              border: "none",
              background: tab === id ? "rgba(231,169,97,0.2)" : "transparent",
              color: tab === id ? brass : muted,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Presets strip */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
        {BEAT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => loadPreset(p.id)}
            title={p.description}
            style={{
              flexShrink: 0,
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: "rgba(0,0,0,0.3)",
              color: text,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "#F87171", margin: 0, fontSize: 13 }}>{error}</p>}
      {status && <p style={{ color: brass, margin: 0, fontSize: 13 }}>{status}</p>}

      {tab === "beat" && (
        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${border}`,
            background: surface,
            padding: "12px 8px 14px",
            overflowX: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: muted, letterSpacing: "0.06em" }}>
              STEP SEQUENCER · {steps} steps
            </span>
            <button type="button" onClick={clearDrums} style={{ ...ghostBtn, padding: "4px 10px", fontSize: 11 }}>
              Clear
            </button>
          </div>
          {DRUM_LANES.map((lane) => (
            <div
              key={lane.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    const ctx = await getCtx();
                    playNote(ctx, "drum_kit", lane.pitch, 110, 0.15, ctx.currentTime, undefined, poolRef.current);
                  })()
                }
                style={{
                  width: 56,
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  color: lane.color,
                  background: "transparent",
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  padding: "4px 2px",
                }}
              >
                {lane.label}
              </button>
              <div style={{ display: "flex", gap: 3, flex: 1 }}>
                {Array.from({ length: steps }, (_, s) => {
                  const on = grid[lane.id]?.[s];
                  const isPlay = playing && activeStep === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-label={`${lane.label} step ${s + 1}`}
                      onClick={() => toggleStep(lane.id, s)}
                      style={{
                        flex: 1,
                        minWidth: steps > 16 ? 14 : 18,
                        height: 28,
                        borderRadius: 5,
                        border: isPlay ? `1px solid ${brass}` : "1px solid transparent",
                        background: on
                          ? lane.color
                          : s % 4 === 0
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(255,255,255,0.04)",
                        opacity: on ? 1 : 0.85,
                        cursor: "pointer",
                        padding: 0,
                        boxShadow: isPlay ? `0 0 0 1px ${brass}` : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <p style={{ margin: "10px 4px 0", fontSize: 11, color: muted, lineHeight: 1.4 }}>
            Tap a step to toggle. Tap the lane name to preview the sound. Play loops the pattern.
          </p>
        </div>
      )}

      {tab === "melody" && (
        <MelodyRoll
          notes={melodyTrack?.notes || []}
          ppq={doc.ppq}
          bars={doc.bars}
          tempoBpm={doc.tempoBpm}
          octave={octave}
          setOctave={setOctave}
          selectedNoteId={selectedNoteId}
          setSelectedNoteId={setSelectedNoteId}
          onAddNote={addMelodyNote}
          onDelete={deleteSelectedNote}
          onPreview={async (pitch) => {
            const ctx = await getCtx();
            const id = (melodyTrack?.instrumentId || "pluck") as InstrumentId;
            playNote(ctx, id === "drum_kit" ? "pluck" : id, pitch, 100, 0.25, ctx.currentTime, undefined, poolRef.current);
          }}
          activeStep={playing ? activeStep : -1}
          steps={steps}
        />
      )}

      {tab === "sounds" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: muted }}>
            Choose how the melody track sounds. Drums always use the drum kit synthesizer.
          </p>
          {["Drums", "Piano", "Bass", "Synths"].map((cat) => (
            <div key={cat}>
              <div style={{ fontSize: 11, fontWeight: 700, color: muted, letterSpacing: "0.08em", marginBottom: 6 }}>
                {cat.toUpperCase()}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {INSTRUMENTS.filter((i) => i.category === cat).map((inst) => {
                  const active =
                    inst.id === "drum_kit"
                      ? true
                      : melodyTrack?.instrumentId === inst.id;
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      disabled={!inst.implemented}
                      onClick={() => {
                        if (inst.id === "drum_kit") {
                          void (async () => {
                            const ctx = await getCtx();
                            playNote(ctx, "drum_kit", 36, 110, 0.2, ctx.currentTime, undefined, poolRef.current);
                          })();
                          return;
                        }
                        setMelodyInstrument(inst.id);
                        void (async () => {
                          const ctx = await getCtx();
                          playNote(ctx, inst.id, 60, 100, 0.3, ctx.currentTime, undefined, poolRef.current);
                        })();
                      }}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: active ? `1px solid ${brass}` : `1px solid ${border}`,
                        background: active ? "rgba(231,169,97,0.15)" : surface,
                        color: text,
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: "pointer",
                        opacity: inst.implemented ? 1 : 0.4,
                      }}
                    >
                      {inst.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p style={{ margin: 0, fontSize: 11, color: muted }}>
            All listed sounds are synthesized in-browser (no sample packs). More categories can be added later.
          </p>
        </div>
      )}
    </div>
  );
}

/** Compact piano roll — tap grid to add notes, select to delete */
function MelodyRoll({
  notes,
  ppq,
  bars,
  tempoBpm,
  octave,
  setOctave,
  selectedNoteId,
  setSelectedNoteId,
  onAddNote,
  onDelete,
  onPreview,
  activeStep,
  steps,
}: {
  notes: BeatStudioNote[];
  ppq: number;
  bars: number;
  tempoBpm: number;
  octave: number;
  setOctave: (n: number | ((o: number) => number)) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
  onAddNote: (pitch: number, startTick: number, durationTicks: number) => void;
  onDelete: () => void;
  onPreview: (pitch: number) => void;
  activeStep: number;
  steps: number;
}) {
  const pitches = useMemo(() => {
    // C3..B4 relative to octave offset (base MIDI 48)
    const base = 48 + octave * 12;
    return Array.from({ length: 24 }, (_, i) => base + (23 - i));
  }, [octave]);

  const cellW = 28;
  const cellH = 18;
  const patternTicks = bars * 4 * ppq;
  const cols = steps; // 16th grid

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${border}`,
        background: surface,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: muted }}>PIANO ROLL</span>
        <button type="button" style={ghostBtn} onClick={() => setOctave((o) => o - 1)}>
          Oct −
        </button>
        <button type="button" style={ghostBtn} onClick={() => setOctave((o) => o + 1)}>
          Oct +
        </button>
        <button type="button" style={ghostBtn} onClick={onDelete} disabled={!selectedNoteId}>
          Delete note
        </button>
      </div>
      <div style={{ overflow: "auto", maxHeight: 320, WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}>
        <div style={{ position: "relative", width: cols * cellW + 36, minHeight: pitches.length * cellH }}>
          {pitches.map((pitch, row) => (
            <div key={pitch} style={{ display: "flex", height: cellH }}>
              <button
                type="button"
                onClick={() => onPreview(pitch)}
                style={{
                  width: 36,
                  flexShrink: 0,
                  fontSize: 9,
                  color: muted,
                  background: isBlackKey(pitch) ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.06)",
                  border: "none",
                  borderRight: `1px solid ${border}`,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {pitchName(pitch)}
              </button>
              {Array.from({ length: cols }, (_, col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => {
                    const startTick = Math.round(col * (ppq / 4));
                    const dur = Math.round(ppq / 4);
                    onAddNote(pitch, startTick, dur);
                    onPreview(pitch);
                  }}
                  style={{
                    width: cellW,
                    height: cellH,
                    border: "none",
                    borderRight: col % 4 === 3 ? `1px solid ${border}` : "1px solid rgba(255,255,255,0.04)",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background:
                      activeStep === col
                        ? "rgba(231,169,97,0.12)"
                        : col % 4 === 0
                          ? "rgba(255,255,255,0.03)"
                          : "transparent",
                    padding: 0,
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          ))}
          {/* Note blocks */}
          {notes.map((n) => {
            const col = Math.round(n.startTick / (ppq / 4));
            const row = pitches.indexOf(n.pitch);
            if (row < 0 || col < 0) return null;
            const w = Math.max(cellW * 0.9, (n.durationTicks / (ppq / 4)) * cellW);
            const selected = n.id === selectedNoteId;
            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNoteId(n.id);
                }}
                style={{
                  position: "absolute",
                  left: 36 + col * cellW + 1,
                  top: row * cellH + 1,
                  width: w - 2,
                  height: cellH - 2,
                  borderRadius: 4,
                  background: selected ? brass : "rgba(123,235,212,0.75)",
                  border: selected ? "1px solid #fff" : "1px solid rgba(0,0,0,0.3)",
                  pointerEvents: "auto",
                  cursor: "pointer",
                  zIndex: 2,
                }}
              />
            );
          })}
        </div>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: muted }}>
        Tap a cell to place a 16th note · tap a note to select · Delete note removes it · {tempoBpm} BPM
      </p>
    </div>
  );
}

function isBlackKey(pitch: number) {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}
function pitchName(pitch: number) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 999,
  border: "none",
  background: `linear-gradient(135deg, ${brass}, #C4893F)`,
  color: "#1A1208",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  border: `1px solid ${border}`,
  background: "transparent",
  color: text,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 10,
  color: muted,
  fontWeight: 600,
};
const numInput: React.CSSProperties = {
  width: 64,
  padding: "6px 8px",
  borderRadius: 8,
  border: `1px solid ${border}`,
  background: "rgba(0,0,0,0.35)",
  color: text,
  fontSize: 13,
};

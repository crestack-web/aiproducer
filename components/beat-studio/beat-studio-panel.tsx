"use client";

/**
 * Beat Studio — BandLab-inspired mobile flow
 * Studio (timeline) → tap instrument emoji → pattern editor sheet
 * Audio: existing Web Audio engine
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BeatStudioDoc,
  type BeatStudioNote,
  type InstrumentId,
  emptyBeatStudioDoc,
} from "@/lib/beat-studio/types";
import { beatStudioFromProjectMetadata, serializeBeatStudioDoc } from "@/lib/beat-studio/serialize";
import { ensureV2 } from "@/lib/beat-studio/migrate";
import { updateTrackNotes } from "@/lib/beat-studio/adapter";
import {
  VoicePool,
  playNote,
  playPattern,
  playArrangement,
  createNote,
  type PatternPlayer,
} from "@/lib/beat-studio/engine";
import { patternLengthTicks, ticksToSeconds, secondsToTicks } from "@/lib/beat-studio/time";
import {
  DRUM_LANES,
  notesToStepGrid,
  stepGridToNotes,
  totalSteps,
  type StepGrid,
  type DrumLaneId,
} from "@/lib/beat-studio/drums";
import { BEAT_PRESETS, applyPreset, type BeatPresetId } from "@/lib/beat-studio/presets";
import ArrangementTimeline from "@/components/beat-studio/arrangement-timeline";

const brass = "#E7A961";
const border = "rgba(255,255,255,0.1)";
const muted = "rgba(244,241,236,0.55)";
const text = "#F4F1EC";
const surface = "rgba(18,18,24,0.96)";

const INSTRUMENT_META: {
  id: InstrumentId;
  label: string;
  emoji: string;
  category: string;
}[] = [
  { id: "drum_kit", label: "Drums", emoji: "🥁", category: "Drums" },
  { id: "pluck", label: "Keys", emoji: "🎹", category: "Piano" },
  { id: "synth_bass", label: "Bass", emoji: "🎸", category: "Bass" },
  { id: "synth_lead", label: "Lead", emoji: "✨", category: "Synths" },
];

function metaFor(id: InstrumentId) {
  return INSTRUMENT_META.find((m) => m.id === id) || { id, label: id, emoji: "🎵", category: "Sound" };
}

type StudioView = "studio" | "edit";

type Props = {
  projectId: string;
  initialTempo?: number;
  initialTitle?: string;
  onTitleChange?: (title: string) => void;
};

export default function BeatStudioPanel({ projectId, initialTempo, initialTitle, onTitleChange }: Props) {
  const [doc, setDoc] = useState<BeatStudioDoc>(() =>
    emptyBeatStudioDoc({ tempoBpm: initialTempo || 90, bars: 2 })
  );
  const [view, setView] = useState<StudioView>("studio");
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [beatName, setBeatName] = useState(initialTitle || "Untitled beat");
  const [editingName, setEditingName] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<"pattern" | "song" | null>(null);
  const [playheadTick, setPlayheadTick] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [octave, setOctave] = useState(0);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const poolRef = useRef(new VoicePool());
  const playerRef = useRef<PatternPlayer | null>(null);
  const playT0Ref = useRef(0);
  const rafRef = useRef<number | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const saveGenRef = useRef(0);

  const steps = totalSteps(doc.bars);

  const editingTrack = useMemo(
    () => doc.tracks.find((t) => t.id === editingTrackId) || null,
    [doc.tracks, editingTrackId]
  );

  const drumTrack = useMemo(
    () =>
      doc.tracks.find((t) => t.instrumentId === "drum_kit" || t.id === "track_drums") || null,
    [doc.tracks]
  );

  const grid: StepGrid = useMemo(() => {
    if (!editingTrack || editingTrack.instrumentId !== "drum_kit") {
      if (!drumTrack) return notesToStepGrid([], steps, doc.ppq);
      return notesToStepGrid(drumTrack.notes ?? [], steps, doc.ppq);
    }
    return notesToStepGrid(editingTrack.notes ?? [], steps, doc.ppq);
  }, [editingTrack, drumTrack, steps, doc.ppq]);

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
    if (initialTitle) setBeatName(initialTitle);
  }, [initialTitle]);

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
        const meta = p?.metadata;
        const loaded = beatStudioFromProjectMetadata(meta);
        if (!cancelled) {
          setDoc(ensureV2(loaded || emptyBeatStudioDoc({ tempoBpm: p?.tempo || initialTempo || 90 })));
          if (typeof p?.title === "string" && p.title.trim()) {
            setBeatName(p.title.trim());
            onTitleChange?.(p.title.trim());
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
    };
  }, [projectId, initialTempo, onTitleChange]);

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      poolRef.current.stopAll();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      void ctxRef.current?.close();
    };
  }, []);

  const openTrackEditor = useCallback((trackId: string) => {
    setEditingTrackId(trackId);
    setView("edit");
    setShowAdd(false);
    setSelectedNoteId(null);
  }, []);

  const closeEditor = useCallback(() => {
    setView("studio");
    setEditingTrackId(null);
    setSelectedNoteId(null);
  }, []);

  const updateDrumGrid = useCallback(
    (g: StepGrid) => {
      setDoc((d) => {
        const base = ensureV2(d);
        const track =
          base.tracks.find((t) => t.id === editingTrackId && t.instrumentId === "drum_kit") ||
          base.tracks.find((t) => t.instrumentId === "drum_kit" || t.id === "track_drums");
        if (!track) return d;
        const notes = stepGridToNotes(g, base.ppq);
        return updateTrackNotes(base, track.id, notes);
      });
    },
    [editingTrackId]
  );

  const toggleStep = useCallback(
    (lane: DrumLaneId, step: number) => {
      const g = { ...grid };
      for (const l of DRUM_LANES) g[l.id] = [...(grid[l.id] || [])];
      g[lane][step] = !g[lane][step];
      updateDrumGrid(g);
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
    setPlayMode(null);
    setPlayheadTick(null);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const startPatternPreview = useCallback(async () => {
    stopPlayback();
    const ctx = await getCtx();
    const d = docRef.current;
    playT0Ref.current = ctx.currentTime;
    setPlayMode("pattern");
    setPlayheadTick(null);
    playerRef.current = playPattern(ctx, d, {
      pool: poolRef.current,
      loop: d.loop !== false,
    });
    setPlaying(true);

    const patternSec = ticksToSeconds(
      patternLengthTicks(d.bars, d.timeSignature, d.ppq),
      d.tempoBpm,
      d.ppq
    );
    const stepSec = patternSec / Math.max(1, totalSteps(d.bars));

    const tick = () => {
      const elapsed = (ctx.currentTime - playT0Ref.current) % Math.max(0.001, patternSec);
      setActiveStep(Math.floor(elapsed / stepSec) % totalSteps(d.bars));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getCtx, stopPlayback]);

  const startSongPlayback = useCallback(async () => {
    stopPlayback();
    const ctx = await getCtx();
    const d = ensureV2(docRef.current);
    playT0Ref.current = ctx.currentTime;
    setPlayMode("song");
    setPlayheadTick(0);
    playerRef.current = playArrangement(ctx, d, {
      pool: poolRef.current,
      loop: d.loop === true,
    });
    setPlaying(true);

    const songSec = Math.max(
      0.05,
      ticksToSeconds(
        d.songLengthTicks || patternLengthTicks(d.bars, d.timeSignature, d.ppq),
        d.tempoBpm,
        d.ppq
      )
    );

    const tick = () => {
      const elapsed = ctx.currentTime - playT0Ref.current;
      if (d.loop === true) {
        const local = elapsed % songSec;
        setPlayheadTick(secondsToTicks(local, d.tempoBpm, d.ppq));
      } else {
        if (elapsed >= songSec) {
          stopPlayback();
          setPlayheadTick(d.songLengthTicks);
          return;
        }
        setPlayheadTick(secondsToTicks(elapsed, d.tempoBpm, d.ppq));
      }
      const patternSec = ticksToSeconds(
        patternLengthTicks(d.bars, d.timeSignature, d.ppq),
        d.tempoBpm,
        d.ppq
      );
      const stepSec = patternSec / Math.max(1, totalSteps(d.bars));
      const local = elapsed % Math.max(0.001, patternSec);
      setActiveStep(Math.floor(local / stepSec) % totalSteps(d.bars));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getCtx, stopPlayback]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    const snapshot = ensureV2(docRef.current);
    const saveId = (saveGenRef.current += 1);
    try {
      const payload = serializeBeatStudioDoc(snapshot);
      const title = beatName.trim().slice(0, 120) || "Untitled beat";
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          metadata: { beat_studio: payload },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Save failed");
      }
      if (saveId !== saveGenRef.current) return;
      setDoc(payload);
      setStatus("Saved");
    } catch (e) {
      if (saveId === saveGenRef.current) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    } finally {
      if (saveId === saveGenRef.current) setSaving(false);
    }
  }, [projectId, beatName]);

  const loadPreset = useCallback(
    (id: BeatPresetId) => {
      const preset = BEAT_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      stopPlayback();
      setDoc(ensureV2(applyPreset(preset)));
      setStatus(`Loaded “${preset.label}”`);
    },
    [stopPlayback]
  );

  const setTempo = (bpm: number) => {
    const v = Math.max(40, Math.min(200, Math.round(bpm)));
    setDoc((d) => ({ ...d, tempoBpm: v }));
  };

  const setTrackInstrument = (trackId: string, id: InstrumentId) => {
    setDoc((d) => {
      const base = ensureV2(d);
      return {
        ...base,
        tracks: base.tracks.map((t) =>
          t.id === trackId ? { ...t, instrumentId: id, name: metaFor(id).label } : t
        ),
      };
    });
  };

  const addInstrumentTrack = (id: InstrumentId) => {
    setDoc((d) => {
      const base = ensureV2(d);
      if (base.tracks.some((t) => t.instrumentId === id && id === "drum_kit")) {
        // only one drum kit track
        const existing = base.tracks.find((t) => t.instrumentId === "drum_kit");
        if (existing) {
          setTimeout(() => openTrackEditor(existing.id), 0);
          return base;
        }
      }
      const meta = metaFor(id);
      const trackId = `track_${id}_${Date.now().toString(36)}`;
      const patId = `pat_${id}_${Date.now().toString(36)}`;
      const lengthTicks =
        base.songLengthTicks ||
        patternLengthTicks(base.bars, base.timeSignature, base.ppq);
      const pattern = {
        id: patId,
        name: meta.label,
        lengthTicks: patternLengthTicks(base.bars, base.timeSignature, base.ppq),
        notes: [] as BeatStudioNote[],
        kind: (id === "drum_kit" ? "drum" : "melodic") as "drum" | "melodic",
      };
      return {
        ...base,
        patterns: { ...base.patterns, [patId]: pattern },
        tracks: [
          ...base.tracks,
          {
            id: trackId,
            name: meta.label,
            instrumentId: id,
            clips: [
              {
                id: `clip_${trackId}`,
                patternId: patId,
                startTick: 0,
                durationTicks: lengthTicks,
              },
            ],
            notes: [],
          },
        ],
      };
    });
    setShowAdd(false);
    setStatus(`Added ${metaFor(id).label}`);
  };

  const addMelodyNote = (pitch: number, startTick: number, durationTicks: number) => {
    setDoc((d) => {
      const base = ensureV2(d);
      const track =
        base.tracks.find((t) => t.id === editingTrackId) ||
        base.tracks.find((t) => t.instrumentId !== "drum_kit");
      if (!track || track.instrumentId === "drum_kit") return d;
      const nextNotes = [
        ...(track.notes || []),
        createNote(pitch, startTick, durationTicks, 100),
      ];
      return updateTrackNotes(base, track.id, nextNotes);
    });
  };

  const deleteSelectedNote = () => {
    if (!selectedNoteId) return;
    const noteId = selectedNoteId;
    setDoc((d) => {
      const base = ensureV2(d);
      const track =
        base.tracks.find((t) => t.id === editingTrackId) ||
        base.tracks.find(
          (t) =>
            t.instrumentId !== "drum_kit" &&
            (t.notes || []).some((n) => n.id === noteId)
        );
      if (!track) return d;
      const nextNotes = (track.notes || []).filter((n) => n.id !== noteId);
      return updateTrackNotes(base, track.id, nextNotes);
    });
    setSelectedNoteId(null);
  };

  const clearDrums = () => {
    const g = notesToStepGrid([], steps, doc.ppq);
    updateDrumGrid(g);
  };

  if (loading) {
    return <p style={{ color: muted, padding: 16 }}>Loading Beat Studio…</p>;
  }

  const editMeta = editingTrack ? metaFor(editingTrack.instrumentId) : null;
  const isDrumEdit = editingTrack?.instrumentId === "drum_kit";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        maxWidth: "100%",
        minHeight: "70vh",
        paddingBottom: view === "studio" ? 100 : 12,
        overflowX: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Top bar — beat name + compact controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "nowrap",
          minWidth: 0,
        }}
      >
        {view === "edit" ? (
          <button type="button" onClick={closeEditor} style={{ ...ghostBtn, flexShrink: 0 }} aria-label="Back to timeline">
            ←
          </button>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          {view === "edit" && editMeta ? (
            <div style={{ fontWeight: 800, fontSize: 15, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {editMeta.emoji} {editMeta.label}
            </div>
          ) : editingName ? (
            <input
              autoFocus
              value={beatName}
              maxLength={120}
              onChange={(e) => setBeatName(e.target.value)}
              onBlur={() => {
                setEditingName(false);
                const t = beatName.trim().slice(0, 120) || "Untitled beat";
                setBeatName(t);
                onTitleChange?.(t);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setBeatName(initialTitle || "Untitled beat");
                  setEditingName(false);
                }
              }}
              aria-label="Beat name"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${brass}`,
                background: "rgba(0,0,0,0.4)",
                color: text,
                fontWeight: 800,
                fontSize: 15,
                outline: "none",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              title="Rename beat"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  display: "block",
                  fontWeight: 800,
                  fontSize: 16,
                  color: text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {beatName}
              </span>
              <span style={{ fontSize: 10, color: muted }}>Tap to rename</span>
            </button>
          )}
        </div>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 10 }}>BPM</span>
          <input
            type="number"
            min={40}
            max={200}
            value={doc.tempoBpm}
            onChange={(e) => setTempo(Number(e.target.value) || 90)}
            style={{ ...numInput, width: 48 }}
          />
        </label>
        <button type="button" onClick={() => void save()} disabled={saving} style={{ ...ghostBtn, flexShrink: 0 }}>
          {saving ? "…" : "Save"}
        </button>
      </div>

      {error && (
        <p style={{ color: "#f87171", margin: 0, fontSize: 13 }} role="alert">
          {error}
        </p>
      )}
      {status && (
        <p style={{ color: brass, margin: 0, fontSize: 12 }}>{status}</p>
      )}

      {/* STUDIO VIEW — timeline first */}
      {view === "studio" && (
        <>
          <ArrangementTimeline
            doc={ensureV2(doc)}
            onChange={(d) => setDoc(ensureV2(d))}
            playheadTick={playheadTick}
            playingSong={playMode === "song" && playing}
            onEditTrack={openTrackEditor}
            songLabel={beatName}
          />

          {/* Compact preset chips */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
            {BEAT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => loadPreset(p.id)}
                style={{
                  ...chipBtn,
                  whiteSpace: "nowrap",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Add track picker */}
          {showAdd && (
            <div
              style={{
                padding: 12,
                borderRadius: 16,
                background: surface,
                border: `1px solid ${border}`,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: muted, marginBottom: 10 }}>
                ADD INSTRUMENT
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 10,
                }}
              >
                {INSTRUMENT_META.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      addInstrumentTrack(m.id);
                      // open editor for newest matching track after state settles
                      setTimeout(() => {
                        const latest = docRef.current.tracks.filter((t) => t.instrumentId === m.id).at(-1);
                        if (latest) openTrackEditor(latest.id);
                      }, 50);
                    }}
                    style={instrumentTile}
                  >
                    <span style={{ fontSize: 28 }}>{m.emoji}</span>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{m.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                style={{ ...ghostBtn, marginTop: 10, width: "100%" }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}

      {/* EDIT VIEW — pattern roll for selected instrument */}
      {view === "edit" && editingTrack && (
        <div
          style={{
            borderRadius: 16,
            background: surface,
            border: `1px solid ${border}`,
            padding: 12,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void startPatternPreview()}
              style={{
                ...ghostBtn,
                borderColor: playMode === "pattern" && playing ? brass : border,
              }}
            >
              {playMode === "pattern" && playing ? "Previewing…" : "Preview loop"}
            </button>
            <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}>
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
            {!isDrumEdit && (
              <select
                value={editingTrack.instrumentId}
                onChange={(e) =>
                  setTrackInstrument(editingTrack.id, e.target.value as InstrumentId)
                }
                style={numInput}
              >
                {INSTRUMENT_META.filter((m) => m.id !== "drum_kit").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji} {m.label}
                  </option>
                ))}
              </select>
            )}
            {isDrumEdit && (
              <button type="button" onClick={clearDrums} style={ghostBtn}>
                Clear
              </button>
            )}
            <button type="button" onClick={closeEditor} style={primaryBtn}>
              Done
            </button>
          </div>

          {isDrumEdit ? (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: muted,
                  marginBottom: 8,
                }}
              >
                STEP SEQUENCER · {steps} steps
              </div>
              {DRUM_LANES.map((lane) => (
                <div
                  key={lane.id}
                  style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      void (async () => {
                        const ctx = await getCtx();
                        playNote(
                          ctx,
                          "drum_kit",
                          lane.pitch,
                          110,
                          0.15,
                          ctx.currentTime,
                          undefined,
                          poolRef.current
                        );
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
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
              <p style={{ margin: "10px 4px 0", fontSize: 11, color: muted, lineHeight: 1.4 }}>
                Tap steps to program the loop. Done returns to the timeline.
              </p>
            </div>
          ) : (
            <MelodyRoll
              notes={editingTrack.notes || []}
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
                const id = editingTrack.instrumentId;
                playNote(
                  ctx,
                  id === "drum_kit" ? "pluck" : id,
                  pitch,
                  100,
                  0.25,
                  ctx.currentTime,
                  undefined,
                  poolRef.current
                );
              }}
              activeStep={playing ? activeStep : -1}
              steps={steps}
            />
          )}
        </div>
      )}

      {/* Bottom transport + instrument dock (studio only) */}
      {view === "studio" && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            marginTop: "auto",
            padding: "10px 8px 12px",
            borderRadius: "18px 18px 0 0",
            background: "rgba(10,10,14,0.96)",
            borderTop: `1px solid ${border}`,
            backdropFilter: "blur(12px)",
            zIndex: 20,
          }}
        >
          {/* Transport */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              marginBottom: 12,
            }}
          >
            <button
              type="button"
              onClick={() => stopPlayback()}
              disabled={!playing}
              style={circleBtn}
              aria-label="Stop"
            >
              ■
            </button>
            <button
              type="button"
              onClick={() => {
                if (playing && playMode === "song") stopPlayback();
                else void startSongPlayback();
              }}
              style={{
                ...circleBtn,
                width: 56,
                height: 56,
                fontSize: 20,
                background:
                  playMode === "song" && playing
                    ? "linear-gradient(135deg,#7BEBD4,#2dd4bf)"
                    : `linear-gradient(135deg, ${brass}, #C4893F)`,
                color: "#1A1208",
                border: "none",
              }}
              aria-label={playing && playMode === "song" ? "Pause" : "Play song"}
            >
              {playing && playMode === "song" ? "❚❚" : "▶"}
            </button>
            <button
              type="button"
              onClick={() => void startPatternPreview()}
              style={circleBtn}
              aria-label="Preview pattern"
              title="Preview pattern"
            >
              ↻
            </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: muted,
              }}
            >
              <input
                type="checkbox"
                checked={doc.loop !== false}
                onChange={(e) => setDoc((d) => ({ ...d, loop: e.target.checked }))}
              />
              Loop
            </label>
          </div>

          {/* Instrument dock — emoji buttons */}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "center",
              alignItems: "center",
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {doc.tracks.map((t) => {
              const m = metaFor(t.instrumentId);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTrackEditor(t.id)}
                  style={{
                    ...instrumentDockBtn,
                    outline:
                      editingTrackId === t.id ? `2px solid ${brass}` : "none",
                  }}
                  title={`Edit ${t.name}`}
                >
                  <span style={{ fontSize: 22 }}>{m.emoji}</span>
                  <span style={{ fontSize: 10, fontWeight: 700 }}>{m.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              style={{
                ...instrumentDockBtn,
                borderStyle: "dashed",
              }}
              aria-label="Add instrument"
            >
              <span style={{ fontSize: 22 }}>＋</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>Add</span>
            </button>
          </div>
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
  setOctave: (n: number) => void;
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
  onAddNote: (pitch: number, startTick: number, durationTicks: number) => void;
  onDelete: () => void;
  onPreview: (pitch: number) => void;
  activeStep: number;
  steps: number;
}) {
  const base = 48 + octave * 12;
  const pitches = Array.from({ length: 18 }, (_, i) => base + 17 - i);
  const cellW = Math.max(18, Math.min(28, Math.floor(280 / Math.max(8, steps))));
  const cellH = 18;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: muted, letterSpacing: "0.06em" }}>
          PIANO ROLL
        </span>
        <button type="button" style={ghostBtn} onClick={() => setOctave(Math.max(-2, octave - 1))}>
          Oct −
        </button>
        <button type="button" style={ghostBtn} onClick={() => setOctave(Math.min(2, octave + 1))}>
          Oct +
        </button>
        <button type="button" style={ghostBtn} onClick={onDelete} disabled={!selectedNoteId}>
          Delete note
        </button>
      </div>
      <div style={{ overflowX: "auto", borderRadius: 10, border: `1px solid ${border}` }}>
        <div style={{ position: "relative", width: 36 + steps * cellW, minHeight: pitches.length * cellH }}>
          {pitches.map((pitch, row) => (
            <div key={pitch} style={{ display: "flex", height: cellH }}>
              <button
                type="button"
                onClick={() => onPreview(pitch)}
                style={{
                  width: 36,
                  flexShrink: 0,
                  fontSize: 9,
                  border: "none",
                  borderBottom: `1px solid ${border}`,
                  background: isBlackKey(pitch) ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.04)",
                  color: muted,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {pitchName(pitch)}
              </button>
              {Array.from({ length: steps }, (_, col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => {
                    const startTick = col * (ppq / 4);
                    const durationTicks = ppq / 4;
                    onAddNote(pitch, startTick, durationTicks);
                    onPreview(pitch);
                  }}
                  style={{
                    width: cellW,
                    height: cellH,
                    border: "none",
                    borderBottom: `1px solid ${border}`,
                    borderRight: col % 4 === 3 ? `1px solid ${border}` : "1px solid rgba(255,255,255,0.03)",
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
        Tap a cell to place a note · Done returns to the timeline · {tempoBpm} BPM
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
const chipBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 999,
  border: `1px solid ${border}`,
  background: "rgba(0,0,0,0.35)",
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
const circleBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  border: `1px solid ${border}`,
  background: "rgba(255,255,255,0.06)",
  color: text,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const instrumentDockBtn: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  width: 56,
  height: 56,
  borderRadius: 14,
  border: `1px solid ${border}`,
  background: "rgba(255,255,255,0.05)",
  color: text,
  cursor: "pointer",
  flexShrink: 0,
};
const instrumentTile: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  padding: "14px 8px",
  borderRadius: 14,
  border: `1px solid ${border}`,
  background: "rgba(255,255,255,0.04)",
  color: text,
  cursor: "pointer",
};

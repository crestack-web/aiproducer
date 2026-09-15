"use client";

/**
 * Producer View — Phase 1.1
 * Real waveforms (Web Audio decode + peak cache) + functional mute/solo mix.
 * Playback monitoring only — does not change decision map / export.
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
  projectId?: string;
  beatUrl: string | null;
  beatDurationMs?: number | null;
  sections: ProducerSection[];
  layers: ProducerLayer[];
  onClose?: () => void;
  onOpenTweak?: () => void;
  /** Parent refreshes tasks after a timeline edit is saved */
  onLayersChanged?: () => void;
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

/** Peak buckets cached per URL — shared across zoom redraws. */
const peakCache = new Map<string, Float32Array>();
const bufferCache = new Map<string, AudioBuffer>();

async function fetchDecode(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer | null> {
  if (bufferCache.has(url)) return bufferCache.get(url)!;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr.slice(0));
    bufferCache.set(url, buf);
    return buf;
  } catch (e) {
    console.warn("[producer-view] decode failed", url, e);
    return null;
  }
}

/** Downsample channel peaks into `buckets` max-abs values. */
function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
  const cacheKey = `${buf.length}:${buf.sampleRate}:${buckets}`;
  // Prefer URL-level cache set by caller; this is compute-only
  const ch = buf.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const block = Math.max(1, Math.floor(ch.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(ch.length, start + block);
    for (let j = start; j < end; j++) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

function peaksForUrl(url: string, buf: AudioBuffer, buckets: number): Float32Array {
  const key = `${url}::${buckets}`;
  const hit = peakCache.get(key);
  if (hit) return hit;
  // Also reuse high-res peaks by resampling if we have 2048
  const hiKey = `${url}::2048`;
  const hi = peakCache.get(hiKey);
  if (hi && buckets < 2048) {
    const out = new Float32Array(buckets);
    const ratio = hi.length / buckets;
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const a = Math.floor(i * ratio);
      const b = Math.min(hi.length, Math.floor((i + 1) * ratio));
      for (let j = a; j < b; j++) if (hi[j] > max) max = hi[j];
      out[i] = max;
    }
    peakCache.set(key, out);
    return out;
  }
  const peaks = computePeaks(buf, buckets);
  peakCache.set(key, peaks);
  if (buckets === 2048) peakCache.set(hiKey, peaks);
  return peaks;
}

function WaveformCanvas({
  peaks,
  color,
  width,
  height,
  dimmed,
}: {
  peaks: Float32Array | null;
  color: string;
  width: number;
  height: number;
  dimmed?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || width < 2) return;
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    c.width = Math.floor(width * dpr);
    c.height = Math.floor(height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!peaks || peaks.length === 0) {
      // subtle placeholder line
      ctx.strokeStyle = color + "55";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }
    const mid = height / 2;
    ctx.fillStyle = dimmed ? color + "66" : color;
    const n = peaks.length;
    const barW = Math.max(1, width / n);
    for (let i = 0; i < n; i++) {
      const amp = Math.min(1, peaks[i] * 1.35);
      const h = Math.max(1, amp * (height * 0.9));
      const x = i * barW;
      ctx.fillRect(x, mid - h / 2, Math.max(1, barW - 0.5), h);
    }
  }, [peaks, color, width, height, dimmed]);
  return <canvas ref={ref} style={{ display: "block", width, height, borderRadius: 6 }} />;
}

export function ProducerView({
  projectTitle,
  projectId,
  beatUrl,
  beatDurationMs: durationProp,
  sections,
  layers: layersProp,
  onClose,
  onOpenTweak,
  onLayersChanged,
}: Props) {
  const { colors: C } = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<Map<string, GainNode>>(new Map());
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);

  const [layers, setLayers] = useState(layersProp);
  const [durationMs, setDurationMs] = useState(durationProp || 0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>("beat");
  const [pxPerSec, setPxPerSec] = useState(56);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [peaksById, setPeaksById] = useState<Record<string, Float32Array | null>>({});

  const [decodeStatus, setDecodeStatus] = useState<string>("");
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addType, setAddType] = useState("custom");
  const [addBusy, setAddBusy] = useState(false);
  const addFileRef = useRef<HTMLInputElement | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: "move" | "trim-start" | "trim-end";
    originX: number;
    originStart: number;
    originEnd: number;
    lastStart: number;
    lastEnd: number;
  } | null>(null);

  async function persistLayer(
    id: string,
    patch: { start_ms?: number; end_ms?: number; status?: string }
  ) {
    setSavingId(id);
    setEditMsg(null);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save edit");
        return false;
      }
      onLayersChanged?.();
      return true;
    } catch {
      setEditMsg("Network error saving edit");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function updateLocalLayer(id: string, startMs: number, endMs: number) {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, startMs, endMs } : l)));
  }

  function onClipPointerDown(
    e: React.PointerEvent,
    id: string,
    mode: "move" | "trim-start" | "trim-end",
    startMs: number,
    endMs: number
  ) {
    if (id === "beat") return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
    dragRef.current = {
      id,
      mode,
      originX: e.clientX,
      originStart: startMs,
      originEnd: endMs,
      lastStart: startMs,
      lastEnd: endMs,
    };
  }

  function onClipPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dxMs = ((e.clientX - d.originX) / pxPerSec) * 1000;
    let start = d.originStart;
    let end = d.originEnd;
    const minLen = 400;
    if (d.mode === "move") {
      const dur = d.originEnd - d.originStart;
      start = Math.max(0, d.originStart + dxMs);
      end = start + dur;
      if (end > totalMs) {
        end = totalMs;
        start = Math.max(0, end - dur);
      }
    } else if (d.mode === "trim-start") {
      start = Math.max(0, Math.min(d.originEnd - minLen, d.originStart + dxMs));
    } else {
      end = Math.min(totalMs, Math.max(d.originStart + minLen, d.originEnd + dxMs));
    }
    const s = Math.round(start);
    const en = Math.round(end);
    d.lastStart = s;
    d.lastEnd = en;
    updateLocalLayer(d.id, s, en);
  }

  function onClipPointerUp() {
    const d = dragRef.current;
    if (!d || d.id === "beat") {
      dragRef.current = null;
      return;
    }
    const { id, lastStart, lastEnd } = d;
    dragRef.current = null;
    void persistLayer(id, { start_ms: lastStart, end_ms: lastEnd });
  }

  async function deleteLayer(id: string) {
    if (id === "beat") return;
    if (!window.confirm("Remove this layer from the plan? The recorded take stays saved.")) return;
    const ok = await persistLayer(id, { status: "skipped" });
    if (ok) setLayers((prev) => prev.filter((l) => l.id !== id));
  }

  async function createTrack(file?: File | null) {
    if (!projectId) {
      setEditMsg("Missing project — cannot add track");
      return;
    }
    setAddBusy(true);
    setEditMsg(null);
    try {
      const startMs = Math.round(playheadMs);
      const res = await fetch(`/api/projects/${projectId}/recording-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: addType,
          title: addTitle.trim() || undefined,
          start_ms: startMs,
          end_ms: startMs + 8000,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditMsg(typeof j.error === "string" ? j.error : "Could not create track");
        return;
      }
      const task = j.task as {
        id: string;
        type?: string;
        title?: string;
        start_ms?: number;
        end_ms?: number;
      };
      if (!task?.id) {
        setEditMsg("Track created but no id returned");
        return;
      }

      let audioUrl: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch(`/api/recording-tasks/${task.id}/recordings`, {
          method: "POST",
          body: fd,
        });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok) {
          setEditMsg(
            typeof uj.error === "string"
              ? uj.error
              : "Track created; upload failed — record a take in the booth"
          );
        } else {
          audioUrl =
            uj.recording?.audio_url ||
            uj.audio_url ||
            uj.recording?.url ||
            null;
          // mark completed if upload ok
          await fetch(`/api/recording-tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "completed" }),
          }).catch(() => null);
        }
      }

      setLayers((prev) => [
        ...prev,
        {
          id: task.id,
          label: (task.type || addType).replace(/_/g, " "),
          role: task.type || addType,
          sectionLabel: task.title || addTitle || "Custom",
          startMs: Number(task.start_ms) || startMs,
          endMs: Number(task.end_ms) || startMs + 8000,
          audioUrl,
        },
      ]);
      setShowAddTrack(false);
      setAddTitle("");
      setAddType("custom");
      onLayersChanged?.();
    } catch {
      setEditMsg("Network error creating track");
    } finally {
      setAddBusy(false);
    }
  }



  // Merge URLs from session-preview if projectId given
  useEffect(() => {
    setLayers(layersProp);
  }, [layersProp]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/session-preview`);
        if (!res.ok) return;
        const j = await res.json();
        const recs: { task_id?: string; audio_url?: string }[] = j.recordings || j.takes || [];
        if (!Array.isArray(recs) || cancelled) return;
        setLayers((prev) =>
          prev.map((l) => {
            if (l.audioUrl) return l;
            const hit = recs.find((r) => r.task_id === l.id && r.audio_url);
            return hit?.audio_url ? { ...l, audioUrl: hit.audio_url } : l;
          })
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const totalMs = useMemo(() => {
    let max = durationMs || 0;
    for (const s of sections) max = Math.max(max, s.endMs || 0);
    for (const l of layers) max = Math.max(max, l.endMs || 0);
    return Math.max(max, 45_000);
  }, [durationMs, sections, layers]);

  const timelineW = Math.max(360, (totalMs / 1000) * pxPerSec);
  const peakBuckets = Math.min(2048, Math.max(64, Math.floor(timelineW)));

  const tracks = useMemo(() => {
    const list: {
      id: string;
      label: string;
      kind: "beat" | "vocal";
      color: string;
      startMs: number;
      endMs: number;
      sub?: string;
      url?: string | null;
    }[] = [];
    list.push({
      id: "beat",
      label: "Beat",
      kind: "beat",
      color: ROLE_COLORS.beat,
      startMs: 0,
      endMs: totalMs,
      url: beatUrl,
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
        url: l.audioUrl,
      });
    }
    return list;
  }, [layers, totalMs, beatUrl]);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC =
        typeof window !== "undefined"
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
          : null;
      if (!AC) return null;
      audioCtxRef.current = new AC();
    }
    return audioCtxRef.current;
  }, []);

  // Decode all tracks once; cache peaks at 2048 resolution
  useEffect(() => {
    let cancelled = false;
    const ctx = getCtx();
    if (!ctx) return;
    (async () => {
      setDecodeStatus("Loading waveforms…");
      const next: Record<string, Float32Array | null> = {};
      for (const tr of tracks) {
        if (!tr.url) {
          next[tr.id] = null;
          continue;
        }
        const buf = await fetchDecode(ctx, tr.url);
        if (cancelled) return;
        if (buf) {
          if (tr.id === "beat") {
            setDurationMs((d) => Math.max(d, Math.round(buf.duration * 1000)));
          }
          // store high-res peaks once
          peaksForUrl(tr.url, buf, 2048);
          next[tr.id] = peaksForUrl(tr.url, buf, peakBuckets);
        } else {
          next[tr.id] = null;
        }
      }
      if (!cancelled) {
        setPeaksById(next);
        setDecodeStatus("");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.map((t) => t.url).join("|"), getCtx]);

  // Re-bucket peaks when zoom changes (from cache, no re-decode)
  useEffect(() => {
    setPeaksById((prev) => {
      const next: Record<string, Float32Array | null> = { ...prev };
      for (const tr of tracks) {
        if (!tr.url) continue;
        const hi = peakCache.get(`${tr.url}::2048`);
        if (hi) {
          next[tr.id] = peaksForUrl(tr.url, bufferCache.get(tr.url)!, peakBuckets);
        }
      }
      return next;
    });
  }, [peakBuckets, tracks]);

  function isAudible(id: string, kind: "beat" | "vocal") {
    // Solo = selected track + beat for context (producer checking a layer against the beat)
    if (soloId) {
      if (id === soloId) return true;
      if (kind === "beat") return true;
      return false;
    }
    return !muted[id];
  }

  function applyGains() {
    for (const tr of tracks) {
      const g = gainsRef.current.get(tr.id);
      if (!g) continue;
      const on = isAudible(tr.id, tr.kind);
      g.gain.setTargetAtTime(on ? 1 : 0, audioCtxRef.current?.currentTime || 0, 0.02);
    }
  }

  useEffect(() => {
    applyGains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, soloId, tracks]);

  function stopSources() {
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current = [];
    gainsRef.current.clear();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  function tickPlayhead() {
    const ctx = audioCtxRef.current;
    if (!ctx || !playing) return;
    const elapsed = (ctx.currentTime - startedAtRef.current) * 1000 + offsetRef.current;
    setPlayheadMs(Math.min(totalMs, Math.max(0, elapsed)));
    if (elapsed >= totalMs) {
      setPlaying(false);
      stopSources();
      return;
    }
    rafRef.current = requestAnimationFrame(tickPlayhead);
  }

  async function startPlayback(fromMs: number) {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
    stopSources();
    offsetRef.current = fromMs;
    startedAtRef.current = ctx.currentTime;
    const startSec = fromMs / 1000;

    for (const tr of tracks) {
      if (!tr.url) continue;
      let buf = bufferCache.get(tr.url) || null;
      if (!buf) buf = await fetchDecode(ctx, tr.url);
      if (!buf) continue;

      const gain = ctx.createGain();
      const on = isAudible(tr.id, tr.kind);
      gain.gain.value = on ? 1 : 0;
      gain.connect(ctx.destination);
      gainsRef.current.set(tr.id, gain);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);

      // Vocals: offset by section start on the timeline
      if (tr.kind === "vocal") {
        const layerStart = tr.startMs / 1000;
        const localOffset = startSec - layerStart;
        if (localOffset >= buf.duration) {
          // past this clip
          continue;
        }
        if (localOffset >= 0) {
          src.start(0, localOffset);
        } else {
          // playhead before clip — schedule start later
          src.start(ctx.currentTime + -localOffset, 0);
        }
      } else {
        if (startSec >= buf.duration) continue;
        src.start(0, startSec);
      }
      sourcesRef.current.push(src);
    }

    setPlaying(true);
    setPlayheadMs(fromMs);
    rafRef.current = requestAnimationFrame(tickPlayhead);
  }

  function togglePlay() {
    if (playing) {
      const ctx = audioCtxRef.current;
      if (ctx) {
        offsetRef.current =
          (ctx.currentTime - startedAtRef.current) * 1000 + offsetRef.current;
      }
      stopSources();
      setPlaying(false);
    } else {
      void startPlayback(playheadMs);
    }
  }

  function seekTo(ms: number) {
    const clamped = Math.max(0, Math.min(totalMs, ms));
    setPlayheadMs(clamped);
    if (playing) {
      void startPlayback(clamped);
    }
  }

  useEffect(() => {
    return () => {
      stopSources();
      try {
        audioCtxRef.current?.close();
      } catch {
        /* */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <button type="button" onClick={onClose} style={iconBtn(border, surface, text)} aria-label="Close">
            ←
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: brass, fontWeight: 700 }}>
            PRODUCER VIEW · PHASE 3
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
        <button type="button" onClick={() => setPxPerSec((z) => Math.max(28, z - 12))} style={iconBtn(border, surface, text)}>
          −
        </button>
        <button type="button" onClick={() => setPxPerSec((z) => Math.min(140, z + 12))} style={iconBtn(border, surface, text)}>
          +
        </button>
      </div>

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
          style={{
            width: 48,
            height: 48,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${brass})`,
            color: "#1A1208",
            fontWeight: 800,
            fontSize: 16,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(231,169,97,0.35)",
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, color: mutedText }}>
          {formatMs(playheadMs)}
          <span style={{ color: faint }}> / {formatMs(totalMs)}</span>
        </div>
        {decodeStatus && (
          <span style={{ fontSize: 12, color: faint }}>{decodeStatus}</span>
        )}
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
          Edit · monitor
        </span>
      </div>
      {editMsg && (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 12,
            color: "#E8756A",
            background: "rgba(232,117,106,0.1)",
            borderBottom: `1px solid ${border}`,
          }}
        >
          {editMsg}
        </div>
      )}
      {savingId && (
        <div style={{ padding: "6px 14px", fontSize: 12, color: faint, borderBottom: `1px solid ${border}` }}>
          Saving edit…
        </div>
      )}

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
                seekTo(((e.clientX - rect.left) / pxPerSec) * 1000);
              }}
            >
              {sections.map((s) => (
                <div
                  key={s.id}
                  title={s.label}
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

        {tracks.map((tr) => {
          const expanded = expandedId === tr.id;
          const isMuted = muted[tr.id];
          const isSolo = soloId === tr.id;
          const dimmed = !isAudible(tr.id, tr.kind);
          const clipW = Math.max(10, msToX(tr.endMs) - msToX(tr.startMs));
          const clipH = expanded ? 64 : 36;
          return (
            <div
              key={tr.id}
              style={{
                display: "flex",
                minWidth: timelineW + 108,
                borderBottom: `1px solid ${border}`,
                opacity: dimmed ? 0.45 : 1,
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
                <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    title="Mute (monitor only)"
                    onClick={() => setMuted((m) => ({ ...m, [tr.id]: !m[tr.id] }))}
                    style={miniChip(border, brass, isMuted, text)}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    title="Solo + beat (monitor only)"
                    onClick={() => setSoloId(soloId === tr.id ? null : tr.id)}
                    style={miniChip(border, brass, isSolo, text)}
                  >
                    S
                  </button>
                  {tr.kind === "vocal" && (
                    <button
                      type="button"
                      title="Remove from plan"
                      disabled={savingId === tr.id}
                      onClick={() => void deleteLayer(tr.id)}
                      style={miniChip(border, "#E8756A", false, text)}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  width: timelineW,
                  height: expanded ? 88 : 56,
                  transition: "height 0.15s ease",
                  background: "rgba(0,0,0,0.15)",
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  seekTo(((e.clientX - rect.left) / pxPerSec) * 1000);
                }}
              >
                <div
                  data-layer-id={tr.id}
                  onPointerMove={onClipPointerMove}
                  onPointerUp={onClipPointerUp}
                  onPointerCancel={onClipPointerUp}
                  style={{
                    position: "absolute",
                    left: msToX(tr.startMs),
                    width: clipW,
                    top: expanded ? 12 : 10,
                    height: clipH,
                    borderRadius: 8,
                    background: `linear-gradient(180deg, ${tr.color}33, ${tr.color}18)`,
                    boxShadow: `inset 0 0 0 1px ${tr.color}66`,
                    overflow: "hidden",
                    cursor: tr.kind === "vocal" ? "grab" : "default",
                    touchAction: "none",
                  }}
                  onPointerDown={
                    tr.kind === "vocal"
                      ? (e) => onClipPointerDown(e, tr.id, "move", tr.startMs, tr.endMs)
                      : undefined
                  }
                >
                  <WaveformCanvas
                    peaks={peaksById[tr.id] || null}
                    color={tr.color}
                    width={clipW}
                    height={clipH}
                    dimmed={dimmed}
                  />
                  {tr.kind === "vocal" && (
                    <>
                      <div
                        onPointerDown={(e) =>
                          onClipPointerDown(e, tr.id, "trim-start", tr.startMs, tr.endMs)
                        }
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 14,
                          background: "rgba(255,255,255,0.35)",
                          cursor: "ew-resize",
                          touchAction: "none",
                        }}
                      />
                      <div
                        onPointerDown={(e) =>
                          onClipPointerDown(e, tr.id, "trim-end", tr.startMs, tr.endMs)
                        }
                        style={{
                          position: "absolute",
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: 14,
                          background: "rgba(255,255,255,0.35)",
                          cursor: "ew-resize",
                          touchAction: "none",
                        }}
                      />
                    </>
                  )}
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
              Record and save takes in the booth — completed layers appear here with real waveforms.
            </p>
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: "12px 14px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          borderTop: `1px solid ${border}`,
          background: surface,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {!showAddTrack ? (
          <button
            type="button"
            onClick={() => setShowAddTrack(true)}
            disabled={!projectId}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: `1px dashed ${brass}`,
              background: "rgba(231,169,97,0.08)",
              color: brass,
              fontWeight: 700,
              fontSize: 14,
              cursor: projectId ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            + Add Track
          </button>
        ) : (
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 14,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              background: bg,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>New track</div>
            <p style={{ margin: 0, fontSize: 12, color: mutedText }}>
              Starts at playhead ({formatMs(playheadMs)}). Same plan as the booth — not a separate mix.
            </p>
            <input
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="Name (optional)"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${border}`,
                background: surface,
                color: text,
                fontFamily: "inherit",
                fontSize: 14,
              }}
            />
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${border}`,
                background: surface,
                color: text,
                fontFamily: "inherit",
                fontSize: 14,
              }}
            >
              <option value="custom">Custom</option>
              <option value="lead">Lead</option>
              <option value="double">Double</option>
              <option value="harmony">Harmony</option>
              <option value="harmony_high">Harmony high</option>
              <option value="harmony_low">Harmony low</option>
              <option value="adlib">Ad-lib</option>
              <option value="background">Background</option>
            </select>
            <input
              ref={addFileRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm"
              style={{ fontSize: 13, color: mutedText }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={addBusy}
                onClick={() => {
                  const f = addFileRef.current?.files?.[0] || null;
                  void createTrack(f);
                }}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "none",
                  background: brass,
                  color: "#1A1208",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {addBusy ? "Adding…" : "Add to plan"}
              </button>
              <button
                type="button"
                disabled={addBusy}
                onClick={() => setShowAddTrack(false)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: mutedText,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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

function miniChip(border: string, brass: string, on: boolean, text: string): React.CSSProperties {
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

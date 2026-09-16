"use client";

/**
 * Console — AI-DAW timeline for a project (/app/console/[id]).
 *
 * Naming: Booth = guided record (/app/studio/[id]); Studio = hub (/app/studio).
 * Shared: same recording_tasks / takes as Booth. Capture uses Booth live pipeline
 * (openRecordingStream + createVocalRecorder) — never a parallel recorder.
 * Offline AP (restore/pitch/mix/master) only after save, same as Booth.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { STUDIO_LOGO_URL } from "@/lib/brand";
import { openRecordingStream, createVocalRecorder } from "@/lib/audio/recording-engine";

export type TrackFx = {
  gainDb: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  compress: number; // 0–1
  reverb: number;
  delay: number;
  saturation: number;
  /** Stereo pan: -1 = full left, 0 = center, 1 = full right */
  pan: number;
};

export const DEFAULT_TRACK_FX: TrackFx = {
  gainDb: 0,
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  compress: 0,
  reverb: 0,
  delay: 0,
  saturation: 0,
  pan: 0,
};

export type ProducerLayer = {
  id: string;
  label: string;
  role: string;
  sectionLabel?: string;
  startMs: number;
  endMs: number;
  audioUrl?: string | null;
  color?: string;
  trackFx?: TrackFx | null;
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
  /** BPM from project analysis when available — never invent a number */
  tempoBpm?: number | null;
  boothHref?: string | null;
  libraryHref?: string | null;
  onClose?: () => void;
  onOpenTweak?: () => void;
  /** When false, song-wide prompt stays gated; track prompts still need a take */
  tweaksEnabled?: boolean;
  tweaksGateMessage?: string;
  onLayersChanged?: () => void;
};

function formatPlayhead(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function ZoomIcon({ zoomIn }: { zoomIn: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {zoomIn ? (
        <>
          <path d="M11 8v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

const TRACK_COLOR_PRESETS = [
  "#34D399",
  "#A78BFA",
  "#818CF8",
  "#C084FC",
  "#E879F9",
  "#F472B6",
  "#FB7185",
  "#FBBF24",
  "#F59E0B",
  "#38BDF8",
  "#67E8F9",
  "#94A3B8",
  "#E7A961",
  "#4ADE80",
  "#F87171",
];

const ROLE_COLORS: Record<string, string> = {
  lead: "#A78BFA",
  double: "#6366F1",
  harmony: "#D946EF",
  harmony_high: "#E879F9",
  harmony_mid: "#C026D3",
  harmony_low: "#9333EA",
  adlib: "#F43F5E",
  background: "#64748B",
  intro: "#22D3EE",
  outro: "#06B6D4",
  beat: "#22C55E",
  custom: "#F59E0B",
};

function roleColor(role: string) {
  const k = (role || "lead").toLowerCase().replace(/\s+/g, "_");
  if (ROLE_COLORS[k]) return ROLE_COLORS[k];
  if (k.includes("harmon")) return ROLE_COLORS.harmony;
  if (k.includes("adlib") || k.includes("ad-lib")) return ROLE_COLORS.adlib;
  if (k.includes("double")) return ROLE_COLORS.double;
  return "#7BEBD4";
}

/** Locked heights so left rail rows and timeline lanes share one grid */
const TRACK_RULER_H = 40;
const TRACK_ROW_H = 64;
const TRACK_ROW_H_EXPANDED = 96;

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


/** In-place live peaks while recording into a mock/planned clip — same passive analyser data */
function LiveClipWave({
  peaks,
  color,
  width,
  height,
}: {
  peaks: number[];
  color: string;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.floor(width * dpr));
    c.height = Math.max(1, Math.floor(height * dpr));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, width, height);
    const n = Math.max(1, peaks.length);
    const mid = height / 2;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    for (let i = 0; i < n; i++) {
      const x = (i / n) * width;
      const amp = Math.min(1, peaks[i] || 0) * (height * 0.42);
      const barW = Math.max(1, width / n);
      ctx.fillRect(x, mid - amp, barW, amp * 2);
    }
    // recording head
    ctx.fillStyle = "#F07167";
    ctx.fillRect(Math.max(0, width - 2), 0, 2, height);
  }, [peaks, color, width, height]);
  return (
    <canvas
      ref={ref}
      style={{ display: "block", width, height, borderRadius: 6 }}
    />
  );
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
    // Solid clip fill + dense waveform (Suno-style)
    ctx.fillStyle = dimmed ? color + "44" : color + "CC";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = dimmed ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)";
    const n = peaks.length;
    const barW = Math.max(1.2, width / n);
    for (let i = 0; i < n; i++) {
      const amp = Math.min(1, peaks[i] * 1.55);
      const h = Math.max(2, amp * (height * 0.82));
      const x = i * barW;
      ctx.fillRect(x, mid - h / 2, Math.max(1.2, barW - 0.35), h);
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
  tweaksEnabled = false,
  tweaksGateMessage = "Add a beat or take to direct AP",
  onLayersChanged,
  tempoBpm = null,
  boothHref = null,
  libraryHref = "/app",
}: Props) {
  const { colors: C } = useTheme();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingScroll = useRef(false);

  function onHeaderScroll() {
    if (syncingScroll.current) return;
    const h = headerScrollRef.current;
    const tl = timelineScrollRef.current;
    if (!h || !tl) return;
    syncingScroll.current = true;
    tl.scrollTop = h.scrollTop;
    syncingScroll.current = false;
  }

  function onTimelineScroll() {
    if (syncingScroll.current) return;
    const h = headerScrollRef.current;
    const tl = timelineScrollRef.current;
    if (!h || !tl) return;
    syncingScroll.current = true;
    h.scrollTop = tl.scrollTop;
    syncingScroll.current = false;
  }


  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<Map<string, GainNode>>(new Map());
  const panNodesRef = useRef<Map<string, StereoPannerNode>>(new Map());
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);

  const [layers, setLayers] = useState(layersProp);
  const [durationMs, setDurationMs] = useState(durationProp || 0);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>("beat");
  const [pxPerSec, setPxPerSec] = useState(56);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem("console_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [titleDraft, setTitleDraft] = useState(projectTitle || "Session");
  useEffect(() => {
    setTitleDraft(projectTitle || "Session");
  }, [projectTitle]);
  const [soloId, setSoloId] = useState<string | null>(null);
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [peaksById, setPeaksById] = useState<Record<string, Float32Array | null>>({});

  const [decodeStatus, setDecodeStatus] = useState<string>("");
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [promptBarOpen, setPromptBarOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => {
      const narrow = mq.matches;
      setIsNarrow(narrow);
      if (narrow) {
        setSidebarCollapsed(true);
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [isConsoleRecording, setIsConsoleRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  /** Live input level 0–1 — passive analyser tap, not in monitor/capture path */
  const [liveLevel, setLiveLevel] = useState(0);
  /** Rolling peak samples for in-clip live waveform while recording */
  const [livePeaks, setLivePeaks] = useState<number[]>([]);
  /** Armed task — Record captures into this planned/mock clip */
  const [armedTrackId, setArmedTrackId] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null);
  const consoleRecRef = useRef<{
    recorder: MediaRecorder;
    chunks: BlobPart[];
    stream: MediaStream;
    dispose: () => void;
    taskId: string;
    startedAt: number;
  } | null>(null);
  const recordTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveMeterRafRef = useRef<number | null>(null);
  const liveMeterCtxRef = useRef<AudioContext | null>(null);
  const livePeaksBufRef = useRef<number[]>([]);
  const beatFileInputRef = useRef<HTMLInputElement | null>(null);
  const [fxById, setFxById] = useState<Record<string, TrackFx>>({});
  const [fxOpenId, setFxOpenId] = useState<string | null>(null);
  const [colorById, setColorById] = useState<Record<string, string>>({});
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [trackPrompt, setTrackPrompt] = useState("");
  const [trackPromptBusy, setTrackPromptBusy] = useState(false);



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

  async function submitTrackPrompt() {
    if (!projectId || !trackPrompt.trim()) return;
    const trackScope =
      selectedTrackId && selectedTrackId !== "beat"
        ? selectedTrackId
        : null;
    // Song-wide still needs produced master path (tweaksEnabled); track needs take on server
    if (!trackScope && !tweaksEnabled) {
      setEditMsg(tweaksGateMessage);
      return;
    }
    setTrackPromptBusy(true);
    setEditMsg(null);
    try {
      const tr = tracks.find((x) => x.id === selectedTrackId);
      const res = await fetch(`/api/projects/${projectId}/tweak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trackPrompt.trim(),
          task_id: trackScope || undefined,
          track_id: trackScope || undefined,
          scope: trackScope ? "track" : "song",
          playbackMs: playheadMs,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditMsg(
          typeof j.error === "string"
            ? j.error
            : typeof j.message === "string"
              ? j.message
              : "Tweak failed"
        );
      } else if (j.needsClarification || j.needsVariationPick) {
        setEditMsg(
          typeof j.message === "string"
            ? j.message
            : typeof j.plain === "string"
              ? j.plain
              : "Try a more specific request"
        );
      } else {
        setTrackPrompt("");
        setEditMsg(
          typeof j.plain === "string"
            ? j.plain
            : typeof j.summary === "string"
              ? j.summary
              : trackScope
                ? "Updated this track"
                : "Song tweak applied"
        );
        onLayersChanged?.();
        onOpenTweak?.();
      }
    } catch {
      setEditMsg("Network error sending prompt");
    } finally {
      setTrackPromptBusy(false);
    }
  }

  async function persistColor(id: string, color: string) {
    setColorById((prev) => ({ ...prev, [id]: color }));
    setColorPickerId(null);
    setSavingId(id);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_color: color }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save color");
      } else {
        onLayersChanged?.();
      }
    } catch {
      setEditMsg("Network error saving color");
    } finally {
      setSavingId(null);
    }
  }

  async function persistFx(id: string, fx: TrackFx) {
    setFxById((prev) => ({ ...prev, [id]: fx }));
    setSavingId(id);
    try {
      const res = await fetch(`/api/recording-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_fx: fx }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setEditMsg(typeof j.error === "string" ? j.error : "Could not save FX");
      } else {
        onLayersChanged?.();
      }
    } catch {
      setEditMsg("Network error saving FX");
    } finally {
      setSavingId(null);
    }
  }

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


  async function ensureRecordTargetTask(): Promise<string | null> {
    if (!projectId) return null;
    // Prefer armed mock/planned clip, then selected vocal — never create a parallel task for those
    const prefer = [armedTrackId, selectedTrackId].filter(
      (id): id is string => Boolean(id) && id !== "beat"
    );
    for (const id of prefer) {
      const exists = layers.some((l) => l.id === id) || tracks.some((tr) => tr.id === id);
      if (exists) {
        setSelectedTrackId(id);
        setArmedTrackId(id);
        return id;
      }
    }
    // Create a new lead at playhead
    setAddType("lead");
    const startMs = Math.round(playheadMs);
    const res = await fetch(`/api/projects/${projectId}/recording-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "lead",
        title: "Lead (Console)",
        start_ms: startMs,
        end_ms: startMs + 30000,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.task?.id) {
      setEditMsg(typeof j.error === "string" ? j.error : "Could not create record target");
      return null;
    }
    const task = j.task;
    setLayers((prev) => [
      ...prev,
      {
        id: task.id,
        label: "lead",
        role: "lead",
        sectionLabel: task.title || "Lead",
        startMs: Number(task.start_ms) || startMs,
        endMs: Number(task.end_ms) || startMs + 30000,
      },
    ]);
    setSelectedTrackId(task.id);
    return task.id as string;
  }

  async function stopConsoleRecord() {
    const rec = consoleRecRef.current;
    if (!rec) {
      setIsConsoleRecording(false);
      return;
    }
    if (recordTickRef.current) {
      clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
    try {
      if (monitorAudioRef.current) {
        monitorAudioRef.current.pause();
        monitorAudioRef.current = null;
      }
      stopSources();
      setPlaying(false);
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      rec.recorder.onstop = () => resolve();
      try {
        if (rec.recorder.state !== "inactive") rec.recorder.stop();
        else resolve();
      } catch {
        resolve();
      }
    });
    rec.stream.getTracks().forEach((tr) => tr.stop());
    try {
      rec.dispose();
    } catch {
      /* ignore */
    }
    const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || "audio/webm" });
    const durationMs = Math.max(500, Date.now() - rec.startedAt);
    const taskId = rec.taskId;
    consoleRecRef.current = null;
    setIsConsoleRecording(false);
    setRecordSeconds(0);
    stopLiveMeter();
    setLivePeaks([]);
    livePeaksBufRef.current = [];

    if (blob.size < 100) {
      setEditMsg("Recording too short — try again");
      return;
    }

    setEditMsg("Saving take…");
    try {
      const fd = new FormData();
      fd.append("file", blob, `console-take-${Date.now()}.webm`);
      fd.append("duration_ms", String(durationMs));
      const up = await fetch(`/api/recording-tasks/${taskId}/recordings`, {
        method: "POST",
        body: fd,
      });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) {
        setEditMsg(typeof uj.error === "string" ? uj.error : "Upload failed");
        return;
      }
      await fetch(`/api/recording-tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          end_ms: Math.round((layers.find((l) => l.id === taskId)?.startMs || playheadMs) + durationMs),
        }),
      }).catch(() => null);

      const audioUrl =
        uj.recording?.audio_url || uj.audio_url || uj.recording?.url || null;
      if (audioUrl) {
        setLayers((prev) =>
          prev.map((l) =>
            l.id === taskId
              ? {
                  ...l,
                  audioUrl,
                  endMs: Math.max(l.endMs, l.startMs + durationMs),
                }
              : l
          )
        );
      }
      setEditMsg("Take saved — shared with Booth (same recording_tasks)");
      setArmedTrackId(taskId);
      setSelectedTrackId(taskId);
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function startConsoleRecord() {
    if (!projectId) {
      setEditMsg("Missing project");
      return;
    }
    if (isConsoleRecording) return;
    setEditMsg(null);
    const taskId = await ensureRecordTargetTask();
    if (!taskId) return;

    try {
      const opened = await openRecordingStream({
        preferredInputId: "",
        outputPreference: "__headphones__",
      });
      const { recorder, mimeType } = createVocalRecorder(opened.recordStream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      consoleRecRef.current = {
        recorder,
        chunks,
        stream: opened.stream,
        dispose: opened.dispose,
        taskId,
        startedAt: Date.now(),
      };
      recorder.start(250);
      setIsConsoleRecording(true);
      setRecordSeconds(0);
      // Passive level meter on cloned mic tracks (not in capture or monitor path)
      startLiveMeter(opened.stream);
      recordTickRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      // Monitor beat on a separate <audio> (never connected to MediaRecorder)
      const layer = layers.find((l) => l.id === taskId);
      const fromMs = layer?.startMs ?? playheadMs;
      setPlayheadMs(fromMs);
      if (beatUrl) {
        try {
          const a = new Audio(beatUrl);
          a.currentTime = Math.max(0, fromMs / 1000);
          monitorAudioRef.current = a;
          void a.play();
        } catch {
          /* ignore */
        }
      }
      setEditMsg(`Recording into track… (${mimeType.split(";")[0]})`);
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Mic permission failed");
      setIsConsoleRecording(false);
      stopLiveMeter();
    }
  }

  async function toggleConsoleRecord() {
    if (isConsoleRecording) await stopConsoleRecord();
    else await startConsoleRecord();
  }

  async function uploadBeatAndPlan(file: File) {
    if (!projectId) {
      setEditMsg("Missing project");
      return;
    }
    setPlanBusy(true);
    setEditMsg("Uploading beat…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch(`/api/projects/${projectId}/beat`, { method: "POST", body: fd });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) {
        setEditMsg(typeof uj.error === "string" ? uj.error : "Beat upload failed");
        return;
      }
      setEditMsg("Building producer plan (same as Booth)…");
      const ar = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      const aj = await ar.json().catch(() => ({}));
      if (!ar.ok) {
        setEditMsg(typeof aj.error === "string" ? aj.error : "Plan generation failed");
        return;
      }
      setEditMsg("Plan ready — record into tracks or open Booth");
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Beat / plan failed");
    } finally {
      setPlanBusy(false);
    }
  }

  /** Plan only — same /analyze → planProduction() as Booth; when beat exists but no tasks */
  async function generatePlanOnly() {
    if (!projectId) {
      setEditMsg("Missing project");
      return;
    }
    if (!beatUrl) {
      setEditMsg("Upload a beat first");
      return;
    }
    setPlanBusy(true);
    setEditMsg("Building producer plan (same as Booth)…");
    try {
      const ar = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST" });
      const aj = await ar.json().catch(() => ({}));
      if (!ar.ok) {
        setEditMsg(typeof aj.error === "string" ? aj.error : "Plan generation failed");
        return;
      }
      setEditMsg(aj.reused ? "Plan already ready" : "Plan ready — record into tracks");
      onLayersChanged?.();
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : "Plan generation failed");
    } finally {
      setPlanBusy(false);
    }
  }

  /** Passive meter: parallel graph on a clone of the mic stream — never touches monitor or MediaRecorder */
  function startLiveMeter(sourceStream: MediaStream) {
    stopLiveMeter();
    livePeaksBufRef.current = [];
    setLivePeaks([]);
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      // Clone tracks so analyser graph cannot affect capture/monitor
      const clone = new MediaStream(sourceStream.getAudioTracks().map((tr) => tr.clone()));
      const ctx = new AC();
      liveMeterCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(clone);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      // analyser is a sink only — nothing connects after it to speakers
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          const a = Math.abs(v);
          if (a > peak) peak = a;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLiveLevel(Math.min(1, rms * 3.2));
        // ~30 samples/sec into clip history (every other frame ~)
        frame += 1;
        if (frame % 2 === 0) {
          livePeaksBufRef.current.push(Math.min(1, peak * 1.4));
          if (livePeaksBufRef.current.length > 2400) {
            livePeaksBufRef.current = livePeaksBufRef.current.slice(-2400);
          }
          if (frame % 4 === 0) {
            setLivePeaks(livePeaksBufRef.current.slice());
          }
        }
        liveMeterRafRef.current = requestAnimationFrame(tick);
      };
      liveMeterRafRef.current = requestAnimationFrame(tick);
    } catch {
      /* visualization optional */
    }
  }

  function stopLiveMeter() {
    if (liveMeterRafRef.current != null) {
      cancelAnimationFrame(liveMeterRafRef.current);
      liveMeterRafRef.current = null;
    }
    if (liveMeterCtxRef.current) {
      try {
        void liveMeterCtxRef.current.close();
      } catch {
        /* ignore */
      }
      liveMeterCtxRef.current = null;
    }
    setLiveLevel(0);
    // keep livePeaks until save refreshes waveform; clear after stop handler
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
    // Soft parent refresh: keep audioUrls already resolved from session-preview
    setLayers((prev) => {
      const urlById = new Map(prev.map((l) => [l.id, l.audioUrl]));
      return layersProp.map((l) => ({
        ...l,
        audioUrl: l.audioUrl || urlById.get(l.id) || null,
      }));
    });
    setFxById((prev) => {
      const next = { ...prev };
      for (const l of layersProp) {
        if (l.trackFx) next[l.id] = { ...DEFAULT_TRACK_FX, ...l.trackFx };
        else if (!next[l.id]) next[l.id] = { ...DEFAULT_TRACK_FX };
      }
      return next;
    });
    setColorById((prev) => {
      const next = { ...prev };
      for (const l of layersProp) {
        if (l.color) next[l.id] = l.color;
      }
      return next;
    });
  }, [layersProp]);

  // session-preview returns { layers: [{ task_id, audio_url, ... }] } — same as Booth preview
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/session-preview`);
        if (!res.ok) return;
        const j = await res.json();
        const recs: { task_id?: string; audio_url?: string; id?: string }[] =
          j.layers || j.recordings || j.takes || [];
        if (!Array.isArray(recs) || cancelled) return;
        const byTask = new Map<string, string>();
        for (const r of recs) {
          const tid = r.task_id || r.id;
          if (tid && r.audio_url) byTask.set(tid, r.audio_url);
        }
        if (byTask.size === 0) return;
        setLayers((prev) =>
          prev.map((l) => {
            if (l.audioUrl) return l;
            const url = byTask.get(l.id);
            return url ? { ...l, audioUrl: url } : l;
          })
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-merge when parent soft-reloads tasks (layersProp loses audioUrl until preview attaches)
  }, [projectId, layersProp]);

  const totalMs = useMemo(() => {
    let max = durationMs || 0;
    for (const s of sections) {
      max = Math.max(max, Number(s.endMs) || 0, (Number(s.startMs) || 0) + 1000);
    }
    for (const l of layers) {
      const start = Number(l.startMs) || 0;
      const end = Number(l.endMs) || 0;
      max = Math.max(max, end, start + 500);
    }
    // Prefer real beat length when known; never cap the scroll region to the first section only
    return Math.max(max, 60_000);
  }, [durationMs, sections, layers]);

  // Explicit pixel width so iOS doesn't collapse absolute-positioned clip rows to viewport-only scroll
  const timelineW = Math.max(480, Math.ceil((totalMs / 1000) * pxPerSec) + 80);
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
        color: colorById[l.id] || l.color || roleColor(l.role),
        startMs: l.startMs,
        endMs: Math.max(l.endMs, l.startMs + 500),
        sub: l.sectionLabel,
        url: l.audioUrl,
      });
    }
    return list;
  }, [layers, totalMs, beatUrl, colorById]);

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
      const fx = fxById[tr.id] || DEFAULT_TRACK_FX;
      const lin = Math.pow(10, (fx.gainDb || 0) / 20);
      g.gain.setTargetAtTime(on ? lin : 0, audioCtxRef.current?.currentTime || 0, 0.02);
      const panNode = panNodesRef.current.get(tr.id);
      if (panNode) {
        const p = Math.max(-1, Math.min(1, Number(fx.pan) || 0));
        panNode.pan.setTargetAtTime(p, audioCtxRef.current?.currentTime || 0, 0.02);
      }
    }
  }

  useEffect(() => {
    applyGains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, soloId, tracks, fxById]);

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
    panNodesRef.current.clear();
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
      const fx = fxById[tr.id] || DEFAULT_TRACK_FX;
      const gainLin = Math.pow(10, (fx.gainDb || 0) / 20);
      gain.gain.value = on ? gainLin : 0;
      gainsRef.current.set(tr.id, gain);

      // Phase 4 FX chain: src → EQ → compress → sat (wave shape via gain) → delay/reverb mix → gain → dest
      const low = ctx.createBiquadFilter();
      low.type = "lowshelf";
      low.frequency.value = 200;
      low.gain.value = fx.eqLowDb || 0;
      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1200;
      mid.Q.value = 0.9;
      mid.gain.value = fx.eqMidDb || 0;
      const high = ctx.createBiquadFilter();
      high.type = "highshelf";
      high.frequency.value = 5000;
      high.gain.value = fx.eqHighDb || 0;

      const comp = ctx.createDynamicsCompressor();
      const cAmt = fx.compress || 0;
      comp.threshold.value = -10 - cAmt * 30;
      comp.knee.value = 12;
      comp.ratio.value = 1 + cAmt * 11;
      comp.attack.value = 0.01;
      comp.release.value = 0.2;

      const dry = ctx.createGain();
      dry.gain.value = 1;
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.28;
      const delayGain = ctx.createGain();
      delayGain.gain.value = (fx.delay || 0) * 0.45;
      const delayFb = ctx.createGain();
      delayFb.gain.value = 0.25;

      // Lightweight "reverb": multi-tap delays
      const revGain = ctx.createGain();
      revGain.gain.value = (fx.reverb || 0) * 0.35;
      const rev1 = ctx.createDelay(1.0);
      rev1.delayTime.value = 0.05;
      const rev2 = ctx.createDelay(1.0);
      rev2.delayTime.value = 0.12;
      const rev3 = ctx.createDelay(1.0);
      rev3.delayTime.value = 0.23;

      const satGain = ctx.createGain();
      // soft drive approximation via pre-gain into compressor
      satGain.gain.value = 1 + (fx.saturation || 0) * 1.5;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(low);
      low.connect(mid);
      mid.connect(high);
      high.connect(satGain);
      satGain.connect(comp);
      comp.connect(dry);
      dry.connect(gain);

      comp.connect(delay);
      delay.connect(delayGain);
      delay.connect(delayFb);
      delayFb.connect(delay);
      delayGain.connect(gain);

      comp.connect(rev1);
      rev1.connect(rev2);
      rev2.connect(rev3);
      rev1.connect(revGain);
      rev2.connect(revGain);
      rev3.connect(revGain);
      revGain.connect(gain);

      const panNode = ctx.createStereoPanner();
      const panVal = Math.max(-1, Math.min(1, Number(fx.pan) || 0));
      panNode.pan.value = panVal;
      panNodesRef.current.set(tr.id, panNode);
      gain.connect(panNode);
      panNode.connect(ctx.destination);

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

  function nudgePan(trackId: string, delta: number) {
    if (!trackId) return;
    setFxById((prev) => {
      const cur = prev[trackId] || { ...DEFAULT_TRACK_FX };
      const nextPan = Math.max(-1, Math.min(1, (Number(cur.pan) || 0) + delta));
      const next = { ...cur, pan: Math.round(nextPan * 20) / 20 };
      void persistFx(trackId, next);
      return { ...prev, [trackId]: next };
    });
  }

  function setPan(trackId: string, value: number, commit = false) {
    if (!trackId) return;
    const pan = Math.max(-1, Math.min(1, Math.round(value * 100) / 100));
    setFxById((prev) => {
      const cur = prev[trackId] || { ...DEFAULT_TRACK_FX };
      const next = { ...cur, pan };
      if (commit) void persistFx(trackId, next);
      return { ...prev, [trackId]: next };
    });
  }

  // Console keyboard shortcuts (ignore when typing in inputs)
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      const sel = selectedTrackId;

      if (key === " " || key === "Spacebar") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (key === "ArrowLeft") {
        e.preventDefault();
        seekTo(playheadMs - (e.shiftKey ? 5000 : 1000));
        return;
      }
      if (key === "ArrowRight") {
        e.preventDefault();
        seekTo(playheadMs + (e.shiftKey ? 5000 : 1000));
        return;
      }
      if (key === "Home") {
        e.preventDefault();
        seekTo(0);
        return;
      }
      if (key === "End") {
        e.preventDefault();
        seekTo(totalMs);
        return;
      }
      if (key === "Escape") {
        if (fxOpenId) setFxOpenId(null);
        else if (colorPickerId) setColorPickerId(null);
        else if (promptBarOpen) setPromptBarOpen(false);
        return;
      }
      if (!sel) return;
      if (key === "m" || key === "M") {
        e.preventDefault();
        setMuted((m) => ({ ...m, [sel]: !m[sel] }));
        return;
      }
      if (key === "s" || key === "S") {
        e.preventDefault();
        setSoloId((cur) => (cur === sel ? null : sel));
        return;
      }
      if (key === "l" || key === "L") {
        e.preventDefault();
        nudgePan(sel, -0.15);
        return;
      }
      if (key === "r" || key === "R") {
        if (e.shiftKey) {
          e.preventDefault();
          nudgePan(sel, 0.15);
          return;
        }
        const tr = tracks.find((t) => t.id === sel);
        if (tr?.kind === "vocal") {
          e.preventDefault();
          setArmedTrackId(sel);
          setSelectedTrackId(sel);
        }
        return;
      }
      if (key === "[") {
        e.preventDefault();
        nudgePan(sel, -0.15);
        return;
      }
      if (key === "]") {
        e.preventDefault();
        nudgePan(sel, 0.15);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrackId, playheadMs, totalMs, playing, fxOpenId, colorPickerId, promptBarOpen, tracks]);

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

  // Expanded rail must fit labels + M/S/FX without shrinking text (overflow, not scale)
  const sidebarW = sidebarCollapsed ? (isNarrow ? 56 : 64) : isNarrow ? 168 : 260;
  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        sessionStorage.setItem("console_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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
        background: bg,
        color: text,
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          paddingTop: "max(8px, env(safe-area-inset-top))",
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
          background: surface,
          minHeight: isNarrow ? 48 : 56,
          flexWrap: isNarrow ? "wrap" : "nowrap",
          rowGap: 6,
        }}
      >
        <a
          href={libraryHref || "/app"}
          style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: text, flexShrink: 0 }}
          title="Library"
        >
          <img
            src={STUDIO_LOGO_URL}
            alt="Studio"
            width={28}
            height={28}
            style={{ borderRadius: 8, objectFit: "cover", display: "block" }}
          />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.04em", color: brass }}>CONSOLE</span>
        </a>

        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          aria-label="Song title"
          style={{ flex: 1, minWidth: 0, maxWidth: isNarrow ? 120 : 280, background: "rgba(255,255,255,0.06)", border: `1px solid ${border}`, borderRadius: 8, color: text, fontWeight: 600, fontSize: isNarrow ? 13 : 14, padding: "6px 10px", fontFamily: "inherit" }}
        />

        <button
          type="button"
          title={isConsoleRecording ? "Stop recording" : "Record vocal into selected track (raw capture, same as Booth)"}
          onClick={() => void toggleConsoleRecord()}
          style={{
            ...iconBtn(border, surface, text),
            width: 40,
            height: 40,
            borderRadius: 999,
            color: "#F07167",
            boxShadow: isConsoleRecording ? "0 0 0 3px rgba(240,113,103,0.35)" : undefined,
            background: isConsoleRecording ? "rgba(240,113,103,0.2)" : undefined,
          }}
          aria-label={isConsoleRecording ? "Stop recording" : "Record vocal"}
        >
          <span
            style={{
              width: isConsoleRecording ? 10 : 12,
              height: isConsoleRecording ? 10 : 12,
              borderRadius: isConsoleRecording ? 2 : 999,
              background: "#F07167",
              display: "inline-block",
            }}
          />
        </button>
        {isConsoleRecording && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#F07167", fontVariantNumeric: "tabular-nums" }}>
              {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")}
            </span>
            {/* Live input level — passive analyser (not in monitor/capture path) */}
            <div
              title="Input level"
              style={{
                width: isNarrow ? 56 : 72,
                height: 8,
                borderRadius: 4,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: `${Math.round(liveLevel * 100)}%`,
                  height: "100%",
                  borderRadius: 4,
                  background:
                    liveLevel > 0.85
                      ? "#F07167"
                      : liveLevel > 0.35
                        ? brass
                        : "rgba(231,169,97,0.55)",
                  transition: "width 50ms linear",
                }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={togglePlay}
          style={{ width: 44, height: 44, borderRadius: 999, border: "none", background: `linear-gradient(180deg, #F0BC80, ${brass})`, color: "#1A1208", fontWeight: 800, fontSize: 16, cursor: "pointer", flexShrink: 0 }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: mutedText, minWidth: 88, fontWeight: 600 }}>
          {formatPlayhead(playheadMs)}
        </div>

        <div
          style={{ fontSize: 12, color: tempoBpm != null ? text : faint, fontWeight: 600, minWidth: 64, padding: "4px 8px", borderRadius: 6, border: `1px solid ${border}`, background: "rgba(255,255,255,0.04)" }}
          title={tempoBpm != null ? "Project tempo" : "BPM not detected for this project yet"}
        >
          {tempoBpm != null && Number.isFinite(tempoBpm) ? `${Math.round(tempoBpm)} BPM` : "— BPM"}
        </div>

        <button type="button" onClick={() => setPxPerSec((z) => Math.max(28, z - 12))} style={iconBtn(border, surface, text)} aria-label="Zoom out" title="Zoom out">
          <ZoomIcon zoomIn={false} />
        </button>
        <button type="button" onClick={() => setPxPerSec((z) => Math.min(140, z + 12))} style={iconBtn(border, surface, text)} aria-label="Zoom in" title="Zoom in">
          <ZoomIcon zoomIn={true} />
        </button>

        {!isNarrow && (
          <a href={libraryHref || "/app"} style={{ ...iconBtn(border, surface, text), textDecoration: "none", fontSize: 12, fontWeight: 700, padding: "0 12px", width: "auto", color: text }}>
            Library
          </a>
        )}
        {(boothHref || onClose) && !isNarrow && (
          <button
            type="button"
            onClick={() => {
              if (boothHref) window.location.href = boothHref;
              else onClose?.();
            }}
            style={{ ...iconBtn(border, surface, text), width: "auto", padding: "0 12px", fontSize: 12, fontWeight: 700 }}
          >
            Booth
          </button>
        )}
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


      
      {!beatUrl && projectId && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "42%",
            transform: "translate(-50%, -50%)",
            zIndex: 20,
            width: "min(360px, 92vw)",
            padding: 20,
            borderRadius: 16,
            background: surface,
            border: `1px solid ${border}`,
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Start in Console</div>
          <p style={{ color: mutedText, fontSize: 13, lineHeight: 1.45, marginBottom: 14 }}>
            Upload a beat to run the same AI plan Booth uses, then record vocals here or switch to Booth.
          </p>
          <label
            style={{
              display: "inline-block",
              padding: "12px 18px",
              borderRadius: 999,
              background: `linear-gradient(180deg, #F0BC80, ${brass})`,
              color: "#1A1208",
              fontWeight: 800,
              cursor: planBusy ? "wait" : "pointer",
              opacity: planBusy ? 0.7 : 1,
            }}
          >
            {planBusy ? "Working…" : "Upload beat"}
            <input
              type="file"
              accept="audio/*"
              hidden
              disabled={planBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadBeatAndPlan(f);
              }}
            />
          </label>
        </div>
      )}

      {beatUrl && projectId && layers.length === 0 && (
        <div
          style={{
            margin: "8px 12px",
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px solid ${border}`,
            background: surface,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: mutedText, fontSize: 13, flex: 1, minWidth: 160 }}>
            Beat loaded — generate a recording plan (same engine as Booth).
          </span>
          <button
            type="button"
            disabled={planBusy}
            onClick={() => void generatePlanOnly()}
            style={{
              padding: "10px 16px",
              borderRadius: 999,
              border: "none",
              background: `linear-gradient(180deg, #F0BC80, ${brass})`,
              color: "#1A1208",
              fontWeight: 800,
              cursor: planBusy ? "wait" : "pointer",
              fontFamily: "inherit",
              opacity: planBusy ? 0.7 : 1,
            }}
          >
            {planBusy ? "Working…" : "Generate plan"}
          </button>
        </div>
      )}


      {/* Shared beat picker for empty state + Add Track when no beat */}
      <input
        ref={beatFileInputRef}
        type="file"
        accept="audio/*"
        hidden
        disabled={planBusy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadBeatAndPlan(f);
        }}
      />

      {/* Suno-style dual scroller: pinned headers | timeline, synced vertical scroll */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
          background: bg,
          overflow: "hidden",
        }}
      >
        {/* LEFT: track headers — collapsible sidebar */}
        <div
          ref={headerScrollRef}
          onScroll={onHeaderScroll}
          style={{
            width: sidebarW,
            minWidth: sidebarW,
            maxWidth: sidebarW,
            flexShrink: 0,
            flexGrow: 0,
            transition: "width 0.15s ease",
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            borderRight: `1px solid ${border}`,
            background: bg,
            overscrollBehavior: "contain",
          }}
        >
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 5,
              height: TRACK_RULER_H,
              minHeight: TRACK_RULER_H,
              maxHeight: TRACK_RULER_H,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px",
              background: bg,
              borderBottom: `1px solid ${border}`,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              style={{
                background: "none",
                border: "none",
                color: faint,
                cursor: "pointer",
                padding: 0,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
              title={sidebarCollapsed ? "Expand tracks" : "Collapse tracks"}
            >
              {sidebarCollapsed ? "»" : "TRACKS"}
            </button>
            {!sidebarCollapsed && (
              <div style={{ display: "flex", gap: 4, marginLeft: "auto", minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: brass,
                    border: `1px solid ${brass}88`,
                    borderRadius: 6,
                    padding: "2px 6px",
                    whiteSpace: "nowrap",
                  }}
                >
                  CONSOLE
                </span>
                {(boothHref || onClose) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (boothHref) window.location.href = boothHref;
                      else onClose?.();
                    }}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: mutedText,
                      border: `1px solid ${border}`,
                      borderRadius: 6,
                      padding: "2px 6px",
                      background: "transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      whiteSpace: "nowrap",
                    }}
                  >
                    BOOTH
                  </button>
                )}
              </div>
            )}
          </div>
          {tracks.map((tr, trackIdx) => {
            const isMuted = muted[tr.id];
            const isSolo = soloId === tr.id;
            const rowH = expandedId === tr.id ? TRACK_ROW_H_EXPANDED : TRACK_ROW_H;
            return (
              <div
                key={`h-${tr.id}`}
                style={{
                  height: rowH,
                  minHeight: rowH,
                  maxHeight: rowH,
                  boxSizing: "border-box",
                  borderBottom: `1px solid rgba(255,255,255,0.06)`,
                  borderLeft: `3px solid ${tr.color}`,
                  padding: sidebarCollapsed ? "4px 4px" : "4px 8px",
                  background:
                    selectedTrackId === tr.id || armedTrackId === tr.id
                      ? "rgba(255,255,255,0.05)"
                      : "transparent",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: 2,
                  boxShadow:
                    armedTrackId === tr.id ? `inset 0 0 0 1px ${brass}` : undefined,
                }}
                onClick={
                  sidebarCollapsed
                    ? () => {
                        setSelectedTrackId(tr.id);
                        if (tr.kind === "vocal") setArmedTrackId(tr.id);
                        setSidebarCollapsed(false);
                      }
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(expandedId === tr.id ? null : tr.id);
                    setSelectedTrackId(tr.id);
                    if (tr.kind === "vocal") setArmedTrackId(tr.id);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: text,
                    fontWeight: 700,
                    fontSize: sidebarCollapsed ? 11 : 13,
                    lineHeight: 1.2,
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    width: "100%",
                    minWidth: 0,
                    fontFamily: "inherit",
                    display: sidebarCollapsed ? "none" : "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    overflow: "hidden",
                  }}
                >
                  <span
                    style={{
                      color: faint,
                      fontSize: 10,
                      fontVariantNumeric: "tabular-nums",
                      minWidth: 14,
                    }}
                  >
                    {trackIdx + 1}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                  >
                    {tr.label}
                  </span>
                </button>
                {!sidebarCollapsed && tr.sub ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: faint,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                    }}
                  >
                    {tr.sub}
                  </div>
                ) : null}
                {!sidebarCollapsed ? (
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: 6,
                    flexWrap: "wrap",
                    alignItems: "center",
                    maxWidth: "100%",
                  }}
                >
                  <button
                    type="button"
                    title={isMuted ? "Unmute" : "Mute"}
                    onClick={() => setMuted((m) => ({ ...m, [tr.id]: !m[tr.id] }))}
                    style={{ ...miniChip(border, brass, isMuted, text), fontSize: 11 }}
                  >
                    {isMuted ? "🔇" : "🔊"}
                  </button>
                  <button
                    type="button"
                    title="Solo"
                    onClick={() => setSoloId(soloId === tr.id ? null : tr.id)}
                    style={miniChip(border, brass, isSolo, text)}
                  >
                    S
                  </button>
                  <div
                    title="Pan — drag, double-click to center (L/[ · ]/Shift+R)"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      flex: "1 1 72px",
                      minWidth: 72,
                      maxWidth: 120,
                      padding: "0 2px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        color: (fxById[tr.id]?.pan ?? 0) < -0.05 ? brass : faint,
                        letterSpacing: "0.02em",
                        userSelect: "none",
                      }}
                    >
                      L
                    </span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={fxById[tr.id]?.pan ?? 0}
                      aria-label={`Pan ${tr.label}`}
                      onChange={(e) => {
                        setSelectedTrackId(tr.id);
                        setPan(tr.id, parseFloat(e.target.value), false);
                      }}
                      onPointerUp={(e) => {
                        setSelectedTrackId(tr.id);
                        setPan(tr.id, parseFloat((e.target as HTMLInputElement).value), true);
                      }}
                      onDoubleClick={() => {
                        setSelectedTrackId(tr.id);
                        setPan(tr.id, 0, true);
                      }}
                      style={{
                        flex: 1,
                        minWidth: 40,
                        height: 18,
                        margin: 0,
                        accentColor: brass,
                        cursor: "pointer",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        color: (fxById[tr.id]?.pan ?? 0) > 0.05 ? brass : faint,
                        letterSpacing: "0.02em",
                        userSelect: "none",
                      }}
                    >
                      R
                    </span>
                  </div>
                  <button
                    type="button"
                    title="Effects"
                    onClick={() => {
                      setSelectedTrackId(tr.id);
                      setFxOpenId(tr.id);
                    }}
                    style={miniChip(border, brass, fxOpenId === tr.id, text)}
                  >
                    FX
                  </button>
                  {tr.kind === "vocal" && (
                    <>
                      <button
                        type="button"
                        title="Color"
                        onClick={() =>
                          setColorPickerId(colorPickerId === tr.id ? null : tr.id)
                        }
                        style={{
                          width: 22,
                          height: 20,
                          borderRadius: 5,
                          border: `1px solid ${border}`,
                          background: tr.color,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                      <button
                        type="button"
                        title="Remove"
                        onClick={() => void deleteLayer(tr.id)}
                        style={miniChip(border, "#E8756A", false, text)}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
                ) : (
                  <div
                    style={{
                      marginTop: 4,
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: tr.color,
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                    title={tr.label}
                  />
                )}
                {colorPickerId === tr.id && tr.kind === "vocal" && !sidebarCollapsed && (
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {TRACK_COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => void persistColor(tr.id, c)}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: tr.color === c ? `2px solid ${text}` : `1px solid ${border}`,
                          background: c,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* RIGHT: timeline — horizontal + vertical scroll (vertical synced with headers) */}
        <div
          ref={timelineScrollRef}
          onScroll={onTimelineScroll}
          style={{
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            position: "relative",
            touchAction: "pan-x pan-y",
          }}
        >
          <div
            style={{
              width: timelineW,
              minWidth: timelineW,
              position: "relative",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 6,
                height: TRACK_RULER_H,
                width: timelineW,
                minWidth: timelineW,
                borderBottom: `1px solid ${border}`,
                background: surface,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left + (timelineScrollRef.current?.scrollLeft || 0);
                seekTo((x / pxPerSec) * 1000);
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

            {tracks.map((tr) => {
              const expanded = expandedId === tr.id;
              const dimmed = !isAudible(tr.id, tr.kind);
              const isMock = tr.kind === "vocal" && !tr.url && !peaksById[tr.id];
              const isArmed = armedTrackId === tr.id && tr.kind === "vocal";
              const isLiveRec =
                isConsoleRecording &&
                consoleRecRef.current?.taskId === tr.id &&
                tr.kind === "vocal";
              // Take length wins while recording: clip grows with elapsed time
              const liveEndMs = isLiveRec
                ? tr.startMs + Math.max(400, recordSeconds * 1000)
                : tr.endMs;
              const displayEndMs = isLiveRec ? Math.max(tr.endMs, liveEndMs) : tr.endMs;
              const clipW = Math.max(10, msToX(displayEndMs) - msToX(tr.startMs));
              const rowH = expanded ? TRACK_ROW_H_EXPANDED : TRACK_ROW_H;
              const clipH = expanded ? Math.min(72, rowH - 16) : Math.min(40, rowH - 16);
              return (
                <div
                  key={`tl-${tr.id}`}
                  style={{
                    position: "relative",
                    height: rowH,
                    minHeight: rowH,
                    maxHeight: rowH,
                    width: timelineW,
                    minWidth: timelineW,
                    boxSizing: "border-box",
                    borderBottom: `1px solid rgba(255,255,255,0.06)`,
                    background:
                      selectedTrackId === tr.id || isArmed
                        ? "rgba(255,255,255,0.04)"
                        : "transparent",
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x =
                      e.clientX - rect.left + (timelineScrollRef.current?.scrollLeft || 0);
                    seekTo((x / pxPerSec) * 1000);
                    setSelectedTrackId(tr.id);
                    if (tr.kind === "vocal") setArmedTrackId(tr.id);
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
                      top: expanded ? 12 : 8,
                      height: clipH,
                      borderRadius: 6,
                      background: isLiveRec
                        ? `linear-gradient(180deg, ${tr.color}cc, ${tr.color})`
                        : tr.color,
                      boxShadow: isLiveRec
                        ? `0 0 0 2px #F07167, 0 0 16px ${tr.color}aa`
                        : isArmed
                          ? `0 0 0 2px ${brass}, 0 0 14px ${brass}99`
                          : selectedTrackId === tr.id
                            ? `0 0 0 2px #fff, 0 0 12px ${tr.color}88`
                            : `0 1px 0 rgba(0,0,0,0.35)`,
                      overflow: "hidden",
                      cursor: tr.kind === "vocal" ? (isMock ? "pointer" : "grab") : "default",
                      touchAction: "none",
                      opacity: dimmed ? 0.4 : 1,
                      outline: isArmed && !isLiveRec ? `1px dashed ${brass}` : undefined,
                    }}
                    onPointerDown={
                      tr.kind === "vocal"
                        ? (e) => {
                            setSelectedTrackId(tr.id);
                            setArmedTrackId(tr.id);
                            // Mock/unrecorded: arm only (no drag). Recorded: move/trim as before.
                            if (!isMock && !isLiveRec) {
                              onClipPointerDown(e, tr.id, "move", tr.startMs, tr.endMs);
                            }
                          }
                        : () => setSelectedTrackId(tr.id)
                    }
                  >
                    {isLiveRec ? (
                      <LiveClipWave
                        peaks={livePeaks}
                        color={tr.color}
                        width={clipW}
                        height={clipH}
                      />
                    ) : (
                      <WaveformCanvas
                        peaks={peaksById[tr.id] || null}
                        color={tr.color}
                        width={clipW}
                        height={clipH}
                        dimmed={dimmed}
                      />
                    )}
                    <div
                      style={{
                        position: "absolute",
                        left: 6,
                        top: 4,
                        right: 6,
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#0B0A0F",
                        textShadow: "0 0 4px rgba(255,255,255,0.35)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                      }}
                    >
                      {tr.label}
                      {tr.sub ? ` — ${tr.sub}` : ""}
                    </div>
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
              );
            })}
          </div>
        </div>
      </div>

      {layers.length === 0 && (
        <div
          style={{
            position: "absolute",
            left: 140,
            top: 120,
            margin: 16,
            padding: 16,
            borderRadius: 14,
            border: `1px dashed ${border}`,
            color: mutedText,
            fontSize: 14,
            lineHeight: 1.5,
            maxWidth: 420,
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <strong style={{ color: text }}>No vocal layers yet</strong>
          <p style={{ margin: "8px 0 0" }}>
            Upload a beat to generate a plan, then Record Vocal here — same capture path as Booth. Or open Booth for guided flow.
          </p>
        </div>
      )}


      {/* Prompt: collapsed FAB by default — does not cover track rows */}
      {!promptBarOpen ? (
        <button
          type="button"
          onClick={() => setPromptBarOpen(true)}
          title="Open AP prompt"
          style={{
            position: "absolute",
            right: 14,
            bottom: "max(14px, env(safe-area-inset-bottom))",
            zIndex: 40,
            width: 48,
            height: 48,
            borderRadius: 999,
            border: `1px solid ${border}`,
            background: `linear-gradient(180deg, #F0BC80, ${brass})`,
            color: "#1A1208",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            fontFamily: "inherit",
          }}
        >
          AP
        </button>
      ) : (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            top: 0,
            zIndex: 40,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setPromptBarOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 12px max(12px, env(safe-area-inset-bottom))",
              pointerEvents: "auto",
              borderRadius: 16,
              padding: "10px 12px",
              background: "rgba(22, 22, 26, 0.96)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
              backdropFilter: "blur(16px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setPromptBarOpen(false);
                  setAddMenuOpen(true);
                }}
                title="Add track"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#E8E6EF",
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: "pointer",
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                +
              </button>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>
                {selectedTrackId ? "Track · AP" : "Song · AP"}
              </span>
              <button
                type="button"
                onClick={() => setPromptBarOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 18,
                  cursor: "pointer",
                  padding: 4,
                }}
                aria-label="Close prompt"
              >
                ×
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={trackPrompt}
                onChange={(e) => setTrackPrompt(e.target.value)}
                placeholder={
                  selectedTrackId && selectedTrackId !== "beat"
                    ? "Ask AP about this track… (e.g. add warmth)"
                    : tweaksEnabled
                      ? "Ask AP about the whole song…"
                      : tweaksGateMessage
                }
                disabled={
                  selectedTrackId && selectedTrackId !== "beat"
                    ? false
                    : !tweaksEnabled
                }
                onKeyDown={(e) => {
                  const trackOk = selectedTrackId && selectedTrackId !== "beat";
                  if (e.key === "Enter" && trackPrompt.trim() && (trackOk || tweaksEnabled)) {
                    e.preventDefault();
                    void submitTrackPrompt().then(() => setPromptBarOpen(false));
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "#F4F1EC",
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  void submitTrackPrompt().then(() => setPromptBarOpen(false));
                }}
                disabled={
                  !trackPrompt.trim() ||
                  (!(selectedTrackId && selectedTrackId !== "beat") && !tweaksEnabled)
                }
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "none",
                  background:
                    trackPrompt.trim() &&
                    ((selectedTrackId && selectedTrackId !== "beat") || tweaksEnabled)
                      ? "linear-gradient(180deg, #F0BC80, #E7A961)"
                      : "rgba(255,255,255,0.1)",
                  color:
                    trackPrompt.trim() &&
                    ((selectedTrackId && selectedTrackId !== "beat") || tweaksEnabled)
                      ? "#1A1208"
                      : "rgba(255,255,255,0.35)",
                  fontWeight: 800,
                  cursor:
                    trackPrompt.trim() &&
                    ((selectedTrackId && selectedTrackId !== "beat") || tweaksEnabled)
                      ? "pointer"
                      : "default",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}

      {addMenuOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10040,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setAddMenuOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: "16px 16px 0 0",
              background: surface,
              border: `1px solid ${border}`,
              padding: "16px 16px max(20px, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Add track</div>
            {!beatUrl ? (
              <button
                type="button"
                disabled={planBusy}
                onClick={() => {
                  setAddMenuOpen(false);
                  beatFileInputRef.current?.click();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: text,
                  marginBottom: 8,
                  cursor: planBusy ? "wait" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                Upload beat — runs AI plan (same as Booth)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddMenuOpen(false);
                  setShowAddTrack(true);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: text,
                  marginBottom: 8,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                Upload vocal / audio file — new track
              </button>
            )}
            {beatUrl && layers.filter((l) => l.id !== "beat").length === 0 && (
              <button
                type="button"
                disabled={planBusy}
                onClick={() => {
                  setAddMenuOpen(false);
                  void generatePlanOnly();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: text,
                  marginBottom: 8,
                  cursor: planBusy ? "wait" : "pointer",
                  fontFamily: "inherit",
                  fontWeight: 600,
                }}
              >
                Generate plan — structure tracks from this beat
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAddMenuOpen(false);
                void startConsoleRecord();
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "14px 12px",
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: "rgba(255,255,255,0.04)",
                color: text,
                marginBottom: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 600,
              }}
            >
              Record Vocal — live capture into a new/selected track
            </button>
            <button
              type="button"
              onClick={() => setAddMenuOpen(false)}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                border: "none",
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

      {showAddTrack && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10040,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setShowAddTrack(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 12px max(12px, env(safe-area-inset-bottom))",
              pointerEvents: "auto",
              borderRadius: 14,
              padding: 12,
              background: "rgba(22, 22, 26, 0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="Name (optional)"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "#F4F1EC",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            />
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "#F4F1EC",
                fontFamily: "inherit",
                fontSize: 13,
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
              style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}
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
                  padding: "10px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(180deg, #F0BC80, #E7A961)",
                  color: "#1A1208",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              >
                {addBusy ? "Adding…" : "Add"}
              </button>
              <button
                type="button"
                disabled={addBusy}
                onClick={() => setShowAddTrack(false)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.55)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FX modal — Suno-style plugin sheet */}
      {fxOpenId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10050,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setFxOpenId(null)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "72dvh",
              overflowY: "auto",
              borderRadius: "18px 18px 0 0",
              background: surface,
              border: `1px solid ${border}`,
              borderBottom: "none",
              padding: "16px 16px max(16px, env(safe-area-inset-bottom))",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: brass,
                  }}
                >
                  TRACK FX
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, color: text }}>
                  {tracks.find((x) => x.id === fxOpenId)?.label || "Track"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFxOpenId(null)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${border}`,
                  background: bg,
                  color: text,
                  cursor: "pointer",
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </div>
            <TrackFxPanel
              fx={fxById[fxOpenId] || DEFAULT_TRACK_FX}
              color={text}
              muted={mutedText}
              border={border}
              brass={brass}
              surface={bg}
              onChange={(fx) => setFxById((prev) => ({ ...prev, [fxOpenId]: fx }))}
              onCommit={(fx) => void persistFx(fxOpenId, fx)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TrackFxPanel({
  fx,
  color,
  muted,
  border,
  brass,
  surface,
  onChange,
  onCommit,
}: {
  fx: TrackFx;
  color: string;
  muted: string;
  border: string;
  brass: string;
  surface: string;
  onChange: (fx: TrackFx) => void;
  onCommit: (fx: TrackFx) => void;
}) {
  function slider(
    key: keyof TrackFx,
    label: string,
    min: number,
    max: number,
    step: number
  ) {
    return (
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 11,
          color: muted,
        }}
      >
        <span style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{label}</span>
          <span style={{ color }}>{Number(fx[key]).toFixed(1)}</span>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={fx[key]}
          onChange={(e) => {
            const next = { ...fx, [key]: parseFloat(e.target.value) };
            onChange(next);
          }}
          onPointerUp={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            onCommit({ ...fx, [key]: v });
          }}
          onTouchEnd={(e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            onCommit({ ...fx, [key]: v });
          }}
          style={{ width: "100%", accentColor: brass }}
        />
      </label>
    );
  }
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        borderRadius: 12,
        border: `1px solid ${border}`,
        background: surface,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: undefined as unknown as number,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.06em", color: brass }}>
        TRACK FX
      </div>
      {slider("gainDb", "Gain dB", -12, 12, 0.5)}
      {slider("pan", "Pan L/R", -1, 1, 0.05)}
      {slider("eqLowDb", "Low", -12, 12, 0.5)}
      {slider("eqMidDb", "Mid", -12, 12, 0.5)}
      {slider("eqHighDb", "High / air", -12, 12, 0.5)}
      {slider("compress", "Compress", 0, 1, 0.05)}
      {slider("reverb", "Reverb", 0, 1, 0.05)}
      {slider("delay", "Delay", 0, 1, 0.05)}
      {slider("saturation", "Saturation", 0, 1, 0.05)}
      <button
        type="button"
        onClick={() => {
          onChange(DEFAULT_TRACK_FX);
          onCommit(DEFAULT_TRACK_FX);
        }}
        style={{
          marginTop: 4,
          padding: "8px",
          borderRadius: 8,
          border: `1px solid ${border}`,
          background: "transparent",
          color: muted,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Reset FX
      </button>
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  reason?: string | null;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
  metadata?: { section_label?: string; vocal_part?: string; production_type?: string };
};

type Take = {
  id: string;
  take_number: number;
  audio_url?: string | null;
  duration_ms?: number | null;
  is_selected?: boolean;
};

type ProjectMeta = {
  id: string;
  status: string;
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  tempo?: number | null;
};

type Screen = "beat" | "analyzing" | "plan" | "session" | "done";
type SessionPhase = "ready" | "recording" | "review";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  signal: "#7BEBD4",
  waveMuted: "rgba(255,255,255,0.14)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
  danger: "#E8756A",
  purple: "#8b5cf6",
};

const GRAD = [
  ["#3A2E52", "#0B0A0F"],
  ["#2E4A4A", "#0B0A0F"],
  ["#4A2E3A", "#0B0A0F"],
];

function seededRandom(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xfffffff) / 0xfffffff;
  };
}

function makeWave(seed: string, n = 48) {
  const rnd = seededRandom(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = 0.35 + 0.3 * Math.sin(i / 3.1 + seed.length) + rnd() * 0.35;
    out.push(Math.max(0.12, Math.min(1, base)));
  }
  return out;
}

function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function coverFor(seed: string) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i) * (i + 1)) % GRAD.length;
  return GRAD[n];
}

function humanTitle(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("double")) return "Sing it again (thicker)";
  if (t.includes("harmony")) return "Harmony line";
  if (t.includes("adlib")) return "Ad-libs / answers";
  if (t.includes("hum")) return "Soft hum / atmosphere";
  return "Lead vocal";
}

function sectionLabel(t: Task) {
  return (t.metadata?.section_label || t.title || humanTitle(t.type) || "SECTION").toUpperCase();
}

function roleLabel(t: Task) {
  return t.reason || t.metadata?.vocal_part || humanTitle(t.type);
}

function Waveform({
  bars,
  progress = 0,
  height = 48,
  color = C.signal,
  muted = C.waveMuted,
  gap = 3,
  live = false,
  onSeek,
}: {
  bars: number[];
  progress?: number;
  height?: number;
  color?: string;
  muted?: string;
  gap?: number;
  live?: boolean;
  onSeek?: (ratio: number) => void;
}) {
  return (
    <div
      onClick={(e) => {
        if (!onSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        height,
        width: "100%",
        cursor: onSeek ? "pointer" : "default",
      }}
    >
      {bars.map((h, i) => {
        const played = i / bars.length < progress;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 2,
              borderRadius: 4,
              height: `${Math.max(8, h * height)}px`,
              background: played ? color : muted,
              boxShadow: played ? `0 0 8px ${color}55` : "none",
              transition: live ? "height 120ms ease" : "background 180ms ease",
            }}
          />
        );
      })}
    </div>
  );
}

function StudioPlayer({
  src,
  seed = "studio",
  accent = C.signal,
  bigPlay = false,
}: {
  src: string;
  seed?: string;
  accent?: string;
  bigPlay?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => makeWave(seed + (src || ""), bigPlay ? 48 : 36), [seed, src, bigPlay]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime || 0);
    const onMeta = () => setDuration(el.duration || 0);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src]);

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
      } catch {
        /* ignore */
      }
    } else {
      el.pause();
    }
  }

  function seek(ratio: number) {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = ratio * duration;
    setTime(el.currentTime);
  }

  const progress = duration > 0 ? time / duration : 0;
  const h = bigPlay ? 56 : 44;

  return (
    <div style={{ width: "100%" }}>
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: "none" }} />
      <Waveform bars={bars} progress={progress} height={h} color={accent} onSeek={seek} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: bigPlay ? 60 : 48,
            height: bigPlay ? 60 : 48,
            borderRadius: 999,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            color: "#1A1208",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
            boxShadow: "0 6px 18px -6px rgba(231,169,97,0.5)",
          }}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          )}
        </button>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            color: C.textFaint,
          }}
        >
          <span>{fmtClock(time)}</span>
          <span>{fmtClock(duration)}</span>
        </div>
      </div>
    </div>
  );
}

function SessionTimeline({ tasks, currentId }: { tasks: Task[]; currentId: string | null }) {
  const sections: { key: string; label: string; done: boolean; active: boolean }[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    const label = sectionLabel(t);
    if (seen.has(label)) {
      const existing = sections.find((s) => s.key === label);
      if (existing && t.status === "completed") existing.done = true;
      if (t.id === currentId && existing) existing.active = true;
      continue;
    }
    seen.add(label);
    sections.push({
      key: label,
      label,
      done: t.status === "completed",
      active:
        t.id === currentId ||
        (currentId
          ? sectionLabel(tasks.find((x) => x.id === currentId)!) === label
          : false),
    });
  }

  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 8 }}>
      {sections.map((s) => (
        <div
          key={s.key}
          style={{
            flexShrink: 0,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.6,
            border: s.active ? `1px solid ${C.brassLine}` : `1px solid ${C.border}`,
            background: s.active ? C.brassSoft : s.done ? "rgba(123,235,212,0.08)" : "transparent",
            color: s.active ? C.brass : s.done ? C.signal : C.textMuted,
            opacity: s.done && !s.active ? 0.55 : 1,
          }}
        >
          {s.active ? "● " : s.done ? "✓ " : "○ "}
          {s.label}
        </div>
      ))}
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [screen, setScreen] = useState<Screen>("beat");
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("ready");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState(false);
  const [producing, setProducing] = useState(false);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("studio-song-master.wav");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [lastTake, setLastTake] = useState<Take | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [liveBars, setLiveBars] = useState(() => new Array(40).fill(0.15));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const previewAudiosRef = useRef<HTMLAudioElement[]>([]);
  const previewTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beatAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const liveRndRef = useRef(seededRandom("live-wave"));

  const pending = useMemo(
    () => tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
    [tasks]
  );
  const current = pending[0] || null;
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const progressLabel = `${Math.min(completedCount + 1, Math.max(tasks.length, 1))} of ${Math.max(tasks.length, 1)}`;
  const g = coverFor(id + (project?.title || ""));
  const sectionBars = useMemo(
    () => makeWave((current?.id || "section") + (current?.type || ""), 48),
    [current?.id, current?.type]
  );

  const load = useCallback(async () => {
    try {
      const [statusRes, beatRes, tasksRes] = await Promise.all([
        fetch(`/api/projects/${id}/status`),
        fetch(`/api/projects/${id}/beat`),
        fetch(`/api/projects/${id}/recording-tasks`),
      ]);

      let proj: ProjectMeta | null = null;
      if (statusRes.ok) {
        const j = await statusRes.json();
        proj = j.project;
        setProject(proj);
      }
      if (beatRes.ok) setBeatUrl((await beatRes.json()).audio_url || null);

      let list: Task[] = [];
      if (tasksRes.ok) {
        list = (await tasksRes.json()).tasks || [];
        setTasks(list);
      }

      const dlRes = await fetch(`/api/projects/${id}/download?kind=master`);
      if (dlRes.ok) {
        const j = await dlRes.json();
        if (j.download_url) {
          setMasterUrl(j.download_url);
          if (j.filename) setDownloadName(j.filename);
        }
      }

      const st = proj?.status || "";
      if (st === "complete" || masterUrl) {
        setScreen("done");
      } else if (list.length && list.every((t) => t.status === "completed")) {
        setScreen("done");
      } else if (list.length && list.some((t) => t.status === "completed" || t.status === "in_progress")) {
        setScreen("session");
        setSessionPhase("ready");
      } else if (list.length > 0 || st === "blueprint_ready") {
        setScreen("plan");
      } else if (st === "analyzing") {
        setScreen("analyzing");
      } else {
        setScreen("beat");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [id, masterUrl]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while beat is still generating / not ready
  useEffect(() => {
    const st = project?.status || "";
    if (st === "complete" || st === "failed") return;
    if (beatUrl && st !== "generating_beat") return;
    if (!beatUrl || st === "generating_beat") {
      const t = setInterval(() => {
        load();
      }, 2000);
      return () => clearInterval(t);
    }
  }, [project?.status, beatUrl, load]);

  function stopSessionPreview() {
    previewTimersRef.current.forEach(clearTimeout);
    previewTimersRef.current = [];
    previewAudiosRef.current.forEach((a) => {
      try {
        a.pause();
        a.src = "";
      } catch {
        /* ignore */
      }
    });
    previewAudiosRef.current = [];
    setPreviewPlaying(false);
  }

  useEffect(() => {
    return () => {
      stopSessionPreview();
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startProducerSession() {
    setError(null);
    setAnalyzing(true);
    setScreen("analyzing");
    try {
      const res = await fetch(`/api/projects/${id}/analyze`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || j.message || "Could not build producer plan");
      const tasksRes = await fetch(`/api/projects/${id}/recording-tasks`);
      if (tasksRes.ok) {
        const list = (await tasksRes.json()).tasks || [];
        setTasks(list);
      }
      const st = await fetch(`/api/projects/${id}/status`);
      if (st.ok) {
        const s = await st.json();
        setProject(s.project);
      }
      setScreen("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyze failed");
      setScreen("beat");
    } finally {
      setAnalyzing(false);
    }
  }

  function startRecordingSession() {
    setEditingPlan(false);
    setScreen("session");
    setSessionPhase("ready");
  }

  function removeTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  function updateTaskInstruction(taskId: string, instruction: string) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, instruction } : t)));
  }

  function pickMimeType() {
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "audio/webm";
  }

  async function playSection() {
    if (!beatUrl || !beatAudioRef.current || !current) return;
    const el = beatAudioRef.current;
    const start = (current.start_ms ?? 0) / 1000;
    const end = (current.end_ms ?? 0) / 1000;
    el.currentTime = start;
    await el.play().catch(() => undefined);
    if (end > start) {
      const onTime = () => {
        if (el.currentTime >= end) {
          el.pause();
          el.removeEventListener("timeupdate", onTime);
        }
      };
      el.addEventListener("timeupdate", onTime);
    }
  }

  async function playSessionSoFar() {
    if (previewPlaying) {
      stopSessionPreview();
      return;
    }
    setError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/session-preview`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load session preview");

      const beatSrc: string | null = data.beat_url || beatUrl;
      if (!beatSrc) throw new Error("No beat available yet");

      stopSessionPreview();

      const beat = new Audio(beatSrc);
      beat.volume = 0.5;
      beat.preload = "auto";
      previewAudiosRef.current.push(beat);

      const layers: Array<{ audio_url: string; start_ms: number }> = [...(data.layers || [])];
      if (localBlobUrl && current) {
        layers.push({ audio_url: localBlobUrl, start_ms: current.start_ms ?? 0 });
      }

      for (const layer of layers) {
        if (!layer.audio_url) continue;
        const v = new Audio(layer.audio_url);
        v.volume = 0.95;
        v.preload = "auto";
        previewAudiosRef.current.push(v);
      }

      await Promise.all(
        previewAudiosRef.current.map(
          (a) =>
            new Promise<void>((resolve) => {
              if (a.readyState >= 2) return resolve();
              a.addEventListener("canplaythrough", () => resolve(), { once: true });
              a.addEventListener("error", () => resolve(), { once: true });
              a.load();
            })
        )
      );

      beat.currentTime = 0;
      await beat.play();
      setPreviewPlaying(true);

      layers.forEach((layer, idx) => {
        const vocal = previewAudiosRef.current[idx + 1];
        if (!vocal) return;
        const delay = Math.max(0, layer.start_ms || 0);
        const t = setTimeout(() => {
          vocal.currentTime = 0;
          vocal.play().catch(() => undefined);
        }, delay);
        previewTimersRef.current.push(t);
      });

      beat.onended = () => stopSessionPreview();
    } catch (e) {
      stopSessionPreview();
      setError(e instanceof Error ? e.message : "Could not play session preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function startRecording() {
    setError(null);
    stopSessionPreview();
    if (!current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
        const url = URL.createObjectURL(blob);
        setLocalBlobUrl(url);
        setSessionPhase("review");
        await uploadTake(blob, Date.now() - startedAtRef.current);
      };
      startedAtRef.current = Date.now();
      setRecordSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
        setLiveBars((prev) => prev.map(() => 0.12 + liveRndRef.current() * 0.88));
      }, 120);
      if (beatAudioRef.current && beatUrl) {
        const el = beatAudioRef.current;
        el.currentTime = (current.start_ms ?? 0) / 1000;
        el.volume = 0.55;
        el.play().catch(() => undefined);
      }
      recorder.start(250);
      setSessionPhase("recording");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not access microphone.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    beatAudioRef.current?.pause();
  }

  async function uploadTake(blob: Blob, durationMs: number) {
    if (!current) return;
    setUploading(true);
    try {
      const form = new FormData();
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      form.append("file", blob, `take.${ext}`);
      form.append("duration_ms", String(Math.max(0, Math.round(durationMs))));
      const res = await fetch(`/api/recording-tasks/${current.id}/recordings`, {
        method: "POST",
        body: form,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setLastTake(j.recording);
      if (j.recording?.id) {
        await fetch(`/api/recording-tasks/${current.id}/recordings/${j.recording.id}/select`, {
          method: "POST",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save take");
    } finally {
      setUploading(false);
    }
  }

  function keepAndContinue() {
    if (!current) return;
    stopSessionPreview();
    setTasks((prev) => prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t)));
    setLocalBlobUrl(null);
    setLastTake(null);
    const remaining = pending.filter((t) => t.id !== current.id);
    if (remaining.length === 0) {
      setScreen("done");
      return;
    }
    setSessionPhase("ready");
  }

  async function startProduce() {
    setProducing(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Produce failed");
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const st = await fetch(`/api/projects/${id}/produce`);
        if (st.ok) {
          const s = await st.json();
          if (s.project_status === "complete" || s.job?.status === "complete") {
            setProject((p) => (p ? { ...p, status: "complete" } : p));
            const dl = await fetch(`/api/projects/${id}/download?kind=master`);
            if (dl.ok) {
              const d = await dl.json();
              if (d.download_url) {
                setMasterUrl(d.download_url);
                if (d.filename) setDownloadName(d.filename);
              }
            }
            break;
          }
          if (s.job?.status === "failed") throw new Error(s.job.error || "Production failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not produce song");
    } finally {
      setProducing(false);
    }
  }

  async function downloadSong() {
    const res = await fetch(`/api/projects/${id}/download?kind=master`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.download_url) {
      setError(j.error || "Download not available yet");
      return;
    }
    const a = document.createElement("a");
    a.href = j.download_url;
    a.download = j.filename || "studio-song-master.wav";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (loading) {
    return (
      <div style={S.page}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Inter:wght@400;500;600&display=swap');
        `}</style>
        <div style={{ ...S.wrap, textAlign: "center", paddingTop: 100 }}>
          <Waveform bars={makeWave("loading", 40)} progress={1} height={56} color={C.signal} live />
          <h1 style={{ ...S.title, marginTop: 28, fontSize: "clamp(1.4rem, 4vw, 1.75rem)" }}>
            Preparing your session
          </h1>
          <p style={{ color: C.textMuted, fontSize: 15, lineHeight: 1.5, maxWidth: 340, margin: "12px auto 0" }}>
            Loading your beat and producer workspace…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
      `}</style>
      {beatUrl && <audio ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />}

      {screen === "beat" && (
        <div style={S.wrap}>
          <div style={S.topBar}>
            <Link href="/app" style={S.back}>
              ← Projects
            </Link>
          </div>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <div
              style={{
                width: 160,
                height: 160,
                borderRadius: 22,
                margin: "0 auto",
                background: `linear-gradient(145deg, ${g[0]}, ${g[1]})`,
                border: `1px solid ${C.border}`,
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 18.5a2.75 2.75 0 1 1-2.1-2.68V7.4c0-.7.46-1.32 1.14-1.52L18 3.2v11.9"
                  stroke="rgba(244,241,236,0.88)"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <circle cx="16.25" cy="16.75" r="2.75" stroke="rgba(244,241,236,0.88)" strokeWidth="1.7" />
              </svg>
            </div>
            <h1 style={S.title}>{project?.title || "Your beat"}</h1>
            <div style={S.metaLine}>
              {[project?.genre, project?.tempo ? `${project.tempo} BPM` : null, project?.mood]
                .filter(Boolean)
                .join(" · ") || "Ready to produce"}
            </div>
          </div>

          {beatUrl ? (
            <div style={{ marginTop: 28 }}>
              <StudioPlayer src={beatUrl} seed={`beat-${id}`} accent={C.brass} bigPlay />
            </div>
          ) : (
            <div style={{ marginTop: 32, textAlign: "center" }}>
              <Waveform bars={makeWave(`composing-${id}`, 40)} progress={1} height={56} color={C.brass} live />
              <p style={{ color: C.textMuted, fontSize: 15, marginTop: 18, lineHeight: 1.5 }}>
                {project?.status === "generating_beat" ? "Composing your beat…" : "Preparing beat audio…"}
              </p>
              <p style={{ color: C.textFaint, fontSize: 13, marginTop: 8 }}>This usually takes a few seconds</p>
            </div>
          )}

          <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 22 }}>
            {beatUrl
              ? "Your beat is ready. Let's turn it into a song."
              : "Hang tight — your producer session opens once the beat is ready."}
          </p>
          {error && <div style={S.error}>{error}</div>}
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              type="button"
              style={S.primary}
              disabled={analyzing || !beatUrl}
              onClick={startProducerSession}
            >
              {analyzing ? "Starting…" : beatUrl ? "Start AI Producer Session" : "Waiting for beat…"}
            </button>
          </div>
        </div>
      )}

      {screen === "analyzing" && (
        <div style={{ ...S.wrap, textAlign: "center", paddingTop: 80 }}>
          <Waveform bars={makeWave("analyzing", 40)} progress={1} height={56} color={C.signal} live />
          <h1 style={{ ...S.title, marginTop: 28 }}>Building your song plan</h1>
          <p style={{ color: C.textMuted, fontSize: 15, lineHeight: 1.5, maxWidth: 360, margin: "12px auto 0" }}>
            Your AI producer is reading the beat and deciding what to record — sections, layers, and when to
            sing.
          </p>
          <p style={{ color: C.textFaint, fontSize: 13, marginTop: 20 }}>This usually takes a few seconds…</p>
          {error && <div style={S.error}>{error}</div>}
        </div>
      )}

      {screen === "plan" && (
        <div style={S.wrap}>
          <div style={S.topBar}>
            <button type="button" style={S.backBtn} onClick={() => setScreen("beat")}>
              ← Beat
            </button>
            <span style={S.badge}>Plan ready</span>
          </div>
          <div style={S.eyebrow}>◆ SONG PLAN</div>
          <h1 style={S.title}>Here's how we'll make your song</h1>
          <p style={{ color: C.textMuted, fontSize: 14, marginTop: 8, marginBottom: 18 }}>
            Review the plan. Edit instructions or remove optional parts, then start recording.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map((t, i) => (
              <div key={t.id} style={S.planCard}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: C.textFaint }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1, color: C.brass, fontWeight: 600 }}>
                      {sectionLabel(t)}
                    </div>
                    {editingPlan ? (
                      <textarea
                        value={t.instruction}
                        onChange={(e) => updateTaskInstruction(t.id, e.target.value)}
                        rows={3}
                        style={S.planEdit}
                      />
                    ) : (
                      <>
                        <div style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 17, marginTop: 4, color: C.text }}>
                          {t.title || humanTitle(t.type)}
                        </div>
                        <div style={{ fontSize: 13.5, color: C.textMuted, marginTop: 4, lineHeight: 1.45 }}>
                          {t.instruction}
                        </div>
                      </>
                    )}
                  </div>
                  {editingPlan && !t.required && (
                    <button type="button" onClick={() => removeTask(t.id)} style={S.removeBtn}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {error && <div style={S.error}>{error}</div>}
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" style={S.primary} disabled={tasks.length === 0} onClick={startRecordingSession}>
              Start recording session
            </button>
            <button type="button" style={S.secondary} onClick={() => setEditingPlan((v) => !v)}>
              {editingPlan ? "Done editing" : "Edit song plan"}
            </button>
            <button type="button" style={S.ghost} disabled={analyzing} onClick={startProducerSession}>
              Regenerate plan
            </button>
          </div>
        </div>
      )}

      {screen === "session" && current && (
        <div style={S.wrap}>
          <div style={S.topBar}>
            <button
              type="button"
              aria-label="Back to plan"
              onClick={() => setScreen("plan")}
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: C.surface,
                border: `1px solid ${C.border}`,
                color: C.text,
                cursor: "pointer",
                fontSize: 16,
                padding: 0,
              }}
            >
              ‹
            </button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{project?.title || "Session"}</div>
              <div style={{ fontSize: 11, color: C.brass, fontFamily: "ui-monospace, monospace" }}>
                {progressLabel}
              </div>
            </div>
            <div style={{ width: 34 }} />
          </div>

          <SessionTimeline tasks={tasks} currentId={current.id} />

          <div style={{ textAlign: "center", marginTop: 18 }}>
            <h1 style={{ ...S.title, fontSize: "clamp(1.6rem, 4vw, 2rem)", letterSpacing: 1 }}>
              {sectionLabel(current)}
            </h1>
            <div style={{ color: C.brass, fontSize: 14, marginTop: 4 }}>{roleLabel(current)}</div>
          </div>

          <div style={S.instructionBox}>
            <div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.45 }}>{current.instruction}</div>
            {current.reason && (
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>{current.reason}</div>
            )}
          </div>

          <div style={{ margin: "22px 0 8px" }}>
            <Waveform
              bars={sessionPhase === "recording" ? liveBars : sectionBars}
              progress={sessionPhase === "recording" ? 1 : sessionPhase === "review" ? 0.55 : 0.35}
              height={sessionPhase === "recording" ? 72 : 56}
              color={sessionPhase === "recording" || sessionPhase === "review" ? C.signal : C.waveMuted}
              live={sessionPhase === "recording"}
            />
          </div>

          {sessionPhase === "recording" && (
            <div
              style={{
                textAlign: "center",
                fontFamily: "ui-monospace, monospace",
                fontSize: 28,
                color: C.signal,
                marginBottom: 8,
              }}
            >
              {fmtClock(recordSeconds)}
            </div>
          )}

          {error && <div style={S.error}>{error}</div>}

          {sessionPhase === "ready" && (
            <>
              <button
                type="button"
                style={{ ...S.secondary, width: "100%", marginTop: 8 }}
                disabled={!beatUrl}
                onClick={playSection}
              >
                ▶ Hear section
              </button>
              <p
                style={{
                  textAlign: "center",
                  fontSize: 12.5,
                  color: C.textFaint,
                  margin: "14px 0 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                🎧 Use headphones for the cleanest recording
              </p>
              <button type="button" style={S.primary} onClick={startRecording}>
                Record
              </button>
              {(completedCount > 0 || localBlobUrl) && (
                <button
                  type="button"
                  style={{ ...S.ghost, marginTop: 8 }}
                  disabled={previewLoading}
                  onClick={playSessionSoFar}
                >
                  {previewPlaying ? "Stop mix" : "What I have so far"}
                </button>
              )}
            </>
          )}

          {sessionPhase === "recording" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 12 }}>
              <button type="button" style={S.stopBtn} onClick={stopRecording} aria-label="Stop">
                <span style={{ width: 18, height: 18, background: "#1A0605", borderRadius: 3 }} />
              </button>
              <span style={{ fontSize: 13, color: C.textMuted }}>Sing with the beat · stop when done</span>
            </div>
          )}

          {sessionPhase === "review" && (
            <div style={{ marginTop: 12 }}>
              <p style={{ textAlign: "center", color: C.textMuted, marginBottom: 12 }}>
                {uploading ? "Saving your take…" : "How does it feel?"}
              </p>
              {(localBlobUrl || lastTake?.audio_url) && (
                <StudioPlayer
                  src={(localBlobUrl || lastTake?.audio_url)!}
                  seed={`take-${current.id}`}
                  accent={C.signal}
                />
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
                <button type="button" style={S.primary} disabled={uploading} onClick={keepAndContinue}>
                  Keep take
                </button>
                <button
                  type="button"
                  style={S.secondary}
                  disabled={uploading}
                  onClick={() => {
                    stopSessionPreview();
                    setLocalBlobUrl(null);
                    setLastTake(null);
                    setSessionPhase("ready");
                  }}
                >
                  Record again
                </button>
                <button
                  type="button"
                  style={S.ghost}
                  disabled={uploading || previewLoading}
                  onClick={playSessionSoFar}
                >
                  {previewPlaying ? "Stop mix" : "Play with beat"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === "done" && (
        <div style={S.wrap}>
          <div style={S.topBar}>
            <Link href="/app" style={S.back}>
              ← Projects
            </Link>
            <span style={S.badge}>{project?.status === "complete" ? "Complete" : "Recorded"}</span>
          </div>
          <h1 style={{ ...S.title, textAlign: "center" }}>
            {masterUrl || project?.status === "complete" ? "Your song is ready" : "Your performances are in"}
          </h1>
          <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>
            {masterUrl
              ? "Play it back, then download your master."
              : `${completedCount} of ${tasks.length} parts captured. Next we arrange, mix, and master.`}
          </p>
          {masterUrl && (
            <div style={{ marginTop: 24 }}>
              <StudioPlayer src={masterUrl} seed={`master-${id}`} accent={C.signal} bigPlay />
            </div>
          )}
          {error && <div style={S.error}>{error}</div>}
          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
            {!masterUrl && (
              <button type="button" style={S.primary} disabled={producing} onClick={startProduce}>
                {producing ? "Producing…" : "Produce my song"}
              </button>
            )}
            <button
              type="button"
              style={masterUrl ? S.primary : S.secondary}
              disabled={producing}
              onClick={downloadSong}
            >
              Download song
            </button>
            {(completedCount > 0 || localBlobUrl) && (
              <button type="button" style={S.ghost} disabled={previewLoading} onClick={playSessionSoFar}>
                {previewPlaying ? "Stop preview" : "Hear raw session"}
              </button>
            )}
          </div>
          {masterUrl && (
            <p style={{ textAlign: "center", fontSize: 12, color: C.textFaint, marginTop: 12 }}>{downloadName}</p>
          )}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 50%)`,
    color: C.text,
    fontFamily: "Inter, system-ui, sans-serif",
  },
  wrap: {
    maxWidth: 520,
    margin: "0 auto",
    padding: "16px 20px 48px",
    width: "100%",
    boxSizing: "border-box",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    minHeight: 36,
  },
  back: { color: C.textMuted, textDecoration: "none", fontSize: 14 },
  backBtn: {
    background: "none",
    border: "none",
    color: C.textMuted,
    fontSize: 14,
    cursor: "pointer",
    padding: 0,
    fontFamily: "inherit",
  },
  badge: {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 999,
    background: C.surface,
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  eyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: 2,
    color: C.brass,
    marginBottom: 8,
  },
  title: {
    fontFamily: "Fraunces, Georgia, serif",
    fontSize: "clamp(1.5rem, 4vw, 1.85rem)",
    fontWeight: 500,
    margin: "12px 0 0",
    color: C.text,
  },
  metaLine: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    color: C.brass,
    marginTop: 6,
    letterSpacing: 0.4,
  },
  instructionBox: {
    marginTop: 18,
    padding: "16px 18px",
    borderRadius: 16,
    background: C.surface,
    border: `1px solid ${C.border}`,
    textAlign: "center",
  },
  planCard: {
    padding: "14px 16px",
    borderRadius: 16,
    background: C.surface,
    border: `1px solid ${C.border}`,
  },
  planEdit: {
    width: "100%",
    marginTop: 8,
    resize: "vertical",
    background: "rgba(0,0,0,0.28)",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: 10,
    color: C.text,
    fontFamily: "inherit",
    fontSize: 13.5,
    boxSizing: "border-box",
  },
  primary: {
    width: "100%",
    padding: "15px 20px",
    borderRadius: 16,
    border: "none",
    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15.5,
    cursor: "pointer",
    fontFamily: "inherit",
    boxShadow: "0 8px 24px -8px rgba(231,169,97,0.5)",
  },
  secondary: {
    width: "100%",
    padding: "14px 20px",
    borderRadius: 16,
    border: `1px solid ${C.border}`,
    background: "rgba(255,255,255,0.04)",
    color: C.text,
    fontWeight: 500,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  secondaryFlex: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 14,
    border: `1px solid ${C.border}`,
    background: "rgba(255,255,255,0.04)",
    color: C.text,
    fontWeight: 500,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  ghost: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 14,
    border: "none",
    background: "transparent",
    color: C.textMuted,
    fontWeight: 500,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  stopBtn: {
    width: 72,
    height: 72,
    borderRadius: 999,
    border: "none",
    background: C.danger,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    boxShadow: "0 10px 26px -8px rgba(232,117,106,0.55)",
  },
  removeBtn: {
    background: "none",
    border: "none",
    color: C.danger,
    fontSize: 12,
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "inherit",
  },
  error: {
    marginTop: 14,
    padding: "12px 14px",
    borderRadius: 12,
    background: "rgba(255,107,107,0.1)",
    color: "#ffb4b4",
    fontSize: 13.5,
  },
};

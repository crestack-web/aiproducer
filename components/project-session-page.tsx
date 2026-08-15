"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { StudioPlayer, CompactAudioPlayer } from "@/components/studio-player";

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
 metadata?: { section_label?: string; vocal_part?: string };
};

type ProjectMeta = {
 id: string;
 status: string;
 title?: string | null;
 genre?: string | null;
 mood?: string | null;
 tempo?: number | null;
};

type Screen = "beat" | "analyzing" | "plan" | "session" | "assemble" | "done";

const C = {
 bg: "#0B0A0F",
 surface: "rgba(255,255,255,0.045)",
 border: "rgba(255,255,255,0.09)",
 brass: "#E7A961",
 brassSoft: "rgba(231,169,97,0.15)",
 signal: "#7BEBD4",
 text: "#F4F1EC",
 textMuted: "#9B96A3",
 textFaint: "#5C5866",
 danger: "#E8756A",
};

function humanTitle(type: string) {
 const t = (type || "").toLowerCase();
 if (t.includes("harmony")) return "Harmony";
 if (t.includes("adlib")) return "Ad-libs";
 if (t.includes("double")) return "Double";
 return "Lead vocal";
}

function sectionLabel(t: Task) {
 return (t.metadata?.section_label || t.title || humanTitle(t.type) || "SECTION").toUpperCase();
}

function isTaskOpen(t: Task) {
 return t.status === "pending" || t.status === "in_progress";
}

function isTaskDone(t: Task) {
 return t.status === "completed" || t.status === "skipped";
}

function requiredOpen(tasks: Task[]) {
 return tasks.filter((t) => t.required && isTaskOpen(t));
}

function optionalOpen(tasks: Task[]) {
 return tasks.filter((t) => !t.required && isTaskOpen(t));
}

export default function ProjectDetailPage() {
 const id = useParams().id as string;
 const [project, setProject] = useState<ProjectMeta | null>(null);
 const [beatUrl, setBeatUrl] = useState<string | null>(null);
 const [tasks, setTasks] = useState<Task[]>([]);
 const [screen, setScreen] = useState<Screen>("beat");
 const [loading, setLoading] = useState(true);
 const [analyzing, setAnalyzing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [producing, setProducing] = useState(false);
 const [masterUrl, setMasterUrl] = useState<string | null>(null);
 const [phase, setPhase] = useState<"ready" | "recording" | "review">("ready");
 const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
 const [uploading, setUploading] = useState(false);
 const [savedRecordingId, setSavedRecordingId] = useState<string | null>(null);
 const [skipping, setSkipping] = useState(false);
 const [recordSeconds, setRecordSeconds] = useState(0);
 const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
 const mediaRecorderRef = useRef<MediaRecorder | null>(null);
 const chunksRef = useRef<Blob[]>([]);
 const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
 const streamRef = useRef<MediaStream | null>(null);
 const beatAudioRef = useRef<HTMLAudioElement | null>(null);
 const startedAtRef = useRef(0);

 const current = tasks.find((t) => t.id === activeTaskId) || tasks.find((t) => isTaskOpen(t)) || null;
 const isRetake = current ? isTaskDone(current) : false;

 const load = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const [pr, br, tr] = await Promise.all([
 fetch(`/api/projects/${id}`),
 fetch(`/api/projects/${id}/beat`),
 fetch(`/api/projects/${id}/recording-tasks`),
 ]);
 if (pr.ok) {
 const j = await pr.json();
 setProject(j.project || j);
 }
 if (br.ok) setBeatUrl((await br.json()).audio_url || null);
 if (tr.ok) setTasks((await tr.json()).tasks || []);
 const sr = await fetch(`/api/projects/${id}/status`);
 if (sr.ok) {
 const st = await sr.json();
 if (st.project) setProject(st.project);
 if (st.master_url) setMasterUrl(st.master_url);
 }
 } catch (e) {
 setError(e instanceof Error ? e.message : "Load failed");
 } finally {
 setLoading(false);
 }
 }, [id]);

 useEffect(() => {
 load();
 }, [load]);

 useEffect(() => {
 if (!project) return;
 if (project.status === "ready" || project.status === "planned") setScreen("plan");
 if (project.status === "recording" || project.status === "in_progress") setScreen("session");
 if (project.status === "produced" || project.status === "done") setScreen("done");
 }, [project?.status]);

 async function startProducerSession() {
 setAnalyzing(true);
 setError(null);
 setScreen("analyzing");
 try {
 const res = await fetch(`/api/projects/${id}/analyze`, { method: "POST" });
 const j = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(j.error || "Could not build plan");
 const tr = await fetch(`/api/projects/${id}/recording-tasks`);
 if (tr.ok) setTasks((await tr.json()).tasks || []);
 const sr = await fetch(`/api/projects/${id}/status`);
 if (sr.ok) setProject((await sr.json()).project);
 setScreen("plan");
 } catch (e) {
 setError(e instanceof Error ? e.message : "Analyze failed");
 setScreen("beat");
 } finally {
 setAnalyzing(false);
 }
 }

 async function playSection() {
 if (!beatUrl || !beatAudioRef.current || !current) return;
 const el = beatAudioRef.current;
 const start = (current.start_ms ?? 0) / 1000;
 const end = (current.end_ms ?? 0) / 1000;
 el.currentTime = start;
 el.volume = 0.7;
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

 async function startRecording() {
 if (!current) return;
 setError(null);
 setSavedRecordingId(null);
 try {
 const stream = await navigator.mediaDevices.getUserMedia({
 audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
 });
 streamRef.current = stream;
 chunksRef.current = [];
 let mime = "audio/webm";
 for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
 if (MediaRecorder.isTypeSupported(t)) {
 mime = t;
 break;
 }
 }
 const rec = new MediaRecorder(stream, { mimeType: mime });
 mediaRecorderRef.current = rec;
 rec.ondataavailable = (e) => {
 if (e.data?.size) chunksRef.current.push(e.data);
 };
 rec.onstop = async () => {
 if (timerRef.current) clearInterval(timerRef.current);
 streamRef.current?.getTracks().forEach((t) => t.stop());
 beatAudioRef.current?.pause();
 const blob = new Blob(chunksRef.current, { type: mime.split(";")[0] });
 setLocalBlobUrl(URL.createObjectURL(blob));
 setPhase("review");
 setUploading(true);
 try {
 const form = new FormData();
 form.append("file", blob, "take.webm");
 form.append("duration_ms", String(Date.now() - startedAtRef.current));
 const res = await fetch(`/api/recording-tasks/${current.id}/recordings`, {
 method: "POST",
 body: form,
 });
 const j = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(j.error || "Upload failed");
 if (!j.recording?.id) throw new Error("Upload succeeded but no recording id returned");
 setSavedRecordingId(j.recording.id);
 await fetch(`/api/recording-tasks/${current.id}/recordings/${j.recording.id}/select`, {
 method: "POST",
 }).catch(() => undefined);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Save failed");
 setSavedRecordingId(null);
 } finally {
 setUploading(false);
 }
 };
 startedAtRef.current = Date.now();
 setRecordSeconds(0);
 timerRef.current = setInterval(
 () => setRecordSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)),
 250
 );
 if (beatAudioRef.current && beatUrl) {
 beatAudioRef.current.currentTime = (current.start_ms ?? 0) / 1000;
 beatAudioRef.current.volume = 0.55;
 beatAudioRef.current.play().catch(() => undefined);
 }
 rec.start(250);
 setPhase("recording");
 } catch (e) {
 setError(e instanceof Error ? e.message : "Microphone error");
 }
 }

 function stopRecording() {
 mediaRecorderRef.current?.stop();
 }

 function clearFocusAndAdvance(next: Task[]) {
 setActiveTaskId(null);
 setLocalBlobUrl(null);
 setPhase("ready");
 setScreen("session");
 if (requiredOpen(next).length === 0 && optionalOpen(next).length === 0) {
 setScreen("assemble");
 }
 }

 function keepAndContinue() {
 if (!current) return;
 if (!savedRecordingId) {
 setError("Take is not saved yet. Wait for Saved, or record again.");
 return;
 }
 const wasRetake = isRetake;
 setSavedRecordingId(null);
 setTasks((prev) => {
 const next = prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t));
 if (wasRetake) {
 setActiveTaskId(null);
 setLocalBlobUrl(null);
 setPhase("ready");
 setScreen("session");
 if (requiredOpen(next).length === 0 && optionalOpen(next).length === 0) {
 setScreen("assemble");
 }
 } else {
 clearFocusAndAdvance(next);
 }
 return next;
 });
 }

 async function skipCurrent() {
 if (!current || current.required) return;
 setSkipping(true);
 try {
 await fetch(`/api/recording-tasks/${current.id}/skip`, { method: "POST" });
 setTasks((prev) => {
 const next = prev.map((t) => (t.id === current.id ? { ...t, status: "skipped" } : t));
 clearFocusAndAdvance(next);
 return next;
 });
 } catch (e) {
 setError(e instanceof Error ? e.message : "Skip failed");
 } finally {
 setSkipping(false);
 }
 }

 async function startProduce() {
 setProducing(true);
 setError(null);
 try {
 const res = await fetch(`/api/projects/${id}/produce`, { method: "POST" });
 const j = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(j.error || "Produce failed");
 if (j.master_url) setMasterUrl(j.master_url);
 setScreen("done");
 } catch (e) {
 setError(e instanceof Error ? e.message : "Produce failed");
 } finally {
 setProducing(false);
 }
 }

 async function downloadSong() {
 if (!masterUrl) return;
 const a = document.createElement("a");
 a.href = masterUrl;
 a.download = "studio-song-master.wav";
 a.click();
 }

 const btn: React.CSSProperties = {
 width: "100%",
 padding: "14px 18px",
 borderRadius: 14,
 border: "none",
 background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
 color: "#1A1208",
 fontWeight: 600,
 fontSize: 15,
 cursor: "pointer",
 };
 const btn2: React.CSSProperties = {
 ...btn,
 background: C.surface,
 color: C.text,
 border: `1px solid ${C.border}`,
 };
 const wrap: React.CSSProperties = {
 maxWidth: 480,
 margin: "0 auto",
 padding: "20px 18px 100px",
 minHeight: "100vh",
 background: C.bg,
 color: C.text,
 fontFamily: "system-ui, sans-serif",
 };
 const title: React.CSSProperties = {
 fontFamily: "Georgia, serif",
 fontSize: 24,
 fontWeight: 500,
 };

 if (loading) {
 return (
 <div style={wrap}>
 <p style={{ color: C.textMuted, textAlign: "center", marginTop: 80 }}>Loading project…</p>
 </div>
 );
 }

 return (
 <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>
 {beatUrl && (
 <audio id="studio-session-beat" ref={beatAudioRef} src={beatUrl} preload="auto" style={{ display: "none" }} />
 )}

 {screen === "beat" && (
 <div style={wrap}>
 <Link href="/app" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
 ← Projects
 </Link>
 <h1 style={{ ...title, textAlign: "center", marginTop: 24 }}>Your beat</h1>
 {beatUrl ? (
 <StudioPlayer
 src={beatUrl}
 title={project?.title || "Beat"}
 subtitle={[project?.genre, project?.mood, project?.tempo ? `${project.tempo} BPM` : null]
 .filter(Boolean)
 .join(" · ")}
 seed={project?.title || "beat"}
 accent="brass"
 />
 ) : (
 <p style={{ textAlign: "center", color: C.textMuted, marginTop: 24 }}>Waiting for beat…</p>
 )}
 {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
 <button type="button" style={{ ...btn, marginTop: 18 }} disabled={analyzing || !beatUrl} onClick={startProducerSession}>
 {analyzing ? "Starting…" : beatUrl ? "Start AI Producer Session" : "Waiting for beat…"}
 </button>
 </div>
 )}

 {screen === "analyzing" && (
 <div style={wrap}>
 <p style={{ textAlign: "center", color: C.textMuted, marginTop: 80 }}>Your AI Producer is analyzing the beat…</p>
 </div>
 )}

 {screen === "plan" && (
 <div style={wrap}>
 <button type="button" style={{ background: "none", border: "none", color: C.textMuted, marginBottom: 16, cursor: "pointer" }} onClick={() => setScreen("beat")}>
 ← Back to beat
 </button>
 <h1 style={title}>Song plan</h1>
 <p style={{ color: C.textMuted, fontSize: 14, marginTop: 8 }}>Record each part. You can skip optional ones.</p>
 <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
 {tasks.map((t) => (
 <div
 key={t.id}
 style={{
 padding: "12px 14px",
 borderRadius: 12,
 border: `1px solid ${C.border}`,
 background: C.surface,
 opacity: isTaskDone(t) ? 0.55 : 1,
 }}
 >
 <div style={{ fontSize: 12, color: C.brass, letterSpacing: 0.5 }}>{sectionLabel(t)}</div>
 <div style={{ fontSize: 14, marginTop: 4 }}>{t.instruction}</div>
 <div style={{ fontSize: 12, color: C.textFaint, marginTop: 4 }}>
 {isTaskDone(t) ? "✓ Done" : t.required ? "Required" : "Optional"}
 </div>
 </div>
 ))}
 </div>
 <button
 type="button"
 style={{ ...btn, marginTop: 20 }}
 onClick={() => {
 const open = requiredOpen(tasks)[0] || optionalOpen(tasks)[0];
 if (open) setActiveTaskId(open.id);
 setPhase("ready");
 setScreen("session");
 }}
 >
 Start recording
 </button>
 </div>
 )}

 {screen === "session" && current && (
 <div style={wrap}>
 <button
 type="button"
 style={{ background: "none", border: "none", color: C.textMuted, marginBottom: 12, cursor: "pointer" }}
 onClick={() => setScreen("plan")}
 >
 ← Plan
 </button>
 <div style={{ fontSize: 12, color: C.brass, letterSpacing: 0.6 }}>{sectionLabel(current)}</div>
 <h1 style={{ ...title, marginTop: 6 }}>{humanTitle(current.type)}</h1>
 <p style={{ color: C.textMuted, fontSize: 14, marginTop: 8 }}>{current.instruction}</p>
 {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}

 {phase === "ready" && (
 <div style={{ marginTop: 20 }}>
 <button type="button" style={{ ...btn2, marginBottom: 10 }} disabled={!beatUrl} onClick={playSection}>
 Preview section beat
 </button>
 <button type="button" style={btn} onClick={startRecording}>
 Record
 </button>
 {!current.required && (
 <button type="button" style={{ ...btn2, marginTop: 10, color: C.textMuted }} disabled={skipping} onClick={skipCurrent}>
 Skip this part
 </button>
 )}
 </div>
 )}

 {phase === "recording" && (
 <div style={{ marginTop: 24, textAlign: "center" }}>
 <div style={{ fontSize: 32, fontFamily: "monospace", color: C.signal }}>{recordSeconds}s</div>
 <p style={{ color: C.textMuted, marginTop: 8 }}>Recording… beat is playing under you</p>
 <button type="button" style={{ ...btn, marginTop: 18, background: C.danger, color: "#fff" }} onClick={stopRecording}>
 Stop
 </button>
 </div>
 )}

 {phase === "review" && (
 <div style={{ marginTop: 16 }}>
 <p style={{ textAlign: "center", color: C.textMuted }}>
 {uploading
 ? "Saving take…"
 : savedRecordingId
 ? isRetake
 ? "Saved ✓ — keep new take?"
 : "Saved ✓ — keep this take or record again"
 : "How does it feel?"}
 </p>
 {localBlobUrl && (
 <CompactAudioPlayer
 src={localBlobUrl}
 label="Your take"
 seed={`take-${current.id}`}
 beatSrc={beatUrl}
 beatStartMs={current.start_ms ?? 0}
 beatEndMs={current.end_ms}
 beatVolume={0.55}
 vocalVolume={1}
 />
 )}
 <button
 type="button"
 style={{ ...btn, marginTop: 16, opacity: uploading || !savedRecordingId ? 0.5 : 1 }}
 disabled={uploading || !savedRecordingId}
 onClick={keepAndContinue}
 >
 {uploading ? "Saving…" : savedRecordingId ? (isRetake ? "Keep new take" : "Keep take") : "Waiting for save…"}
 </button>
 <button
 type="button"
 style={{ ...btn2, marginTop: 8 }}
 disabled={uploading}
 onClick={() => {
 setLocalBlobUrl(null);
 setSavedRecordingId(null);
 setPhase("ready");
 }}
 >
 Record again
 </button>
 {!current.required && isTaskOpen(current) && (
 <button type="button" style={{ ...btn2, marginTop: 8, color: C.textMuted }} disabled={uploading || skipping} onClick={skipCurrent}>
 Discard & skip this part
 </button>
 )}
 </div>
 )}
 </div>
 )}

 {screen === "session" && !current && (
 <div style={wrap}>
 <h1 style={title}>All parts done</h1>
 <button type="button" style={{ ...btn, marginTop: 20 }} onClick={() => setScreen("assemble")}>
 Continue to produce
 </button>
 </div>
 )}

 {screen === "assemble" && (
 <div style={wrap}>
 <h1 style={{ ...title, textAlign: "center" }}>Ready to produce</h1>
 <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>
 We will mix your vocals with the beat.
 </p>
 {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
 <button type="button" style={{ ...btn, marginTop: 20 }} disabled={producing} onClick={startProduce}>
 {producing ? "Producing…" : "Produce my song"}
 </button>
 <button type="button" style={{ ...btn2, marginTop: 10 }} onClick={() => setScreen("session")}>
 Back to recording
 </button>
 </div>
 )}

 {screen === "done" && (
 <div style={wrap}>
 <Link href="/app" style={{ color: C.textMuted, textDecoration: "none", fontSize: 14 }}>
 ← Projects
 </Link>
 <h1 style={{ ...title, textAlign: "center", marginTop: 24 }}>Your song is ready</h1>
 <p style={{ textAlign: "center", color: C.textMuted, fontSize: 14, marginTop: 8 }}>
 Play it back, then download your master.
 </p>
 {masterUrl && (
 <StudioPlayer
 src={masterUrl}
 title={project?.title || "Your song"}
 subtitle={[project?.genre, project?.mood].filter(Boolean).join(" · ") || "Master"}
 seed={`${project?.title || "song"}-master`}
 accent="signal"
 />
 )}
 {error && <p style={{ color: C.danger, marginTop: 12 }}>{error}</p>}
 <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
 {!masterUrl && (
 <button type="button" style={btn} disabled={producing} onClick={startProduce}>
 {producing ? "Producing…" : "Produce my song"}
 </button>
 )}
 <button type="button" style={masterUrl ? btn : btn2} disabled={producing || !masterUrl} onClick={downloadSong}>
 Download song
 </button>
 </div>
 </div>
 )}
 </div>
 );
}

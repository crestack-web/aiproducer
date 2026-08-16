"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { analyzeAudioFile } from "@/lib/audio/beat-detect";

const C = {
  bg: "#0B0A0F",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
};

const GENRES = ["R&B", "Afrobeats", "Hip-Hop", "Pop", "Amapiano", "Gospel", "Highlife"];
const MOODS = ["Emotional", "Confident", "Dark", "Romantic", "Energetic", "Chill"];
const GRAD = [
  ["#3A2E52", "#0B0A0F"],
  ["#2E4A4A", "#0B0A0F"],
  ["#4A2E3A", "#0B0A0F"],
  ["#39422E", "#0B0A0F"],
  ["#2E3A4A", "#0B0A0F"],
];

type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
};

function coverFor(seed: string) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i) * (i + 1)) % GRAD.length;
  return GRAD[n];
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    draft: "Draft",
    generating_beat: "Creating beat…",
    beat_ready: "Beat ready",
    analyzing: "Producer analyzing…",
    blueprint_ready: "Plan ready",
    recording: "Recording",
    processing: "Assembling…",
    mixing: "Mixing…",
    mastering: "Mastering…",
    complete: "Song ready",
    failed: "Needs attention",
  };
  return m[s] || s;
}

export default function StudioPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState("R&B");
  const [mood, setMood] = useState("Emotional");
  const [prompt, setPrompt] = useState("");
  const [tempo, setTempo] = useState(104);
  const [beatMode, setBeatMode] = useState<"ai" | "upload">("ai");
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tempoLabel = tempo < 90 ? "Slow" : tempo < 125 ? "Medium" : "Fast";

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth?mode=login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, genre")
        .eq("id", user.id)
        .maybeSingle();
      setUserName(profile?.display_name || user.email?.split("@")[0] || "Artist");
      if (profile?.genre) setGenre(profile.genre);
      const res = await fetch("/api/projects");
      if (res.ok) {
        const json = await res.json();
        setProjects((json.projects || []).filter((p: Project) => p.status !== "draft"));
      }
      setLoading(false);
    })();
  }, [router]);

  async function measureBeatFile(file: File) {
    try {
      const a = await analyzeAudioFile(file);
      return {
        duration_ms: a.duration_ms,
        bpm: a.bpm,
        bpm_confidence: a.confidence,
        beat_times_ms: a.beat_times_ms.slice(0, 400),
        analysis_source: "client_energy_acf" as const,
      };
    } catch (e) {
      console.warn("beat analysis failed, using form tempo", e);
      return {
        duration_ms: null as number | null,
        bpm: tempo,
        bpm_confidence: null as number | null,
        beat_times_ms: [] as number[],
        analysis_source: null as string | null,
      };
    }
  }

  async function uploadCustomBeat(projectId: string, file: File) {
    const measured = await measureBeatFile(file);
    // Prefer measured BPM when confidence is reasonable
    const effectiveBpm =
      measured.bpm_confidence != null && measured.bpm_confidence >= 0.12
        ? Math.round(measured.bpm)
        : tempo;

    const signRes = await fetch(`/api/projects/${projectId}/beat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "sign", filename: file.name, contentType: file.type || "audio/wav" }),
    });
    if (!signRes.ok) {
      const j = await signRes.json().catch(() => ({}));
      if (file.size <= 4 * 1024 * 1024) {
        const form = new FormData();
        form.append("file", file);
        form.append("genre", genre);
        form.append("mood", mood);
        form.append("tempo", String(effectiveBpm));
        form.append("bpm", String(effectiveBpm));
        if (measured.duration_ms) form.append("duration_ms", String(measured.duration_ms));
        if (measured.bpm_confidence != null) form.append("bpm_confidence", String(measured.bpm_confidence));
        if (measured.analysis_source) form.append("analysis_source", measured.analysis_source);
        form.append("measured_bpm", measured.bpm != null ? String(measured.bpm) : "");
        const beatRes = await fetch(`/api/projects/${projectId}/beat`, { method: "POST", body: form });
        if (!beatRes.ok) {
          const err = await beatRes.json().catch(() => ({}));
          throw new Error(err.error || j.error || "Beat upload failed");
        }
        return;
      }
      throw new Error(j.error || "Could not start beat upload");
    }
    const signed = await signRes.json();
    const put = await fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "audio/wav" },
      body: file,
    });
    if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
    const completeRes = await fetch(`/api/projects/${projectId}/beat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "complete",
        path: signed.path,
        filename: file.name,
        contentType: file.type || "audio/wav",
        size: file.size,
        genre,
        mood,
        tempo: effectiveBpm,
        bpm: effectiveBpm,
        duration_ms: measured.duration_ms,
        bpm_confidence: measured.bpm_confidence,
        beat_times_ms: measured.beat_times_ms,
        analysis_source: measured.analysis_source,
      }),
    });
    if (!completeRes.ok) {
      const j = await completeRes.json().catch(() => ({}));
      throw new Error(j.error || "Could not save uploaded beat");
    }
  }

  async function discardFailedProject(projectId: string) {
    try {
      await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    } catch {
      /* best-effort */
    }
  }

  async function createAndGenerate() {
    setCreating(true);
    setError(null);
    let projectId: string | null = null;
    try {
      if (beatMode === "upload" && !beatFile) throw new Error("Choose a beat file to upload");

      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:
            beatMode === "upload" && beatFile
              ? beatFile.name.replace(/\.[^.]+$/, "")
              : `${mood} ${genre}`,
          genre,
          mood,
          tempo,
          prompt: prompt.trim() || undefined,
        }),
      });
      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not start session");
      }
      const { project } = await createRes.json();
      projectId = project.id;

      if (beatMode === "upload") {
        await uploadCustomBeat(project.id, beatFile!);
      } else {
        const beatRes = await fetch(`/api/projects/${project.id}/generate-beat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ genre, mood, tempo, prompt: prompt.trim() || undefined }),
        });
        if (!beatRes.ok) {
          const j = await beatRes.json().catch(() => ({}));
          throw new Error(j.error || "Beat generation failed");
        }
      }

      router.push(`/app/studio/${project.id}`);
    } catch (e) {
      if (projectId) await discardFailedProject(projectId);
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }

  const inProgress = projects.filter((p) => p.status !== "complete" && p.status !== "failed");

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "8px 14px",
    borderRadius: 999,
    border: on ? `1px solid ${C.brassLine}` : `1px solid ${C.border}`,
    background: on ? C.brassSoft : "transparent",
    color: on ? C.brass : C.textMuted,
    fontSize: 13,
    fontWeight: on ? 600 : 400,
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <AppShell active="studio" userName={userName} onSignOut={signOut}>
      <div
        style={{
          width: "100%",
          maxWidth: 920,
          margin: "0 auto",
          padding: "28px 20px 32px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 2, color: C.brass, marginBottom: 10 }}>
          ◆ STUDIO
        </div>
        <h1 style={{ fontFamily: "Georgia, Fraunces, serif", fontSize: "clamp(1.75rem, 3.2vw, 2.35rem)", fontWeight: 500, margin: "0 0 8px", color: C.text }}>
          Create your beat
        </h1>
        <p style={{ color: C.textMuted, fontSize: 14.5, lineHeight: 1.5, margin: "0 0 24px", maxWidth: 520 }}>
          Describe the sound, pick genre and mood, set tempo — then your AI producer guides the session section by section.
        </p>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: "24px 22px 22px" }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Emotional Afrobeats song about falling in love at night, warm guitars, deep bass…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 110,
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              background: "rgba(0,0,0,0.25)",
              color: C.text,
              padding: 14,
              fontSize: 14.5,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Genre</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {GENRES.map((g) => (
                <button key={g} type="button" style={chip(genre === g)} onClick={() => setGenre(g)}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Mood</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {MOODS.map((m) => (
                <button key={m} type="button" style={chip(mood === m)} onClick={() => setMood(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>
              Tempo · {tempo} BPM · {tempoLabel}
            </div>
            <input type="range" min={60} max={160} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} aria-label="Tempo" style={{ width: "100%" }} />
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Beat source</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" style={chip(beatMode === "ai")} onClick={() => setBeatMode("ai")}>
                AI beat
              </button>
              <button type="button" style={chip(beatMode === "upload")} onClick={() => setBeatMode("upload")}>
                Upload my beat
              </button>
            </div>
          </div>

          {beatMode === "upload" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm"
                style={{ display: "none" }}
                onChange={(e) => setBeatFile(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "rgba(255,255,255,0.04)",
                  color: C.text,
                  fontWeight: 500,
                  fontSize: 13.5,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onClick={() => fileRef.current?.click()}
              >
                {beatFile ? "Change file" : "Choose beat file"}
              </button>
              <span style={{ fontSize: 13, color: C.textMuted }}>{beatFile ? beatFile.name : "WAV, MP3, M4A…"}</span>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "rgba(255,107,107,0.1)", color: "#ffb4b4", fontSize: 13.5 }}>
              {error}
            </div>
          )}

          <button
            type="button"
            style={{
              width: "100%",
              marginTop: 22,
              padding: "14px 20px",
              borderRadius: 14,
              border: "none",
              background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
              color: "#1A1208",
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: creating || (beatMode === "upload" && !beatFile) ? 0.55 : 1,
            }}
            disabled={creating || (beatMode === "upload" && !beatFile)}
            onClick={createAndGenerate}
          >
            {creating
              ? beatMode === "upload"
                ? "Analyzing beat…"
                : "Creating beat…"
              : beatMode === "upload"
                ? "Start with my beat"
                : "Create beat"}
          </button>
        </div>

        {!loading && inProgress.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", color: C.textFaint, marginBottom: 12 }}>
              Continue a session
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {inProgress.slice(0, 6).map((p) => {
                const g = coverFor(p.id + (p.title || ""));
                return (
                  <Link
                    key={p.id}
                    href={`/app/studio/${p.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      textDecoration: "none",
                      color: C.text,
                    }}
                  >
                    <div style={{ width: 48, height: 48, borderRadius: 10, background: `linear-gradient(145deg, ${g[0]}, ${g[1]})`, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
                        {statusLabel(p.status)}
                        {[p.genre, p.mood].filter(Boolean).length ? ` · ${[p.genre, p.mood].filter(Boolean).join(" · ")}` : ""}
                      </div>
                    </div>
                    <span style={{ color: C.brass, fontSize: 13, fontWeight: 600 }}>Open</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

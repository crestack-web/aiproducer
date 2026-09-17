"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { analyzeAudioFile } from "@/lib/audio/beat-detect";
import { useTheme } from "@/lib/theme";

const GENRES = [
  "R&B",
  "Afrobeats",
  "Amapiano",
  "Hip-Hop",
  "Trap",
  "Drill",
  "Pop",
  "Gospel",
  "Highlife",
  "Afro-fusion",
  "Dancehall",
  "Reggaeton",
  "Soul",
  "Neo-soul",
  "Lo-fi",
  "House",
  "EDM",
  "Indie",
  "Rock",
  "Jazz",
  "Country",
  "Folk",
  "Latin",
  "Hyperpop",
];
const MOODS = [
  "Emotional",
  "Confident",
  "Dark",
  "Romantic",
  "Energetic",
  "Chill",
  "Melancholic",
  "Uplifting",
  "Sensual",
  "Aggressive",
  "Hopeful",
  "Nostalgic",
  "Playful",
  "Spiritual",
  "Cinematic",
  "Dreamy",
];
const ENERGIES = [
  "Intimate",
  "Laid-back",
  "Driving",
  "Explosive",
  "Dreamy",
  "Aggressive",
  "Uplifting",
  "Hypnotic",
];
const INSTRUMENTATION = [
  "808-driven",
  "Heavy bass",
  "Log drum / Amapiano",
  "Acoustic guitar-led",
  "Electric guitar",
  "Keys / pad-led",
  "Piano-led",
  "Live drums",
  "Percussion-forward",
  "Synth-led",
  "Orchestral / strings",
  "Brass / horns",
  "Sparse minimal",
  "Sample-chop vibe",
];
const STYLE_PRESETS = [
  "Early Wizkid feel",
  "Tems atmosphere",
  "Burna groove",
  "2016 Drake melodic",
  "SZA late-night R&B",
  "Asake street energy",
  "Rema soft life",
  "Travis 808 world",
  "Gospel choir pocket",
  "Amapiano night drive",
];
/** Beat length presets (seconds). Free tier covers ≤30s. */
const LENGTH_PRESETS = [15, 30, 45, 60] as const;
/** Estimated USD/sec — override via env on server; client mirror for preview. */
const COST_PER_SEC_USD = 0.00583;
const FREE_MAX_SEC = 30;
const FREE_GEN_COUNT = 3;
type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
  has_beat?: boolean;
  has_master?: boolean;
  tempo?: number | null;
};

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

function StudioPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startInConsole = searchParams.get("mode") === "console";
  const { colors: C } = useTheme();
  const [userName, setUserName] = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState("R&B");
  const [mood, setMood] = useState("Emotional");
  const [prompt, setPrompt] = useState("");
  const [tempo, setTempo] = useState(104);
  const [beatDurationSec, setBeatDurationSec] = useState(30);
  const [createPanel, setCreatePanel] = useState<"sound" | "vibe" | "style" | "length">("sound");
  const [energy, setEnergy] = useState("Driving");
  const [instrumentation, setInstrumentation] = useState("808-driven");
  const [referenceStyle, setReferenceStyle] = useState("");
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [beatMode, setBeatMode] = useState<"ai" | "upload">("ai");
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingPlayId, setLoadingPlayId] = useState<string | null>(null);
  const [beatUrls, setBeatUrls] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
        setProjects((json.projects || []).filter((p: Project) => p.status !== "draft" && p.status !== "failed"));
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
    const effectiveBpm =
      measured.bpm_confidence != null && measured.bpm_confidence >= 0.12
        ? Math.round(measured.bpm)
        : tempo;
    const contentType = (file.type && file.type.trim()) || "audio/wav";
    const MAX_DIRECT = 4 * 1024 * 1024;

    async function uploadViaServerForm() {
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
        throw new Error(
          (typeof err.error === "string" && err.error) ||
            "Beat upload failed on server (multipart). Check R2 env on Vercel."
        );
      }
    }

    // Prefer browser → R2 presigned PUT; fall back to server multipart for smaller files.
    const signRes = await fetch(`/api/projects/${projectId}/beat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "sign", filename: file.name, contentType }),
    });

    if (!signRes.ok) {
      const j = await signRes.json().catch(() => ({}));
      if (file.size <= MAX_DIRECT) {
        await uploadViaServerForm();
        return;
      }
      throw new Error(
        (typeof j.error === "string" && j.error) ||
          "Could not start beat upload (sign). Check R2_ACCOUNT_ID / R2_BUCKET_NAME / R2_ENDPOINT on Vercel."
      );
    }

    const signed = await signRes.json();
    if (!signed?.signedUrl || !signed?.path) {
      if (file.size <= MAX_DIRECT) {
        await uploadViaServerForm();
        return;
      }
      throw new Error("Beat upload sign returned no URL");
    }

    const putCt = (typeof signed.contentType === "string" && signed.contentType) || contentType;
    let put: Response;
    try {
      put = await fetch(signed.signedUrl as string, {
        method: "PUT",
        headers: { "Content-Type": putCt },
        body: file,
      });
    } catch (netErr) {
      // Typical: CORS blocked or network to R2 failed
      if (file.size <= MAX_DIRECT) {
        await uploadViaServerForm();
        return;
      }
      throw new Error(
        `Beat storage PUT blocked (${netErr instanceof Error ? netErr.message : "network"}). ` +
          "Add CORS on the R2 bucket for https://apstudio.site (PUT, Content-Type)."
      );
    }

    if (!put.ok) {
      if (file.size <= MAX_DIRECT) {
        await uploadViaServerForm();
        return;
      }
      throw new Error(
        `Beat storage PUT failed (${put.status}). ` +
          "For 403: R2 CORS must allow origin https://apstudio.site and header Content-Type."
      );
    }

    const completeRes = await fetch(`/api/projects/${projectId}/beat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "complete",
        path: signed.path,
        filename: file.name,
        contentType: putCt,
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
      throw new Error(
        (typeof j.error === "string" && j.error) ||
          "Beat file reached storage but could not be registered (complete step)."
      );
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
    setLimitMessage(null);
    let projectId: string | null = null;
    try {
      if (beatMode === "upload" && !beatFile) throw new Error("Choose a beat file to upload");

      // Vague prompt + AI mode → ask for specificity instead of wasting a credit
      if (beatMode === "ai" && beatDurationSec > FREE_MAX_SEC) {
        // Soft client gate — server remains authoritative for free users
        setError(
          `Free beats are limited to ${FREE_MAX_SEC}s. Choose ${FREE_MAX_SEC}s or shorter, or upgrade for longer beats.`
        );
        setCreating(false);
        return;
      }

      if (beatMode === "ai") {
        const p = prompt.trim().toLowerCase();
        const vague =
          !p ||
          p.length < 12 ||
          /^(make|create|give|generate)\s+(me\s+)?(a\s+)?(beat|track|instrumental)/i.test(p);
        if (vague && !clarifyOpen && !energy && !instrumentation) {
          setClarifyOpen(true);
          setCreating(false);
          setError("Quick check — pick energy and instrumentation so AP can match what you hear.");
          return;
        }
        setClarifyOpen(true); // show advanced controls if not already
      }

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
          body: JSON.stringify({
            genre,
            mood,
            tempo,
            prompt: prompt.trim() || undefined,
            energy,
            instrumentation,
            referenceStyle: referenceStyle.trim() || undefined,
            duration_sec: beatDurationSec,
            kind: "full",
          }),
        });
        if (!beatRes.ok) {
          const j = await beatRes.json().catch(() => ({}));
          if (j.errorType === "LIMIT_EXCEEDED" || j.code === "BEAT_GEN_LIMIT") {
            setLimitMessage(
              typeof j.error === "string"
                ? j.error
                : "You've used your free beat generation. Subscribe or finish and download a song to unlock another."
            );
            throw new Error(typeof j.error === "string" ? j.error : "Beat generation limit reached");
          }
          throw new Error(
            (typeof j.error === "string" && j.error) || "Beat generation failed (not upload)"
          );
        }
      }

      // Plan build (separate from beat upload). Failure does not roll back the beat.
      const analyzeRes = await fetch(`/api/projects/${project.id}/analyze`, { method: "POST" });
      if (!analyzeRes.ok) {
        const j = await analyzeRes.json().catch(() => ({}));
        console.warn("analyze/plan", j);
        // Still open session — plan can be retried in Booth; do not treat as upload failure
      }

      if (startInConsole) {
        router.push(`/app/console/${project.id}`);
      } else {
        router.push(`/app/studio/${project.id}`);
      }
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


  const beats = projects.filter(
    (p) => p.has_beat || ["beat_ready", "analyzing", "blueprint_ready", "recording", "generating_beat"].includes(p.status)
  );

  async function ensureBeatUrl(projectId: string): Promise<string | null> {
    if (beatUrls[projectId]) return beatUrls[projectId];
    const res = await fetch(`/api/projects/${projectId}/beat`);
    if (!res.ok) return null;
    const j = await res.json();
    const url = typeof j.audio_url === "string" ? j.audio_url : null;
    if (url) setBeatUrls((prev) => ({ ...prev, [projectId]: url }));
    return url;
  }

  async function togglePlayBeat(projectId: string) {
    try {
      if (playingId === projectId && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setPlayingId(null);
        return;
      }
      setLoadingPlayId(projectId);
      const url = await ensureBeatUrl(projectId);
      setLoadingPlayId(null);
      if (!url) {
        setError("Could not load this beat for playback.");
        return;
      }
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.preload = "auto";
        audioRef.current.addEventListener("ended", () => setPlayingId(null));
        audioRef.current.addEventListener("pause", () => {
          if (audioRef.current && audioRef.current.paused) {
            /* keep playingId if seeking */
          }
        });
      }
      const a = audioRef.current;
      if (playingId && playingId !== projectId) {
        a.pause();
      }
      if (a.src !== url) {
        a.src = url;
      }
      await a.play();
      setPlayingId(projectId);
      setError(null);
    } catch (e) {
      setLoadingPlayId(null);
      setPlayingId(null);
      setError(e instanceof Error ? e.message : "Playback failed");
    }
  }

  async function downloadBeat(projectId: string, title: string) {
    try {
      setLoadingPlayId(projectId);
      const url = await ensureBeatUrl(projectId);
      setLoadingPlayId(null);
      if (!url) {
        setError("Could not get download link for this beat.");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "beat").replace(/[^\w\-]+/g, "-").slice(0, 48)}.mp3`;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setLoadingPlayId(null);
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function deleteBeatProject(projectId: string) {
    if (!confirm("Delete this beat and its session? This cannot be undone.")) return;
    setDeletingId(projectId);
    try {
      if (playingId === projectId && audioRef.current) {
        audioRef.current.pause();
        setPlayingId(null);
      }
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not delete");
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setBeatUrls((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }



  const chip = (on: boolean): CSSProperties => ({
    padding: "5px 10px",
    borderRadius: 999,
    border: on ? `1px solid ${C.brassLine}` : `1px solid ${C.border}`,
    background: on ? C.brassSoft : "transparent",
    color: on ? C.brass : C.textMuted,
    fontSize: 11.5,
    fontWeight: on ? 600 : 450,
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.2,
    whiteSpace: "nowrap" as const,
  });

  const panelTab = (on: boolean): CSSProperties => ({
    flex: 1,
    padding: "8px 6px",
    border: "none",
    borderBottom: on ? `2px solid ${C.brass}` : `2px solid transparent`,
    background: "transparent",
    color: on ? C.text : C.textFaint,
    fontSize: 12,
    fontWeight: on ? 650 : 500,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: 0.2,
  });

  const modeTab = (on: boolean): CSSProperties => ({
    flex: 1,
    padding: "8px 12px",
    borderRadius: 10,
    border: "none",
    background: on ? (C.brassSoft || "rgba(231,169,97,0.14)") : "transparent",
    color: on ? C.brass : C.textMuted,
    fontSize: 12.5,
    fontWeight: on ? 650 : 500,
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
        <h1 style={{ fontFamily: "Georgia, Fraunces, serif", fontSize: "clamp(1.5rem, 2.8vw, 2rem)", fontWeight: 500, margin: "0 0 6px", color: C.text }}>
          Create your beat
        </h1>
        <p style={{ color: C.textMuted, fontSize: 13.5, lineHeight: 1.45, margin: "0 0 18px", maxWidth: 480 }}>
          Prompt + a few controls — AP builds the instrumental.
        </p>

        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: "14px 14px 16px",
            maxWidth: 560,
          }}
        >
          {/* AI / Upload mode */}
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: 3,
              borderRadius: 12,
              background: C.bgDeep,
              marginBottom: 12,
            }}
          >
            <button type="button" style={modeTab(beatMode === "ai")} onClick={() => setBeatMode("ai")}>
              AI beat
            </button>
            <button type="button" style={modeTab(beatMode === "upload")} onClick={() => setBeatMode("upload")}>
              Upload
            </button>
          </div>

          {beatMode === "ai" ? (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                placeholder="Describe the beat — mood, story, texture…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 64,
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: C.bgDeep,
                  color: C.text,
                  padding: "10px 12px",
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  resize: "none",
                  lineHeight: 1.4,
                }}
              />

              {/* Selection summary */}
              <div
                style={{
                  marginTop: 10,
                  fontSize: 11.5,
                  color: C.textFaint,
                  lineHeight: 1.35,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px 8px",
                }}
              >
                <span style={{ color: C.textMuted }}>{genre}</span>
                <span>·</span>
                <span style={{ color: C.textMuted }}>{mood}</span>
                <span>·</span>
                <span style={{ color: C.textMuted }}>{energy}</span>
                <span>·</span>
                <span style={{ color: C.textMuted }}>{tempo} BPM</span>
                <span>·</span>
                <span style={{ color: C.brass || "#E7A961" }}>{beatDurationSec}s</span>
                {referenceStyle ? (
                  <>
                    <span>·</span>
                    <span style={{ color: C.textMuted }}>{referenceStyle}</span>
                  </>
                ) : null}
              </div>

              {/* Compact tabs */}
              <div
                style={{
                  display: "flex",
                  marginTop: 12,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {(
                  [
                    ["sound", "Sound"],
                    ["vibe", "Vibe"],
                    ["style", "Style"],
                    ["length", "Length"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" style={panelTab(createPanel === id)} onClick={() => setCreatePanel(id)}>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 12, minHeight: 120 }}>
                {createPanel === "sound" && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase" }}>
                      Genre
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 88, overflowY: "auto" }}>
                      {GENRES.map((g) => (
                        <button key={g} type="button" style={chip(genre === g)} onClick={() => setGenre(g)}>
                          {g}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, margin: "12px 0 6px", textTransform: "uppercase" }}>
                      Instrumentation
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 72, overflowY: "auto" }}>
                      {INSTRUMENTATION.map((ins) => (
                        <button key={ins} type="button" style={chip(instrumentation === ins)} onClick={() => setInstrumentation(ins)}>
                          {ins}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {createPanel === "vibe" && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase" }}>
                      Mood
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 72, overflowY: "auto" }}>
                      {MOODS.map((m) => (
                        <button key={m} type="button" style={chip(mood === m)} onClick={() => setMood(m)}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, margin: "12px 0 6px", textTransform: "uppercase" }}>
                      Energy
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {ENERGIES.map((e) => (
                        <button key={e} type="button" style={chip(energy === e)} onClick={() => setEnergy(e)}>
                          {e}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, margin: "12px 0 6px", textTransform: "uppercase" }}>
                      Tempo · {tempo} BPM
                    </div>
                    <input
                      type="range"
                      min={60}
                      max={160}
                      value={tempo}
                      onChange={(e) => setTempo(Number(e.target.value))}
                      aria-label="Tempo"
                      style={{ width: "100%", accentColor: C.brass }}
                    />
                  </>
                )}

                {createPanel === "style" && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase" }}>
                      Reference feel
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 88, overflowY: "auto" }}>
                      {STYLE_PRESETS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          style={chip(referenceStyle === s)}
                          onClick={() => setReferenceStyle(referenceStyle === s ? "" : s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={referenceStyle}
                      onChange={(e) => setReferenceStyle(e.target.value)}
                      placeholder="Or type any artist / era / vibe"
                      style={{
                        width: "100%",
                        marginTop: 10,
                        boxSizing: "border-box",
                        borderRadius: 10,
                        border: `1px solid ${C.border}`,
                        background: C.bgDeep,
                        color: C.text,
                        padding: "8px 10px",
                        fontSize: 12.5,
                        fontFamily: "inherit",
                      }}
                    />
                  </>
                )}

                {createPanel === "length" && (
                  <>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textFaint, letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" }}>
                      Duration · {beatDurationSec}s
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                      {LENGTH_PRESETS.map((s) => (
                        <button key={s} type="button" style={chip(beatDurationSec === s)} onClick={() => setBeatDurationSec(s)}>
                          {s}s
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={60}
                      step={5}
                      value={beatDurationSec}
                      onChange={(e) => setBeatDurationSec(Number(e.target.value))}
                      aria-label="Beat length"
                      style={{ width: "100%", accentColor: C.brass }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11.5, color: C.textFaint, lineHeight: 1.4 }}>
                      {beatDurationSec <= FREE_MAX_SEC ? (
                        <>
                          <span style={{ color: C.brass }}>Free tier</span>
                          {" · "}≤{FREE_MAX_SEC}s · {FREE_GEN_COUNT} gens · ~$
                          {(beatDurationSec * COST_PER_SEC_USD).toFixed(2)} if billed
                        </>
                      ) : (
                        <>
                          Above free length — shorten to {FREE_MAX_SEC}s or upgrade · ~$
                          {(beatDurationSec * COST_PER_SEC_USD).toFixed(2)}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0" }}>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setBeatFile(f);
                }}
              />
              <button
                type="button"
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.bgDeep,
                  color: C.text,
                  fontWeight: 550,
                  fontSize: 12.5,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onClick={() => fileRef.current?.click()}
              >
                {beatFile ? "Change file" : "Choose file"}
              </button>
              <span style={{ fontSize: 12.5, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis" }}>
                {beatFile ? beatFile.name : "WAV, MP3, M4A…"}
              </span>
            </div>
          )}

          {limitMessage && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${C.brass || "#E7A961"}`,
                background: "rgba(231,169,97,0.08)",
                fontSize: 12.5,
                lineHeight: 1.4,
                color: C.text,
              }}
            >
              <div style={{ fontWeight: 650, marginBottom: 4 }}>Beat limit</div>
              <div style={{ color: C.textMuted || C.text, marginBottom: 8 }}>{limitMessage}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <button type="button" onClick={() => router.push("/app?tab=library")} style={{ ...chip(false), borderColor: C.brass, color: C.brass, fontWeight: 650 }}>
                  Finish a song
                </button>
                <button type="button" onClick={() => router.push("/app?tab=profile")} style={{ ...chip(true), fontWeight: 650 }}>
                  Plans
                </button>
              </div>
            </div>
          )}
          {error && (
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(255,107,107,0.1)", color: "#ffb4b4", fontSize: 12.5 }}>
              {error}
            </div>
          )}

          <button
            type="button"
            style={{
              width: "100%",
              marginTop: 14,
              padding: "11px 16px",
              borderRadius: 12,
              border: "none",
              background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
              color: "#1A1208",
              fontWeight: 650,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: creating || (beatMode === "upload" && !beatFile) ? 0.55 : 1,
            }}
            disabled={creating || (beatMode === "upload" && !beatFile)}
            onClick={createAndGenerate}
          >
            {creating
              ? startInConsole
                ? "Building plan…"
                : beatMode === "upload"
                  ? "Analyzing beat…"
                  : "Creating beat…"
              : startInConsole
                ? beatMode === "upload"
                  ? "Start in Console"
                  : "Create & open Console"
                : beatMode === "upload"
                  ? "Start with my beat"
                  : "Create beat"}
          </button>
        </div>

        {!loading && beats.length > 0 && (
          <div style={{ marginTop: 28, maxWidth: 560 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 650,
                letterSpacing: 1.1,
                textTransform: "uppercase",
                color: C.textFaint,
                marginBottom: 10,
              }}
            >
              Your beats
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {beats.slice(0, 20).map((p) => {
                const isPlaying = playingId === p.id;
                const busy = loadingPlayId === p.id || deletingId === p.id;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: C.surface,
                      border: `1px solid ${isPlaying ? C.brassLine || C.brass : C.border}`,
                      color: C.text,
                    }}
                  >
                    <button
                      type="button"
                      aria-label={isPlaying ? "Pause beat" : "Play beat"}
                      disabled={busy}
                      onClick={() => togglePlayBeat(p.id)}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        border: "none",
                        flexShrink: 0,
                        cursor: busy ? "wait" : "pointer",
                        background: isPlaying
                          ? `linear-gradient(180deg, #F0BC80, ${C.brass})`
                          : C.bgDeep,
                        color: isPlaying ? "#1A1208" : C.brass,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 14,
                        fontWeight: 700,
                        fontFamily: "inherit",
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      {loadingPlayId === p.id ? "…" : isPlaying ? "❚❚" : "▶"}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                        {statusLabel(p.status)}
                        {[p.genre, p.mood].filter(Boolean).length
                          ? ` · ${[p.genre, p.mood].filter(Boolean).join(" · ")}`
                          : ""}
                        {isPlaying ? " · Playing" : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Download beat"
                      disabled={busy}
                      onClick={() => downloadBeat(p.id, p.title)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        background: "transparent",
                        color: C.textMuted,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: busy ? "wait" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      title="Delete beat"
                      disabled={busy}
                      onClick={() => deleteBeatProject(p.id)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        background: "transparent",
                        color: deletingId === p.id ? "#ff8a8a" : C.textFaint,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: busy ? "wait" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {deletingId === p.id ? "…" : "Delete"}
                    </button>
                  </div>
                );
              })}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.textFaint, lineHeight: 1.4 }}>
              Play stays on this page. Open a project from Library when you are ready to record or produce.
            </p>
          </div>
        )}

      </div>
    </AppShell>
  );
}

export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100dvh",
            display: "grid",
            placeItems: "center",
            background: "#0B0A0F",
            color: "#9B96A3",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Loading Studio…
        </div>
      }
    >
      <StudioPageInner />
    </Suspense>
  );
}

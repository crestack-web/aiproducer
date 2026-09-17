"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { analyzeAudioFile } from "@/lib/audio/beat-detect";
import { useTheme } from "@/lib/theme";
import { CoverArt } from "@/components/studio-player";

const GENRES = ["R&B", "Afrobeats", "Hip-Hop", "Pop", "Amapiano", "Gospel", "Highlife"];
const MOODS = ["Emotional", "Confident", "Dark", "Romantic", "Energetic", "Chill"];
const ENERGIES = ["Intimate", "Laid-back", "Driving", "Explosive"];
const INSTRUMENTATION = [
  "808-driven",
  "Heavy bass",
  "Acoustic guitar-led",
  "Keys / pad-led",
  "Live drums",
  "Sparse minimal",
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
  const [energy, setEnergy] = useState("Driving");
  const [instrumentation, setInstrumentation] = useState("808-driven");
  const [referenceStyle, setReferenceStyle] = useState("");
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
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
          Describe the sound, pick genre and mood, set tempo — then open Booth (guided) or Console (AI timeline). Same plan either way.
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
              background: C.bgDeep,
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

          {beatMode === "ai" && (
            <>
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Energy</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ENERGIES.map((e) => (
                    <button key={e} type="button" style={chip(energy === e)} onClick={() => setEnergy(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>Instrumentation</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {INSTRUMENTATION.map((ins) => (
                    <button key={ins} type="button" style={chip(instrumentation === ins)} onClick={() => setInstrumentation(ins)}>
                      {ins}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>
                  Style reference <span style={{ fontWeight: 500, opacity: 0.7 }}>(optional)</span>
                </div>
                <input
                  type="text"
                  value={referenceStyle}
                  onChange={(e) => setReferenceStyle(e.target.value)}
                  placeholder="e.g. early Wizkid · Tems · 2016 Drake feel"
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: C.bgDeep,
                    color: C.text,
                    padding: "12px 14px",
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </>
          )}


          {beatMode === "ai" && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textFaint, letterSpacing: 0.4, marginBottom: 8, textTransform: "uppercase" }}>
                Beat length · {beatDurationSec}s
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
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
                aria-label="Beat length seconds"
                style={{ width: "100%" }}
              />
              <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45, color: C.textMuted || C.textFaint }}>
                {beatDurationSec <= FREE_MAX_SEC ? (
                  <>
                    <span style={{ color: C.brass || "#E7A961", fontWeight: 600 }}>Covered on free tier</span>
                    {" · "}up to {FREE_GEN_COUNT} gens ≤{FREE_MAX_SEC}s · est. ~$
                    {(beatDurationSec * COST_PER_SEC_USD).toFixed(2)} if billed
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600 }}>Above free length ({FREE_MAX_SEC}s)</span>
                    {" · "}shorten to generate free, or upgrade · est. ~$
                    {(beatDurationSec * COST_PER_SEC_USD).toFixed(2)}
                  </>
                )}
              </div>
            </div>
          )}

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
                  background: C.surface,
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

          {limitMessage && (
            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 14,
                border: `1px solid ${C.brass || "#E7A961"}`,
                background: "rgba(231,169,97,0.08)",
                fontSize: 14,
                lineHeight: 1.45,
                color: C.text,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Beat generation limit</div>
              <div style={{ color: C.textMuted || C.text, marginBottom: 12 }}>{limitMessage}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => router.push("/app?tab=library")}
                  style={{
                    ...chip(false),
                    borderColor: C.brass || "#E7A961",
                    color: C.brass || "#E7A961",
                    fontWeight: 700,
                  }}
                >
                  Finish a song in Library
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/app?tab=profile")}
                  style={{
                    ...chip(true),
                    fontWeight: 700,
                  }}
                >
                  View plans
                </button>
              </div>
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
              ? startInConsole
                ? "Building plan…"
                : beatMode === "upload"
                  ? "Analyzing beat…"
                  : "Creating beat…"
              : startInConsole
                ? beatMode === "upload"
                  ? "Start in Console"
                  : "Create beat & open Console"
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
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      borderRadius: 14,
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      color: C.text,
                    }}
                  >
                    <CoverArt seed={p.id + (p.title || "")} size={48} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
                        {statusLabel(p.status)}
                        {[p.genre, p.mood].filter(Boolean).length ? ` · ${[p.genre, p.mood].filter(Boolean).join(" · ")}` : ""}
                      </div>
                    </div>
                    <Link href={`/app/studio/${p.id}`} style={{ color: C.brass, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>Booth</Link>
                    <Link href={`/app/console/${p.id}`} style={{ color: C.textMuted, fontSize: 12, fontWeight: 600, textDecoration: "none", marginLeft: 8 }}>Console</Link>
                  </div>
                );
              })}
            </div>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { waitForBeatReady } from "@/lib/studio/poll-beat-ready";
import { useTheme } from "@/lib/theme";

const GENRES = ["R&B", "Afrobeats", "Amapiano", "Hip-Hop", "Trap", "Pop", "Gospel"];
const MOODS = ["Emotional", "Confident", "Dark", "Romantic", "Energetic", "Chill"];

export default function StudioPage() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [genre, setGenre] = useState("R&B");
  const [mood, setMood] = useState("Emotional");
  const [tempo, setTempo] = useState(104);
  const [prompt, setPrompt] = useState("");
  const [beatDurationSec, setBeatDurationSec] = useState(90);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Artist");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/auth?mode=login");
        return;
      }
      setUserName(user.email?.split("@")[0] || "Artist");
    })();
  }, [router]);

  async function createAndGenerate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    setLimitMessage(null);
    let projectId: string | null = null;
    try {
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${mood} ${genre}`,
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

      const beatRes = await fetch(`/api/projects/${project.id}/generate-beat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre,
          mood,
          tempo,
          prompt: prompt.trim() || undefined,
          duration_sec: beatDurationSec,
          kind: "full",
        }),
      });
      const beatJson = await beatRes.json().catch(() => ({}));
      if (!beatRes.ok) {
        const msg =
          typeof beatJson.error === "string"
            ? beatJson.error
            : "Beat generation failed";
        if (beatJson.errorType === "LIMIT_EXCEEDED" || beatJson.code === "BEAT_GEN_LIMIT") {
          setLimitMessage(msg);
          setError(null);
        }
        throw new Error(msg);
      }

      await waitForBeatReady(project.id, beatJson as { status?: string; beat?: { audio_path?: string } | null });
      setReadyId(project.id);
      projectId = null;
      void fetch(`/api/projects/${project.id}/analyze`, { method: "POST" }).catch(() => undefined);
    } catch (e) {
      if (projectId) {
        try {
          await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
        } catch {
          /* ignore */
        }
      }
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  const panel = {
    marginTop: 12,
    padding: "12px 14px",
    borderRadius: 12,
    border: `1px solid ${C.brassLine || C.brass}`,
    background: C.modalSurface || C.surfaceRaised || "#16141C",
    color: C.text,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  } as const;

  return (
    <AppShell>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "16px 14px 40px", color: C.text }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px" }}>Studio</h1>
        <p style={{ margin: "0 0 16px", color: C.textMuted, fontSize: 13 }}>Hi {userName} — create a beat</p>

        <label style={{ fontSize: 12, color: C.textMuted }}>Genre</label>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          style={{ width: "100%", marginBottom: 10, padding: 10, borderRadius: 10, background: C.inputFill, color: C.text, border: `1px solid ${C.border}` }}
        >
          {GENRES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>

        <label style={{ fontSize: 12, color: C.textMuted }}>Mood</label>
        <select
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          style={{ width: "100%", marginBottom: 10, padding: 10, borderRadius: 10, background: C.inputFill, color: C.text, border: `1px solid ${C.border}` }}
        >
          {MOODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <label style={{ fontSize: 12, color: C.textMuted }}>Tempo: {tempo}</label>
        <input
          type="range"
          min={70}
          max={160}
          value={tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
          style={{ width: "100%", marginBottom: 10 }}
        />

        <label style={{ fontSize: 12, color: C.textMuted }}>Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Describe the beat you want…"
          style={{ width: "100%", marginBottom: 10, padding: 10, borderRadius: 10, background: C.inputFill, color: C.text, border: `1px solid ${C.border}`, fontFamily: "inherit" }}
        />

        <label style={{ fontSize: 12, color: C.textMuted }}>Length (sec)</label>
        <select
          value={beatDurationSec}
          onChange={(e) => setBeatDurationSec(Number(e.target.value))}
          style={{ width: "100%", marginBottom: 12, padding: 10, borderRadius: 10, background: C.inputFill, color: C.text, border: `1px solid ${C.border}` }}
        >
          {[60, 90, 120, 180].map((s) => (
            <option key={s} value={s}>{s}s</option>
          ))}
        </select>

        {limitMessage && (
          <div style={panel}>
            <div style={{ fontWeight: 650, marginBottom: 4 }}>Beat limit</div>
            <div style={{ color: C.textMuted, fontSize: 13 }}>{limitMessage}</div>
          </div>
        )}
        {error && (
          <div style={{ ...panel, borderColor: "rgba(255,107,107,0.45)", color: "#ffb4b4" }}>{error}</div>
        )}

        <button
          type="button"
          disabled={creating}
          onClick={() => void createAndGenerate()}
          style={{
            width: "100%",
            marginTop: 14,
            padding: "12px 16px",
            borderRadius: 12,
            border: "none",
            background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
            color: "#1A1208",
            fontWeight: 700,
            fontSize: 15,
            cursor: creating ? "wait" : "pointer",
            opacity: creating ? 0.7 : 1,
            fontFamily: "inherit",
          }}
        >
          {creating ? "Generating your beat…" : "Create beat"}
        </button>

        {readyId && (
          <div style={panel}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Beat ready</div>
            <button
              type="button"
              onClick={() => router.push(`/app/studio/${readyId}`)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "none",
                background: C.brass,
                color: "#1A1208",
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Open session
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

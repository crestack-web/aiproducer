"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import {
  useBeatAudio,
  BeatPreviewTransport,
  BeatPlayButton,
  BeatMoreButton,
  BeatActionsSheet,
} from "@/components/beat-preview-player";
import { analyzeAudioFile } from "@/lib/audio/beat-detect";
import { useTheme } from "@/lib/theme";
import { ApPaywall } from "@/components/ap-paywall";

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
const LENGTH_PRESETS = [15, 30, 60, 120, 180, 240] as const;
/** Estimated USD/sec — override via env on server; client mirror for preview. */
/** $1.00 per 2 minutes (120s) — scales with selected length */
const COST_PER_SEC_USD = 1 / 120;
function estimateStudioBeatCostUsd(sec: number): number {
  const s = Math.max(5, Math.min(240, Math.round(sec || 60)));
  return Math.max(0.25, Math.round(s * COST_PER_SEC_USD * 100) / 100);
}
const FREE_MAX_SEC = 180;
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
  beat_source?: string | null;
};

type ReadyBeat = {
  projectId: string;
  title: string;
  source: "ai" | "upload";
  genre?: string;
  mood?: string;
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
  const [readyBeat, setReadyBeat] = useState<ReadyBeat | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState("R&B");
  const [mood, setMood] = useState("Emotional");
  const [prompt, setPrompt] = useState("");
  const [tempo, setTempo] = useState(104);
  const [beatDurationSec, setBeatDurationSec] = useState(90);
  const [createPanel, setCreatePanel] = useState<"sound" | "vibe" | "style" | "length">("sound");
  const [energy, setEnergy] = useState("Driving");
  const [instrumentation, setInstrumentation] = useState("808-driven");
  const [referenceStyle, setReferenceStyle] = useState("");
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [upgradeModal, setUpgradeModal] = useState<{
    message: string;
    estimatedCostUsd?: number;
  } | null>(null);
  const [tweakSection, setTweakSection] = useState("chorus");
  const [tweakPrompt, setTweakPrompt] = useState("");
  const [tweaking, setTweaking] = useState(false);
  const [beatVersions, setBeatVersions] = useState<
    {
      id: string;
      audio_url: string | null;
      label: string;
      is_active?: boolean;
      edit_section?: string | null;
    }[]
  >([]);
  const [versionsProjectId, setVersionsProjectId] = useState<string | null>(null);
  const [selectingBeatId, setSelectingBeatId] = useState<string | null>(null);
  const [editGateModal, setEditGateModal] = useState(false);
  const [subscribePaywallOpen, setSubscribePaywallOpen] = useState(false);
  const [subscribePaywallProjectId, setSubscribePaywallProjectId] = useState<string | null>(null);
  const [isPaidPlan, setIsPaidPlan] = useState(false);



  const [beatMode, setBeatMode] = useState<"ai" | "upload">("ai");
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [beatMenuId, setBeatMenuId] = useState<string | null>(null);
  const beatAudio = useBeatAudio({ onError: (message) => setError(message) });
  const {
    playingId,
    loadingId: loadingPlayId,
    currentTime,
    duration,
    toggle: togglePlayBeat,
    seek,
    skip,
    stopIfPlaying,
    ensureUrl: ensureBeatUrl,
  } = beatAudio;
  const tempoLabel = tempo < 90 ? "Slow" : tempo < 125 ? "Medium" : "Fast";


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("subscription_plan, plan, metadata")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled || !profile) return;
        const plan = String(
          (profile as { subscription_plan?: string }).subscription_plan ||
            (profile as { plan?: string }).plan ||
            ""
        ).toLowerCase();
        const meta = (profile as { metadata?: Record<string, unknown> }).metadata;
        const mp =
          meta && typeof meta === "object"
            ? String(meta.plan || meta.subscription_plan || "").toLowerCase()
            : "";
        setIsPaidPlan(plan === "creator" || plan === "pro" || mp === "creator" || mp === "pro");
      } catch {
        /* stay free */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function loadBeatVersions(projectId: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/beats`);
      if (!res.ok) return;
      const j = await res.json();
      if (Array.isArray(j.beats)) {
        setBeatVersions(j.beats);
        setVersionsProjectId(projectId);
      }
    } catch {
      /* ignore */
    }
  }

  async function selectBeatVersion(projectId: string, beatId: string) {
    setSelectingBeatId(beatId);
    try {
      const res = await fetch(`/api/projects/${projectId}/beats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ select_beat_id: beatId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not select version");
      }
      await loadBeatVersions(projectId);
      // refresh signed URL for player
      void togglePlayBeat(projectId);
      stopIfPlaying(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Select failed");
    } finally {
      setSelectingBeatId(null);
    }
  }

  async function tweakReadyBeat() {
    if (!readyBeat?.projectId || !tweakPrompt.trim()) return;
    if (!isPaidPlan) {
      setEditGateModal(true);
      return;
    }
    setTweaking(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${readyBeat.projectId}/generate-beat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre,
          mood,
          tempo,
          prompt: tweakPrompt.trim(),
          energy,
          instrumentation,
          duration_sec: beatDurationSec,
          kind: "full",
          editSection: tweakSection,
          billable: true,
          forceBillable: true,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (j.details as { code?: string } | undefined)?.code;
        if (code === "BEAT_EDIT_PAID_ONLY") {
          setEditGateModal(true);
          return;
        }
        throw new Error(typeof j.error === "string" ? j.error : "Could not rework section");
      }
      await loadBeatVersions(readyBeat.projectId);
      stopIfPlaying(readyBeat.projectId);
      setTweakPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Section edit failed");
    } finally {
      setTweaking(false);
    }
  }

  async function createAndGenerate(opts?: { billable?: boolean }) {
    if (creating) return; // one generation at a time (client)
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
          `Free beats are limited to ${Math.round(FREE_MAX_SEC / 60)} minutes (${FREE_MAX_SEC}s). Choose ${FREE_MAX_SEC}s or shorter, or upgrade for longer beats.`
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
            billable: Boolean(opts?.billable),
            forceBillable: Boolean(opts?.billable),
          }),
        });
        if (!beatRes.ok) {
          const j = await beatRes.json().catch(() => ({}));
          if (j.errorType === "LIMIT_EXCEEDED" || j.code === "BEAT_GEN_LIMIT") {
            const details = (j.details || {}) as {
              code?: string;
              estimatedCostUsd?: number;
              canBillable?: boolean;
            };
            const msg =
              typeof j.error === "string"
                ? j.error
                : "Free beat limit — finish your current free beat, subscribe, or continue with a paid beat.";
            setLimitMessage(msg);
            if (details.code === "BEAT_GEN_IN_FLIGHT") {
              setLimitMessage(msg);
            } else if (
              details.code === "SEQUENTIAL_FREE_BLOCKED" ||
              details.code === "FREE_COUNT_EXCEEDED" ||
              details.canBillable
            ) {
              const cost =
                typeof details.estimatedCostUsd === "number"
                  ? details.estimatedCostUsd
                  : estimateStudioBeatCostUsd(beatDurationSec);
              setLimitMessage(msg);
              setUpgradeModal({
                message: msg,
                estimatedCostUsd: cost,
              });
            }
            throw new Error(msg);
          }
          throw new Error(
            (typeof j.error === "string" && j.error) || "Beat generation failed (not upload)"
          );
        }
      }

      // AI beats: build section plan in background. Uploaded beats never auto-plan —
      // artist chooses "Let AP Plan" or "Build from scratch" (or open Console with no plan).
      if (beatMode === "ai") {
        void fetch(`/api/projects/${project.id}/analyze`, { method: "POST" }).then(async (analyzeRes) => {
          if (!analyzeRes.ok) {
            const j = await analyzeRes.json().catch(() => ({}));
            console.warn("analyze/plan", j);
          }
        });
      } else {
        // Mark plan mode pending so Booth does not assume an AI blueprint exists
        void fetch(`/api/projects/${project.id}/plan`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_mode", mode: "scratch" }),
        }).catch(() => undefined);
      }

      const title =
        beatMode === "upload" && beatFile
          ? beatFile.name.replace(/\.[^.]+$/, "")
          : `${mood} ${genre}`;
      const source: "ai" | "upload" = beatMode === "upload" ? "upload" : "ai";

      // Stay on Studio — show player + CTAs (do not auto-jump to plan/booth)
      void loadBeatVersions(project.id);
        setReadyBeat({
        projectId: project.id,
        title,
        source,
        genre,
        mood,
      });
      projectId = null; // prevent discard on success path

      // Refresh list so Your beats updates
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const json = await res.json();
          setProjects((json.projects || []).filter((x: Project) => x.status !== "draft"));
        }
      } catch {
        /* ignore */
      }

      // Auto-load preview in player
      void togglePlayBeat(project.id);
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

  async function downloadBeat(projectId: string, title: string) {
    try {
      // Same-origin attachment stream — avoids signed URL opening in-browser player
      const res = await fetch(`/api/projects/${projectId}/beat/download`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not download beat");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/i.exec(cd);
      const filename =
        match?.[1] ||
        `${(title || "beat").replace(/[^\w\-]+/g, "-").slice(0, 48)}.mp3`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  }

  async function deleteBeatProject(projectId: string) {
    if (!confirm("Delete this beat and its session? This cannot be undone.")) return;
    setDeletingId(projectId);
    try {
      stopIfPlaying(projectId);
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not delete");
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
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
          maxWidth: 720,
          margin: "0 auto",
          padding: "28px 20px 40px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 2, color: C.brass, marginBottom: 10 }}>
          ◆ STUDIO
        </div>
        <h1 style={{ fontFamily: "Georgia, Fraunces, serif", fontSize: "clamp(1.5rem, 2.8vw, 2rem)", fontWeight: 500, margin: "0 0 6px", color: C.text }}>
          Create your beat
        </h1>
        <p style={{ color: C.textMuted, fontSize: 13.5, lineHeight: 1.45, margin: "0 0 18px", maxWidth: "100%" }}>
          Prompt + a few controls — AP builds the instrumental.
        </p>

        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: "16px 16px 18px",
            margin: "0 auto",
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
              AP beat
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
                      max={240}
                      step={5}
                      value={beatDurationSec}
                      onChange={(e) => setBeatDurationSec(Number(e.target.value))}
                      aria-label="Beat length"
                      style={{ width: "100%", accentColor: C.brass }}
                    />
                    <div style={{ marginTop: 8, fontSize: 11.5, color: C.textFaint, lineHeight: 1.4 }}>
                      {beatDurationSec <= FREE_MAX_SEC ? (
                        <>
                          <span style={{ color: C.brass }}>Free · up to {Math.max(1, Math.round(FREE_MAX_SEC / 60))} min</span>
                          {" · "}
                          Est. cost ~${estimateStudioBeatCostUsd(beatDurationSec).toFixed(2)}
                          {" · "}AP covers {FREE_GEN_COUNT} gens
                        </>
                      ) : (
                        <>
                          Above free {Math.max(1, Math.round(FREE_MAX_SEC / 60))} min — shorten or upgrade · Est. ~$
                          {estimateStudioBeatCostUsd(beatDurationSec).toFixed(2)}
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
                <button
                  type="button"
                  onClick={() =>
                    setUpgradeModal({
                      message: limitMessage,
                      estimatedCostUsd: estimateStudioBeatCostUsd(beatDurationSec),
                    })
                  }
                  style={{ ...chip(false), borderColor: C.brass, color: C.brass, fontWeight: 650 }}
                >
                  Options
                </button>
                <button type="button" onClick={() => router.push("/app?tab=library")} style={{ ...chip(false), fontWeight: 650 }}>
                  Finish current song
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

          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${C.brassLine || C.brass}`,
              background: "rgba(231,169,97,0.08)",
              fontSize: 12,
              lineHeight: 1.45,
              color: C.textMuted,
            }}
          >
            <div style={{ fontWeight: 700, color: C.brass, marginBottom: 4, fontSize: 11, letterSpacing: 0.04, textTransform: "uppercase" }}>
              Free AP beats
            </div>
            We cover <strong style={{ color: C.text }}>{FREE_GEN_COUNT} free beats</strong> — one at a time; next unlocks after you download a produced song (up to{" "}
            <strong style={{ color: C.text }}>{Math.max(1, Math.round(FREE_MAX_SEC / 60))} minutes</strong> each).
            Generate one at a time — the next free beat unlocks after you{" "}
            <strong style={{ color: C.text }}>record and Produce</strong> the current one.
            After all {FREE_GEN_COUNT} free beats, AP still generates; the{" "}
            <strong style={{ color: C.text }}>beat cost is added to your song download</strong> after Produce.
            <div style={{ marginTop: 6, color: C.text }}>
              This length (~{beatDurationSec}s) estimates{" "}
              <strong>~${estimateStudioBeatCostUsd(beatDurationSec).toFixed(2)}</strong>
              {beatDurationSec <= FREE_MAX_SEC
                ? " — free while sequential free slots remain"
                : " — above free length; upgrade or shorten"}
              .
            </div>
          </div>

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
            onClick={() => void createAndGenerate()}
          >
            {creating
              ? beatMode === "upload"
                ? "Uploading & analyzing…"
                : "Generating your beat…"
              : beatMode === "upload"
                ? "Upload & preview beat"
                : "Create beat"}
          </button>
        </div>

        {readyBeat && (
          <div
            style={{
              marginTop: 20,
              width: "100%",
              padding: 16,
              borderRadius: 16,
              border: `1px solid ${C.brassLine || C.brass}`,
              background: C.surface,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: C.brass, textTransform: "uppercase" }}>
                Your beat is ready
              </div>
              {readyBeat.source === "ai" ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 0.06,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(231,169,97,0.18)",
                    color: C.brass,
                    border: `1px solid ${C.brassLine || C.brass}`,
                  }}
                  title="Generated by AP"
                >
                  AP
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.06)",
                    color: C.textMuted,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  Uploaded
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <BeatPlayButton
                isPlaying={playingId === readyBeat.projectId}
                loading={loadingPlayId === readyBeat.projectId}
                onClick={() => void togglePlayBeat(readyBeat.projectId)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {readyBeat.title}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                  {[readyBeat.genre, readyBeat.mood].filter(Boolean).join(" · ") || "Instrumental"}
                  {playingId === readyBeat.projectId ? " · Playing" : " · Tap play to listen"}
                </div>
              </div>
            </div>
            <BeatPreviewTransport
              active={playingId === readyBeat.projectId}
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
              onSkip={skip}
            />

            {readyBeat.source === "upload" ? (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: C.brass, letterSpacing: 0.04, marginBottom: 6 }}>
                YOUR UPLOADED BEAT
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: C.textMuted, lineHeight: 1.45 }}>
                This is your instrumental — not an AP-generated beat. Choose how you want to record on it,
                or open Console and import vocals with no plan.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => router.push(`/app/studio/${readyBeat.projectId}?plan=ai`)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "none",
                    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                    color: "#1A1208",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  Let AP Plan
                  <span style={{ display: "block", fontWeight: 500, fontSize: 11, opacity: 0.85, marginTop: 2 }}>
                    AP listens to your beat and builds a recording plan
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/app/studio/${readyBeat.projectId}?plan=scratch`)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: "transparent",
                    color: C.text,
                    fontWeight: 650,
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  Build from Scratch
                  <span style={{ display: "block", fontWeight: 500, fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    Choose your own sections and what to record
                  </span>
                </button>
              </div>
            </div>
            ) : (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: C.brass, letterSpacing: 0.04, marginBottom: 8 }}>
                AI EDIT SECTION{isPaidPlan ? "" : " · Creator / Pro"}
              </div>
              {!isPaidPlan && (
                <p style={{ margin: "0 0 8px", fontSize: 12, color: C.textMuted, lineHeight: 1.4 }}>
                  Section reworks are on paid plans. Keep this beat, or subscribe to edit intro / verse / chorus.
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {(["intro", "verse", "chorus", "bridge", "outro"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTweakSection(s)}
                    style={{
                      ...chip(tweakSection === s),
                      textTransform: "capitalize",
                      fontSize: 11,
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                value={tweakPrompt}
                onChange={(e) => setTweakPrompt(e.target.value)}
                placeholder="e.g. bigger drums, softer keys, more space for vocals"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: C.bgDeep || "transparent",
                  color: C.text,
                  fontSize: 13,
                  fontFamily: "inherit",
                  marginBottom: 8,
                }}
              />
              <button
                type="button"
                disabled={tweaking || (isPaidPlan && !tweakPrompt.trim())}
                onClick={() => {
                  if (!isPaidPlan) {
                    // Open subscription paywall (not a dead-end profile redirect only)
                    if (readyBeat?.projectId) {
                      setSubscribePaywallProjectId(readyBeat.projectId);
                      setSubscribePaywallOpen(true);
                    } else {
                      setEditGateModal(true);
                    }
                    return;
                  }
                  void tweakReadyBeat();
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                  color: "#1A1208",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: tweaking ? "wait" : "pointer",
                  fontFamily: "inherit",
                  opacity: tweaking || (isPaidPlan && !tweakPrompt.trim()) ? 0.55 : 1,
                }}
              >
                {tweaking
                  ? "Reworking section…"
                  : isPaidPlan
                    ? `Rework ${tweakSection} with AI`
                    : "Unlock section editing"}
              </button>
            </div>


            )}

            {beatVersions.length > 1 && versionsProjectId === readyBeat.projectId && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.brass, letterSpacing: 0.04, marginBottom: 8 }}>
                  BEAT VERSIONS — pick the one you want
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {beatVersions.map((v) => (
                    <div
                      key={v.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${v.is_active ? C.brass : C.border}`,
                        background: v.is_active ? "rgba(231,169,97,0.1)" : "transparent",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 650, color: C.text }}>{v.label}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>
                          {v.is_active ? "Active for Booth / Console" : "Tap Use to make active"}
                        </div>
                      </div>
                      {!v.is_active && (
                        <button
                          type="button"
                          disabled={selectingBeatId === v.id}
                          onClick={() => void selectBeatVersion(readyBeat.projectId, v.id)}
                          style={{
                            ...chip(false),
                            borderColor: C.brass,
                            color: C.brass,
                            fontWeight: 700,
                            fontSize: 11,
                          }}
                        >
                          {selectingBeatId === v.id ? "…" : "Use"}
                        </button>
                      )}
                      {v.is_active && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.brass }}>Active</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 14,
              }}
            >
              <button
                type="button"
                onClick={() => router.push(`/app/studio/${readyBeat.projectId}`)}
                style={{
                  flex: "1 1 120px",
                  padding: "11px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                  color: "#1A1208",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Open Booth
              </button>
              <button
                type="button"
                onClick={() => router.push(`/app/console/${readyBeat.projectId}`)}
                style={{
                  flex: "1 1 120px",
                  padding: "11px 14px",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "transparent",
                  color: C.text,
                  fontWeight: 650,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Open Console
              </button>
              <button
                type="button"
                onClick={() => void downloadBeat(readyBeat.projectId, readyBeat.title)}
                style={{
                  flex: "1 1 100px",
                  padding: "11px 14px",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "transparent",
                  color: C.brass,
                  fontWeight: 650,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Download
              </button>
              <button
                type="button"
                onClick={() => {
                  setReadyBeat(null);
                  stopIfPlaying(readyBeat.projectId);
                }}
                style={{
                  flex: "1 1 100px",
                  padding: "11px 14px",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "transparent",
                  color: C.textMuted,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Create another
              </button>
            </div>
          </div>
        )}

        {!loading && beats.length > 0 && (
          <div style={{ marginTop: 28, width: "100%" }}>
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
                      flexDirection: "column",
                      gap: 0,
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: C.surface,
                      border: `1px solid ${isPlaying ? C.brassLine || C.brass : C.border}`,
                      color: C.text,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <BeatPlayButton
                        isPlaying={isPlaying}
                        loading={loadingPlayId === p.id}
                        disabled={busy && loadingPlayId !== p.id}
                        onClick={() => void togglePlayBeat(p.id)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13.5,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.title}
                          </span>
                          {p.beat_source === "ai" && (
                            <span
                              style={{
                                flexShrink: 0,
                                fontSize: 9,
                                fontWeight: 800,
                                letterSpacing: 0.04,
                                padding: "2px 6px",
                                borderRadius: 999,
                                background: "rgba(231,169,97,0.16)",
                                color: C.brass,
                                border: `1px solid ${C.brassLine || C.brass}`,
                              }}
                            >
                              AP
                            </span>
                          )}
                          {p.beat_source === "upload" && (
                            <span
                              style={{
                                flexShrink: 0,
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 999,
                                background: "rgba(255,255,255,0.06)",
                                color: C.textMuted,
                                border: `1px solid ${C.border}`,
                              }}
                            >
                              Upload
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                          {statusLabel(p.status)}
                          {[p.genre, p.mood].filter(Boolean).length
                            ? ` · ${[p.genre, p.mood].filter(Boolean).join(" · ")}`
                            : ""}
                          {isPlaying ? " · Playing" : ""}
                        </div>
                      </div>
                      <BeatMoreButton
                        active={beatMenuId === p.id}
                        onClick={() => { setBeatMenuId(p.id); void loadBeatVersions(p.id); }}
                      />
                    </div>
                    <BeatPreviewTransport
                      active={isPlaying}
                      currentTime={currentTime}
                      duration={duration}
                      onSeek={seek}
                      onSkip={skip}
                      disabled={busy}
                    />
                  </div>
                );
              })}
            </div>
            
      
            {versionsProjectId && beatVersions.length > 1 && beats.some((b) => b.id === versionsProjectId) && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: "rgba(0,0,0,0.15)",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                  Versions for this beat — choose one
                </div>
                {beatVersions.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{v.label}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>
                        {v.is_active ? "Currently active" : "Alternate take"}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={v.is_active || selectingBeatId === v.id}
                      onClick={() => void selectBeatVersion(versionsProjectId, v.id)}
                      style={{
                        ...chip(Boolean(v.is_active)),
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {v.is_active ? "Active" : selectingBeatId === v.id ? "…" : "Use this"}
                    </button>
                  </div>
                ))}
              </div>
            )}


      {editGateModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 92,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setEditGateModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: "18px 18px 0 0",
              background: C.surface || "#16140f",
              border: `1px solid ${C.border}`,
              padding: "18px 16px 28px",
              color: C.text,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>AI beat editing</div>
            <p style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.5, color: C.textMuted }}>
              Reworking intro, verse, chorus, and other sections is included on{" "}
              <strong style={{ color: C.text }}>Creator</strong> and{" "}
              <strong style={{ color: C.text }}>Pro</strong>. You can keep the single unedited beat you already generated and continue to record.
            </p>
            <button
              type="button"
              onClick={() => {
                setEditGateModal(false);
                if (readyBeat?.projectId) {
                  setSubscribePaywallProjectId(readyBeat.projectId);
                  setSubscribePaywallOpen(true);
                } else {
                  router.push("/app?tab=profile");
                }
              }}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "none",
                background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                color: "#1A1208",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: 8,
              }}
            >
              View subscription plans
            </button>
            <button
              type="button"
              onClick={() => {
                setEditGateModal(false);
                setTweakPrompt("");
              }}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${C.brass}`,
                background: "transparent",
                color: C.brass,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: 8,
              }}
            >
              Keep this beat unedited
            </button>
            <button
              type="button"
              onClick={() => setEditGateModal(false)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "transparent",
                color: C.textMuted,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}


      {subscribePaywallOpen ? (
        <ApPaywall
          open={subscribePaywallOpen}
          onClose={() => {
            setSubscribePaywallOpen(false);
            setSubscribePaywallProjectId(null);
          }}
          projectId={subscribePaywallProjectId}
          songTitle={readyBeat?.title || "Your song"}
          onUnlocked={() => {
            setSubscribePaywallOpen(false);
            setSubscribePaywallProjectId(null);
            // Refresh plan flags after checkout return
            try {
              window.location.reload();
            } catch {
              /* ignore */
            }
          }}
          colors={{
            text: C.text,
            textMuted: C.textMuted,
            surface: C.surface || "#16140f",
            border: C.border,
            accent: C.brass,
            bg: C.bg,
          }}
        />
      ) : null}

{upgradeModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={() => setUpgradeModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: "18px 18px 0 0",
              background: C.surface || "#16140f",
              border: `1px solid ${C.border}`,
              padding: "18px 16px 28px",
              color: C.text,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Free beat locked — paid path</div>
            <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.5, color: C.textMuted }}>
              {upgradeModal.message}
            </p>
            <div
              style={{
                margin: "0 0 14px",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${C.brass}`,
                background: "rgba(231,169,97,0.1)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: C.brass, marginBottom: 4 }}>
                Paid beat price
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>
                $
                {(upgradeModal.estimatedCostUsd ?? estimateStudioBeatCostUsd(beatDurationSec)).toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                Based on your selected length ({beatDurationSec}s). Pricing:{" "}
                <strong style={{ color: C.text }}>$1.00 for 2 minutes</strong>
                {" "}(30s ≈ $0.25 · 1 min ≈ $0.50 · 3 min ≈ $1.50).
                Charged when you download the produced song.
              </div>
            </div>
            <button
              type="button"
              disabled={creating}
              onClick={() => {
                setUpgradeModal(null);
                setLimitMessage(null);
                void createAndGenerate({ billable: true });
              }}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "none",
                background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                color: "#1A1208",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: 8,
              }}
            >
              {`Generate paid beat · $${(upgradeModal.estimatedCostUsd ?? estimateStudioBeatCostUsd(beatDurationSec)).toFixed(2)}`}
            </button>
            <button
              type="button"
              onClick={() => {
                setUpgradeModal(null);
                const projectId = projects[0]?.id ?? null;
                setSubscribePaywallProjectId(projectId);
                setSubscribePaywallOpen(true);
              }}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${C.brass}`,
                background: "transparent",
                color: C.brass,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                marginBottom: 8,
              }}
            >
              Subscribe to monthly plans
            </button>
            <button
              type="button"
              onClick={() => setUpgradeModal(null)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1px solid ${C.border}`,
                background: "transparent",
                color: C.textMuted,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
<BeatActionsSheet
              open={Boolean(beatMenuId)}
              title={beats.find((b) => b.id === beatMenuId)?.title || "Beat"}
              subtitle={(() => {
                const b = beats.find((x) => x.id === beatMenuId);
                if (!b) return undefined;
                return [statusLabel(b.status), b.genre, b.mood].filter(Boolean).join(" · ");
              })()}
              onClose={() => setBeatMenuId(null)}
              items={
                beatMenuId
                  ? [
                      {
                        key: "booth",
                        label: "Open Booth",
                        onClick: () => router.push(`/app/studio/${beatMenuId}`),
                      },
                      {
                        key: "console",
                        label: "Open Console",
                        onClick: () => router.push(`/app/console/${beatMenuId}`),
                      },
                      {
                        key: "download",
                        label: "Download beat",
                        onClick: () => void downloadBeat(beatMenuId, beats.find((b) => b.id === beatMenuId)?.title || "beat"),
                      },
                      {
                        key: "delete",
                        label: deletingId === beatMenuId ? "Deleting…" : "Delete",
                        danger: true,
                        disabled: deletingId === beatMenuId,
                        onClick: () => void deleteBeatProject(beatMenuId),
                      },
                    ]
                  : []
              }
            />
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

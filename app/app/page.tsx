"use client";

import React, { useEffect, useState, Suspense } from "react";
import {
  useBeatAudio,
  BeatPreviewTransport,
  BeatPlayButton,
  BeatMoreButton,
  BeatActionsSheet,
  LibraryMiniPlayer,
  formatAudioTime,
} from "@/components/beat-preview-player";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useTheme } from "@/lib/theme";
import { CoverArt } from "@/components/studio-player";
import { forceDownloadFromApi } from "@/lib/download-audio";
import { ApPaywall } from "@/components/ap-paywall";

type MasterVersion = {
  job_id: string;
  version: number;
  audio_path: string;
  completed_at: string | null;
  engine_version: string | null;
};

type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
  has_master?: boolean;
  has_beat?: boolean;
  beat_source?: string | null;
  masters?: MasterVersion[];
  master_count?: number;
};
type Tab = "home" | "library" | "profile";

function AppInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { colors: C } = useTheme();
  const [userName, setUserName] = useState("Artist");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userGenre, setUserGenre] = useState<string | null>(null);
  const [userPlan, setUserPlan] = useState<string | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/metrics");
        if (!cancelled) setIsAdmin(res.ok);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [libraryTab, setLibraryTab] = useState<"songs" | "beats" | "recordings">("songs");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadModal, setDownloadModal] = useState<{ id: string; title: string; jobId?: string; version?: number } | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallProject, setPaywallProject] = useState<{ id: string; title: string; jobId?: string; version?: number } | null>(null);
  const [beatPlayError, setBeatPlayError] = useState<string | null>(null);
  const [beatMenu, setBeatMenu] = useState<{ id: string; title: string; meta: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    id: string;
    title: string;
    meta: string;
    isReady: boolean;
    jobId?: string;
    version?: number;
  } | null>(null);
  const beatAudio = useBeatAudio({
    onError: (message) => setBeatPlayError(message),
  });
  const {
    playingId,
    activeId,
    isPlaying: audioIsPlaying,
    trackMeta,
    loadingId: loadingPlayId,
    currentTime,
    duration,
    toggle: togglePlayBeat,
    toggleMaster: togglePlayMaster,
    pause: pauseAudio,
    resume: resumeAudio,
    seek,
    skip,
    stop,
    stopIfPlaying,
    ensureUrl: ensureBeatUrl,
  } = beatAudio;

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "library" || t === "profile" || t === "home") setTab(t);
    if (t === "create" || t === "studio") router.replace("/app/studio");
    if (searchParams.get("tour") === "1") {
      window.dispatchEvent(new Event("studio-tour-start"));
      router.replace(t ? `/app?tab=${t}` : "/app");
    }
  }, [searchParams, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== "library" || libraryTab !== "beats") {
      stop();
      setBeatMenu(null);
    }
  }, [tab, libraryTab, stop]);

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
        .select("display_name, genre, metadata")
        .eq("id", user.id)
        .maybeSingle();
      const name =
        (profile as { display_name?: string } | null)?.display_name ||
        user.email?.split("@")[0] ||
        "Artist";
      setUserName(name);
      setUserEmail(user.email || null);
      setUserGenre(((profile as { genre?: string | null } | null)?.genre as string) || null);
      const meta = ((profile as { metadata?: Record<string, unknown> } | null)?.metadata ||
        {}) as Record<string, unknown>;
      const plan =
        (typeof meta.subscription_plan === "string" && meta.subscription_plan) ||
        (typeof meta.plan === "string" && meta.plan) ||
        null;
      setUserPlan(plan ? String(plan) : "Free");
      setEditName(name);
      setEditGenre(((profile as { genre?: string | null } | null)?.genre as string) || "");
      const res = await fetch("/api/projects");
      if (res.ok) {
        const json = await res.json();
        setProjects((json.projects || []).filter((p: Project) => p.status !== "draft"));
      }
      setLoading(false);
    })();
  }, [router]);

  function isFinishedSong(p: Project) {
    if (p.has_master) return true;
    const s = (p.status || "").toLowerCase();
    return s === "complete" || s === "completed" || s === "produced" || s === "done";
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }

  async function saveProfile() {
    if (profileSaving) return;
    const name = editName.trim();
    if (!name) {
      setProfileMsg("Display name is required");
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name,
          genre: editGenre.trim() || null,
        })
        .eq("id", user.id);
      if (error) throw new Error(error.message || "Could not save");
      setUserName(name);
      setUserGenre(editGenre.trim() || null);
      setEditProfileOpen(false);
      setProfileMsg("Profile updated");
      setTimeout(() => setProfileMsg(null), 2500);
    } catch (e) {
      setProfileMsg(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function deleteProject(projectId: string, title: string) {
    if (deletingId) return;
    const ok = window.confirm(`Delete “${title || "this project"}”? This cannot be undone.`);
    if (!ok) return;
    setDeletingId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not delete");
      }
      stopIfPlaying(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function downloadBeatFile(projectId: string, title: string) {
    try {
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
      setBeatPlayError(null);
    } catch (e) {
      setBeatPlayError(e instanceof Error ? e.message : "Download failed");
    }
  }

  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 14,
    background: C.surface,
    border: `1px solid ${C.border}`,
    textDecoration: "none",
    color: C.text,
    minWidth: 0,
    overflow: "hidden",
  };
  const rowBody: React.CSSProperties = { flex: 1, minWidth: 0, overflow: "hidden" };
  const rowTitle: React.CSSProperties = {
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const rowMeta: React.CSSProperties = {
    fontSize: 12.5,
    color: C.textMuted,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const rowAction: React.CSSProperties = { color: C.brass, fontSize: 13, fontWeight: 600, flexShrink: 0 };

  const eyebrow: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    letterSpacing: 2.5,
    color: C.brass,
    marginBottom: 12,
  };
  const h1: React.CSSProperties = {
    fontFamily: "Georgia, serif",
    fontSize: "clamp(1.85rem, 4vw, 2.75rem)",
    lineHeight: 1.08,
    fontWeight: 500,
    margin: 0,
    color: C.text,
  };
  const sub: React.CSSProperties = {
    fontSize: 15.5,
    color: C.textMuted,
    marginTop: 14,
    lineHeight: 1.55,
    maxWidth: 440,
  };
  const primary: React.CSSProperties = {
    padding: "14px 20px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const secondary: React.CSSProperties = {
    padding: "13px 18px",
    borderRadius: 14,
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
    fontWeight: 500,
    fontSize: 14.5,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const avatar: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 999,
    background: `linear-gradient(145deg, ${C.brass}, #6B3F17)`,
    color: "#1A1208",
    display: "grid",
    placeItems: "center",
    fontFamily: "Georgia, serif",
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  };

  const ctaBtn: React.CSSProperties = {
    ...primary,
    display: "inline-block",
    textDecoration: "none",
  };


  function openDownloadPaywall(projectId: string, title: string, opts?: { jobId?: string; version?: number }) {
    setDownloadModal(null);
    setPaywallProject({ id: projectId, title, jobId: opts?.jobId, version: opts?.version });
    setPaywallOpen(true);
  }

  function handleDownloadResult(
    result: { ok: true } | { ok: false; error: string; code?: string },
    projectId: string,
    title: string,
    opts?: { jobId?: string; version?: number }
  ) {
    if (result.ok) {
      setDownloadModal(null);
      return;
    }
    if (result.code === "PAYWALL" || result.code === "PAYMENT_REQUIRED") {
      openDownloadPaywall(projectId, title, opts);
      return;
    }
    window.alert(result.error);
  }

  async function runDownload(
    projectId: string,
    title: string,
    format: "wav" | "mp3",
    opts?: { jobId?: string; version?: number }
  ) {
    setDownloadBusy(true);
    const result = await forceDownloadFromApi(
      projectId,
      format,
      `${title || "song"}.${format}`,
      opts
    );
    setDownloadBusy(false);
    handleDownloadResult(result, projectId, title, opts);
  }

  function IconBtn({
    label,
    onClick,
    children,
    danger,
  }: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    danger?: boolean;
  }) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: `1px solid ${C.border}`,
          background: C.surface,
          color: danger ? "#E07070" : C.brass,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
      >
        {children}
      </button>
    );
  }

  function SongVersionRow({
    projectId,
    title,
    meta,
    jobId,
    version,
    isReady,
  }: {
    projectId: string;
    title: string;
    meta: string;
    jobId?: string;
    version: number;
    isReady: boolean;
  }) {
    const playId = `master:${projectId}:${jobId || `v${version}`}`;
    const isActive = activeId === playId;
    const isPlaying = isActive && audioIsPlaying;
    const busy = loadingPlayId === playId || deletingId === projectId;
    return (
      <div style={{ ...rowStyle, gap: 10 }}>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={!isReady || busy}
          onClick={() => {
            if (!isReady) return;
            void togglePlayMaster(playId, projectId, {
              ...(jobId ? { jobId } : { version }),
              title,
              subtitle: meta,
              seed: title || projectId,
            });
          }}
          style={{
            position: "relative",
            width: 52,
            height: 52,
            borderRadius: 12,
            border: "none",
            padding: 0,
            flexShrink: 0,
            cursor: !isReady || busy ? "default" : "pointer",
            overflow: "hidden",
            background: "transparent",
          }}
        >
          <CoverArt seed={title || projectId} size={52} />
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: isPlaying
                ? "rgba(0,0,0,0.35)"
                : "rgba(0,0,0,0.25)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {loadingPlayId === playId ? "…" : isPlaying ? "❚❚" : "▶"}
          </span>
        </button>
        <Link
          href={`/app/studio/${projectId}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={rowBody}>
            <div style={{ ...rowTitle, color: isActive ? C.brass : C.text }}>{title}</div>
            <div style={rowMeta}>
              {meta}
              {isPlaying ? " · Playing" : isActive ? " · Paused" : ""}
            </div>
          </div>
        </Link>
        {isReady && (
          <IconBtn
            label="Download this version"
            onClick={() => {
              const opts = jobId ? { jobId } : { version };
              void forceDownloadFromApi(
                projectId,
                "wav",
                `${title.replace(/[^a-zA-Z0-9._-]+/g, "_")}.wav`,
                opts
              ).then((r) => handleDownloadResult(r, projectId, title, opts));
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12" />
              <path d="M8 11l4 4 4-4" />
              <path d="M5 21h14" />
            </svg>
          </IconBtn>
        )}
        <BeatMoreButton
          active={projectMenu?.id === projectId && projectMenu?.meta === meta}
          onClick={() =>
            setProjectMenu({
              id: projectId,
              title,
              meta,
              isReady,
              jobId,
              version,
            })
          }
        />
      </div>
    );
  }

  function ProjectRow({ p, meta }: { p: Project; meta: string }) {
    const isReady = isFinishedSong(p);
    return (
      <div style={rowStyle}>
        <Link
          href={`/app/studio/${p.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <CoverArt seed={p.title || p.id} size={48} />
          <div style={rowBody}>
            <div style={rowTitle}>{p.title}</div>
            <div style={rowMeta}>{meta}</div>
          </div>
        </Link>
        <BeatMoreButton
          active={projectMenu?.id === p.id}
          onClick={() =>
            setProjectMenu({
              id: p.id,
              title: p.title,
              meta,
              isReady,
            })
          }
        />
      </div>
    );
  }

  const activeNav = tab === "library" ? "library" : tab === "profile" ? "profile" : "home";

  return (
    <AppShell active={activeNav} userName={userName} onSignOut={signOut}>
<div
        className="dash-content"
        style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 40px", boxSizing: "border-box", width: "100%" }}
      >
        <style>{`
          @media (min-width: 900px) {
            .dash-content { padding: 32px 8px 56px !important; }
            .dash-project-grid { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 18px !important; }
          }
          @media (min-width: 1200px) {
            .dash-content { max-width: 1200px !important; padding: 36px 12px 64px !important; }
            .dash-project-grid { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          }
        `}</style>

        {tab === "home" && (
          <>
            <div style={eyebrow}>◆ HOME</div>
            <h1 style={h1}>
              {userName && userName !== "Artist" ? (
                <>
                  Welcome back,
                  <br />
                  <span style={{ fontStyle: "italic", fontWeight: 400 }}>{userName}</span>
                </>
              ) : (
                <>Welcome back</>
              )}
            </h1>
            <p style={sub}>
              Start a session in Booth for guided recording, or open Console for the full timeline — same projects either way.
            </p>

                        <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
                marginTop: 28,
              }}
            >
              <button
                type="button"
                onClick={() => router.push("/app/studio")}
                style={{
                  ...primary,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "20px 20px",
                  textAlign: "left",
                  minHeight: 120,
                  borderRadius: 16,
                  boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", opacity: 0.9 }}>
                  BOOTH
                </span>
                <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.01em" }}>
                  New session
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.88, lineHeight: 1.4 }}>
                  Guided plan + record — easiest path for vocals
                </span>
              </button>
              <button
                type="button"
                onClick={() => router.push("/app/studio?mode=console")}
                style={{
                  ...secondary,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "20px 20px",
                  textAlign: "left",
                  minHeight: 120,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: C.brass || C.brassLine || C.border,
                  background: C.surface || "rgba(255,255,255,0.03)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: C.brass }}>
                  CONSOLE
                </span>
                <span style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: "-0.01em" }}>
                  Open Console
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.textMuted, lineHeight: 1.4 }}>
                  Timeline, layers, and produce from one view
                </span>
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                style={{ ...secondary, padding: "10px 14px", fontSize: 13.5 }}
                onClick={() => router.push("/app/try-it")}
                title="Preview a song in a temporary clone of your voice — not the full Record flow"
              >
                Try It
              </button>
              <button
                type="button"
                style={{ ...secondary, padding: "10px 14px", fontSize: 13.5 }}
                onClick={() => {
                  setTab("library");
                  router.replace("/app?tab=library");
                }}
              >
                Library
              </button>
              <button
                type="button"
                style={{ ...secondary, padding: "10px 14px", fontSize: 13.5 }}
                onClick={() => window.dispatchEvent(new Event("studio-tour-start"))}
              >
                How it works
              </button>
            </div>

            <div
              style={{
                marginTop: 40,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 1.2,
                color: C.textFaint,
                textTransform: "uppercase",
              }}
            >
              Recent projects
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
              {!loading && projects.length === 0 && (
                <EmptyState
                  scene="home"
                  title="Nothing on the deck yet"
                  description="Your first song starts in Studio — drop a beat, follow the plan, and hit record."
                  action={
                    <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                      Open Studio
                    </button>
                  }
                />
              )}
              {projects.slice(0, 12).map((p) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  meta={`${p.status} · ${[p.genre, p.mood].filter(Boolean).join(" · ")}`}
                />
              ))}
            </div>
          </>
        )}

        {tab === "library" && (
          <>
            <div style={eyebrow}>◆ LIBRARY</div>
            <h1 style={h1}>Your library</h1>
            <p style={sub}>Songs, instrumentals, and takes in one place.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, marginBottom: 12 }}>
              {(
                [
                  ["songs", "Songs"],
                  ["beats", "Beats"],
                  ["recordings", "Recordings"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLibraryTab(k)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: libraryTab === k ? `1px solid ${C.brassLine}` : `1px solid ${C.border}`,
                    background: libraryTab === k ? C.brassSoft : "transparent",
                    color: libraryTab === k ? C.brass : C.textMuted,
                    fontSize: 13,
                    fontWeight: libraryTab === k ? 600 : 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            {libraryTab === "songs" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {beatPlayError && (
                  <p style={{ color: "#E07070", fontSize: 13, margin: 0 }}>{beatPlayError}</p>
                )}
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.filter((p) => isFinishedSong(p)).length === 0 && (
                  <EmptyState
                    scene="songs"
                    title="No finished songs yet"
                    description="Record your sections, preview the full arrangement, then Produce — masters land here."
                    action={
                      <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                        Make a song
                      </button>
                    }
                  />
                )}
                {projects
                  .filter((p) => isFinishedSong(p))
                  .flatMap((p) => {
                    const masters =
                      p.masters && p.masters.length > 0
                        ? p.masters
                        : p.has_master
                          ? [
                              {
                                job_id: "",
                                version: 1,
                                audio_path: "",
                                completed_at: p.updated_at || null,
                                engine_version: null,
                              } as MasterVersion,
                            ]
                          : [];
                    const total = Math.max(masters.length, 1);
                    return masters.map((m) => {
                      const label =
                        total > 1
                          ? `${p.title} · Take ${m.version}`
                          : p.title;
                      const when = m.completed_at
                        ? new Date(m.completed_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : null;
                      const eng = m.engine_version ? ` · ${m.engine_version}` : "";
                      const meta = [
                        total > 1 ? `Version ${m.version} of ${total}` : "Song ready",
                        when,
                        [p.genre, p.mood].filter(Boolean).join(" · ") || null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <SongVersionRow
                          key={`${p.id}-${m.job_id || m.version}`}
                          projectId={p.id}
                          title={label}
                          meta={meta + eng}
                          jobId={m.job_id || undefined}
                          version={m.version}
                          isReady
                        />
                      );
                    });
                  })}
              </div>
            )}
            {libraryTab === "beats" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.filter((p) => p.has_beat).length === 0 && (
                  <EmptyState
                    scene="beats"
                    title="No beats yet"
                    description="Generate an AI instrumental or upload your own — every beat becomes a session."
                    action={
                      <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                        Create a beat
                      </button>
                    }
                  />
                )}
                {beatPlayError && (
                  <p style={{ color: "#E07070", fontSize: 13, margin: 0 }}>{beatPlayError}</p>
                )}
                {projects
                  .filter((p) => p.has_beat)
                  .map((p) => {
                    const isActive = activeId === p.id;
                    const isPlaying = isActive && audioIsPlaying;
                    const busy = loadingPlayId === p.id || deletingId === p.id;
                    const meta = [p.genre, p.mood].filter(Boolean).join(" · ") || p.status;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 0,
                          padding: "12px 14px",
                          borderRadius: 16,
                          background: C.surface,
                          border: `1px solid ${isActive ? C.brassLine || C.brass : C.border}`,
                          color: C.text,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <button
                            type="button"
                            aria-label={isPlaying ? "Pause beat" : "Play beat"}
                            disabled={busy && loadingPlayId !== p.id}
                            onClick={() => {
                              setBeatPlayError(null);
                              void togglePlayBeat(p.id, {
                                title: p.title,
                                subtitle: meta || "Beat",
                                seed: p.title || p.id,
                              });
                            }}
                            style={{
                              position: "relative",
                              width: 52,
                              height: 52,
                              borderRadius: 12,
                              border: "none",
                              padding: 0,
                              flexShrink: 0,
                              cursor: "pointer",
                              overflow: "hidden",
                              background: "transparent",
                            }}
                          >
                            <CoverArt seed={p.title || p.id} size={52} />
                            <span
                              style={{
                                position: "absolute",
                                inset: 0,
                                display: "grid",
                                placeItems: "center",
                                background: "rgba(0,0,0,0.3)",
                                color: "#fff",
                                fontSize: 14,
                                fontWeight: 700,
                              }}
                            >
                              {loadingPlayId === p.id ? "…" : isPlaying ? "❚❚" : "▶"}
                            </span>
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 650,
                                fontSize: 14,
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
                                    color: C.textMuted,
                                    border: `1px solid ${C.border}`,
                                  }}
                                >
                                  Upload
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                              {meta}
                              {isPlaying ? " · Playing" : isActive ? " · Paused" : ""}
                            </div>
                          </div>
                          <BeatMoreButton
                            active={beatMenu?.id === p.id}
                            onClick={() =>
                              setBeatMenu({
                                id: p.id,
                                title: p.title,
                                meta: `Beat · ${meta}`,
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                <BeatActionsSheet
                  open={Boolean(beatMenu)}
                  title={beatMenu?.title || "Beat"}
                  subtitle={beatMenu?.meta}
                  onClose={() => setBeatMenu(null)}
                  items={
                    beatMenu
                      ? [
                          {
                            key: "booth",
                            label: "Open Booth",
                            onClick: () => router.push(`/app/studio/${beatMenu.id}`),
                          },
                          {
                            key: "console",
                            label: "Open Console",
                            onClick: () => router.push(`/app/console/${beatMenu.id}`),
                          },
                          {
                            key: "download",
                            label: "Download beat",
                            onClick: () => void downloadBeatFile(beatMenu.id, beatMenu.title),
                          },
                          {
                            key: "delete",
                            label: deletingId === beatMenu.id ? "Deleting…" : "Delete",
                            danger: true,
                            disabled: deletingId === beatMenu.id,
                            onClick: () => void deleteProject(beatMenu.id, beatMenu.title),
                          },
                        ]
                      : []
                  }
                />
              </div>
            )}
            {libraryTab === "recordings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading &&
                  projects.filter(
                    (p) =>
                      !isFinishedSong(p) &&
                      ["recording", "in_progress", "blueprint_ready", "planned", "beat_ready"].includes(
                        p.status
                      )
                  ).length === 0 && (
                    <EmptyState
                      scene="recordings"
                      title="Your voice belongs here"
                      description="Every take you record in a session shows up when you open that project. Grab headphones and hit Record."
                      action={
                        <button type="button" style={ctaBtn} onClick={() => router.push("/app/studio")}>
                          Start a session
                        </button>
                      }
                    />
                  )}
                {projects
                  .filter(
                    (p) =>
                      !isFinishedSong(p) &&
                      ["recording", "in_progress", "blueprint_ready", "planned", "beat_ready"].includes(
                        p.status
                      )
                  )
                  .map((p) => (
                    <ProjectRow key={p.id} p={p} meta={`Session · ${p.status}`} />
                  ))}
              </div>
            )}
          </>
        )}

        {tab === "profile" && (
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              margin: "0 auto",
              paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div style={eyebrow}>◆ PROFILE</div>

            {/* Identity */}
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 16,
                padding: "16px 16px",
                borderRadius: 18,
                background: C.surface,
                border: `1px solid ${C.border}`,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  ...avatar,
                  width: 64,
                  height: 64,
                  fontSize: 22,
                  flexShrink: 0,
                  margin: 0,
                }}
              >
                {initials || "A"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: "clamp(1.15rem, 4vw, 1.35rem)",
                    color: C.text,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {userName}
                </div>
                {userEmail && (
                  <div
                    style={{
                      fontSize: 13,
                      color: C.textMuted,
                      marginTop: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {userEmail}
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 6 }}>
                  {projects.length} session{projects.length === 1 ? "" : "s"}
                  {userGenre ? ` · ${userGenre}` : ""}
                  {userPlan ? ` · ${userPlan}` : ""}
                </div>
              </div>
            </div>

            {profileMsg && (
              <p
                style={{
                  fontSize: 13,
                  color: profileMsg.includes("updated") ? C.brass : "#f07167",
                  margin: "0 0 12px",
                }}
              >
                {profileMsg}
              </p>
            )}

            {/* Edit profile */}
            {!editProfileOpen ? (
              <button
                type="button"
                onClick={() => {
                  setEditName(userName);
                  setEditGenre(userGenre || "");
                  setEditProfileOpen(true);
                  setProfileMsg(null);
                }}
                style={{
                  ...secondary,
                  width: "100%",
                  marginBottom: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                Edit profile
              </button>
            ) : (
              <div
                style={{
                  padding: 16,
                  borderRadius: 18,
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  marginBottom: 20,
                }}
              >
                <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 12, color: C.text }}>
                  Edit profile
                </div>
                <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                  Display name
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={64}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: C.bgDeep || C.bg,
                    color: C.text,
                    fontSize: 15,
                    marginBottom: 12,
                    fontFamily: "inherit",
                  }}
                />
                <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
                  Primary genre
                </label>
                <input
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  placeholder="e.g. R&B, Afrobeats, Gospel"
                  maxLength={48}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: `1px solid ${C.border}`,
                    background: C.bgDeep || C.bg,
                    color: C.text,
                    fontSize: 15,
                    marginBottom: 14,
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={profileSaving}
                    onClick={() => void saveProfile()}
                    style={{
                      ...primary,
                      flex: 1,
                      minWidth: 120,
                      padding: "12px 16px",
                      opacity: profileSaving ? 0.7 : 1,
                    }}
                  >
                    {profileSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={profileSaving}
                    onClick={() => {
                      setEditProfileOpen(false);
                      setProfileMsg(null);
                    }}
                    style={{ ...secondary, flex: 1, minWidth: 100, padding: "12px 16px" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Settings */}
            <div style={{ fontWeight: 650, fontSize: 13, color: C.textMuted, marginBottom: 10, letterSpacing: 0.04 }}>
              App settings
            </div>
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${C.border}`,
                background: C.surface,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              {[
                {
                  key: "studio",
                  label: "Studio",
                  sub: "Create beats and open sessions",
                  href: "/app/studio",
                },
                {
                  key: "library",
                  label: "Library",
                  sub: "Songs, beats, and recordings",
                  action: () => setTab("library"),
                },
                {
                  key: "tour",
                  label: "How Studio works",
                  sub: "Quick product tour",
                  action: () => window.dispatchEvent(new Event("studio-tour-start")),
                },
                {
                  key: "terms",
                  label: "Terms of use",
                  sub: "Legal terms",
                  href: "/terms",
                },
                {
                  key: "privacy",
                  label: "Privacy",
                  sub: "How we handle your data",
                  href: "/privacy",
                },
              ].map((row, i, arr) => {
                const inner = (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{row.label}</div>
                      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{row.sub}</div>
                    </div>
                    <span style={{ color: C.brass, fontSize: 18, flexShrink: 0 }}>›</span>
                  </>
                );
                const style: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 16px",
                  borderBottom: i < arr.length - 1 || isAdmin ? `1px solid ${C.border}` : "none",
                  textDecoration: "none",
                  color: "inherit",
                  background: "transparent",
                  border: "none",
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                };
                if (row.href) {
                  return (
                    <Link key={row.key} href={row.href} style={style}>
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button key={row.key} type="button" style={style} onClick={row.action}>
                    {inner}
                  </button>
                );
              })}
              {isAdmin && (
                <Link
                  href="/app/admin"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 16px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>Admin dashboard</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Internal metrics</div>
                  </div>
                  <span style={{ color: C.brass, fontSize: 18 }}>›</span>
                </Link>
              )}
            </div>

            <button
              type="button"
              style={{
                ...secondary,
                width: "100%",
                color: "#f07167",
                borderColor: "rgba(240,113,103,0.35)",
              }}
              onClick={signOut}
            >
              Log out
            </button>
          </div>
        )}
      </div>

        
        <BeatActionsSheet
          open={Boolean(projectMenu)}
          title={projectMenu?.title || "Project"}
          subtitle={projectMenu?.meta}
          onClose={() => setProjectMenu(null)}
          items={
            projectMenu
              ? [
                  {
                    key: "booth",
                    label: "Open Booth",
                    onClick: () => router.push(`/app/studio/${projectMenu.id}`),
                  },
                  {
                    key: "console",
                    label: "Open Console",
                    onClick: () => router.push(`/app/console/${projectMenu.id}`),
                  },
                  ...(projectMenu.isReady
                    ? [
                        {
                          key: "download",
                          label: "Download song",
                          onClick: () =>
                            setDownloadModal({
                              id: projectMenu.id,
                              title: projectMenu.title,
                              jobId: projectMenu.jobId,
                              version: projectMenu.version,
                            }),
                        },
                      ]
                    : []),
                  {
                    key: "delete",
                    label: deletingId === projectMenu.id ? "Deleting…" : "Delete",
                    danger: true,
                    disabled: deletingId === projectMenu.id,
                    onClick: () => void deleteProject(projectMenu.id, projectMenu.title),
                  },
                ]
              : []
          }
        />


      
      <LibraryMiniPlayer
        open={tab === "library" && Boolean(activeId)}
        title={trackMeta?.title || "Now playing"}
        subtitle={
          trackMeta?.subtitle ||
          (duration > 0
            ? `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`
            : undefined)
        }
        seed={trackMeta?.seed}
        isPlaying={audioIsPlaying}
        loading={Boolean(loadingPlayId)}
        currentTime={currentTime}
        duration={duration}
        onTogglePlay={() => {
          if (audioIsPlaying) pauseAudio();
          else void resumeAudio();
        }}
        onSeek={seek}
        onSkip={skip}
        onClose={() => stop()}
      />

      <ApPaywall
        open={paywallOpen}
        onClose={() => {
          setPaywallOpen(false);
          setPaywallProject(null);
        }}
        songTitle={paywallProject?.title}
        projectId={paywallProject?.id}
        colors={{
          text: C.text,
          textMuted: C.textMuted,
          surface: C.surface,
          border: C.border,
          accent: C.brass,
          bg: C.bg || C.surface,
        }}
        onUnlocked={() => {
          setPaywallOpen(false);
          if (paywallProject) {
            setDownloadModal({
              id: paywallProject.id,
              title: paywallProject.title,
              jobId: paywallProject.jobId,
              version: paywallProject.version,
            });
          }
          setPaywallProject(null);
        }}
      />

      {downloadModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Download format"
            onClick={() => !downloadBusy && setDownloadModal(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 80,
              background: "rgba(0,0,0,0.55)",
              display: "grid",
              placeItems: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 340,
                borderRadius: 18,
                background: C.surface,
                border: `1px solid ${C.border}`,
                padding: "22px 20px",
                boxShadow: C.cardShadow,
              }}
            >
              <div style={{ fontFamily: "Georgia, serif", fontSize: 18, color: C.text, marginBottom: 6 }}>
                Download
              </div>
              <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px", lineHeight: 1.45 }}>
                Choose a format for “{downloadModal.title || "your song"}”. The file will save to your device.
              </p>
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => void runDownload(downloadModal.id, downloadModal.title, "wav", { jobId: downloadModal.jobId, version: downloadModal.version })}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: `linear-gradient(180deg, #F0BC80, ${C.brass})`,
                  color: "#1A1208",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: downloadBusy ? "wait" : "pointer",
                  marginBottom: 8,
                  fontFamily: "inherit",
                }}
              >
                {downloadBusy ? "Downloading…" : "WAV — full quality"}
              </button>
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => void runDownload(downloadModal.id, downloadModal.title, "mp3", { jobId: downloadModal.jobId, version: downloadModal.version })}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: downloadBusy ? "wait" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {downloadBusy ? "Downloading…" : "MP3 — smaller file"}
              </button>
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() => setDownloadModal(null)}
                style={{
                  width: "100%",
                  marginTop: 12,
                  padding: "10px",
                  border: "none",
                  background: "transparent",
                  color: C.textMuted,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
    </AppShell>
  );
}

export default function StudioAppPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            color: "#9B96A3",
          }}
        >
          Loading…
        </div>
      }
    >
      <AppInner />
    </Suspense>
  );
}

"use client";

import React, { useEffect, useState, Suspense } from "react";
import {
  useBeatAudio,
  BeatPreviewTransport,
  BeatPlayButton,
  BeatMoreButton,
  BeatActionsSheet,
} from "@/components/beat-preview-player";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useTheme } from "@/lib/theme";
import { CoverArt } from "@/components/studio-player";
import { forceDownloadFromApi } from "@/lib/download-audio";

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
};
type Tab = "home" | "library" | "profile";

function AppInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { colors: C } = useTheme();
  const [userName, setUserName]
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
 = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [libraryTab, setLibraryTab] = useState<"songs" | "beats" | "recordings">("songs");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadModal, setDownloadModal] = useState<{ id: string; title: string } | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [beatPlayError, setBeatPlayError] = useState<string | null>(null);
  const [beatMenu, setBeatMenu] = useState<{ id: string; title: string; meta: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    id: string;
    title: string;
    meta: string;
    isReady: boolean;
  } | null>(null);
  const beatAudio = useBeatAudio({
    onError: (message) => setBeatPlayError(message),
  });
  const {
    playingId,
    loadingId: loadingPlayId,
    currentTime,
    duration,
    toggle: togglePlayBeat,
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
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      setUserName(profile?.display_name || user.email?.split("@")[0] || "Artist");
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

  async function runDownload(projectId: string, title: string, format: "wav" | "mp3") {
    setDownloadBusy(true);
    const result = await forceDownloadFromApi(projectId, format, `${title || "song"}.${format}`);
    setDownloadBusy(false);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setDownloadModal(null);
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
                  .map((p) => (
                    <ProjectRow
                      key={p.id}
                      p={p}
                      meta={`Song ready · ${[p.genre, p.mood].filter(Boolean).join(" · ")}`}
                    />
                  ))}
              </div>
            )}
            {libraryTab === "beats" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.filter((p) => p.has_beat && !isFinishedSong(p)).length === 0 && (
                  <EmptyState
                    scene="beats"
                    title="No beats on the shelf"
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
                  .filter((p) => p.has_beat && !isFinishedSong(p))
                  .map((p) => {
                    const isPlaying = playingId === p.id;
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
                          border: `1px solid ${isPlaying ? C.brassLine || C.brass : C.border}`,
                          color: C.text,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <BeatPlayButton
                            isPlaying={isPlaying}
                            loading={loadingPlayId === p.id}
                            disabled={busy && loadingPlayId !== p.id}
                            onClick={() => {
                              setBeatPlayError(null);
                              void togglePlayBeat(p.id);
                            }}
                          />
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
                              {isPlaying ? " · Playing" : ""}
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
          <div style={{ textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
            <div style={eyebrow}>◆ PROFILE</div>
            <div style={{ ...avatar, width: 72, height: 72, fontSize: 24, margin: "16px auto" }}>
              {initials || "A"}
            </div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: C.text }}>{userName}</div>
            <p style={{ color: C.textMuted, marginTop: 8 }}>
              {projects.length} session{projects.length === 1 ? "" : "s"}
            </p>
            <button type="button" style={{ ...secondary, marginTop: 24, width: "100%" }} onClick={() => window.dispatchEvent(new Event("studio-tour-start"))}>
              How Studio works (tour)
            </button>
            {isAdmin && (
              <Link
                href="/app/admin"
                style={{
                  ...secondary,
                  marginTop: 12,
                  width: "100%",
                  display: "block",
                  textAlign: "center",
                  textDecoration: "none",
                  boxSizing: "border-box",
                }}
              >
                Admin dashboard
              </Link>
            )}
            <button type="button" style={{ ...secondary, marginTop: 12, width: "100%" }} onClick={signOut}>
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
                            setDownloadModal({ id: projectMenu.id, title: projectMenu.title }),
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
                onClick={() => void runDownload(downloadModal.id, downloadModal.title, "wav")}
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
                onClick={() => void runDownload(downloadModal.id, downloadModal.title, "mp3")}
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

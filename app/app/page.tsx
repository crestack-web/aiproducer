"use client";

import React, { useEffect, useState, Suspense } from "react";
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
};
type Tab = "home" | "library" | "profile";

function AppInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { colors: C } = useTheme();
  const [userName, setUserName] = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [libraryTab, setLibraryTab] = useState<"songs" | "beats" | "recordings">("songs");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadModal, setDownloadModal] = useState<{ id: string; title: string } | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

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
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => router.push(`/app/studio/${p.id}`)}
            style={{
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.brass,
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 8px",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Booth
          </button>
          <button
            type="button"
            onClick={() => router.push(`/app/console/${p.id}`)}
            style={{
              border: `1px solid ${C.border}`,
              background: C.surface,
              color: C.textMuted,
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 8px",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Console
          </button>
          <IconBtn label="Open Booth" onClick={() => router.push(`/app/studio/${p.id}`)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5L8 5.5Z" />
            </svg>
          </IconBtn>
          {isReady && (
            <IconBtn label="Download" onClick={() => setDownloadModal({ id: p.id, title: p.title })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 3v12" strokeLinecap="round" />
                <path d="M7 11l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 21h14" strokeLinecap="round" />
              </svg>
            </IconBtn>
          )}
          <IconBtn label="Delete" danger onClick={() => void deleteProject(p.id, p.title)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 7h16" strokeLinecap="round" />
              <path d="M10 11v6M14 11v6" strokeLinecap="round" />
              <path d="M6 7l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
        </div>
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
            {/* Studio floor hero — session energy, not SaaS dashboard */}
            <section
              className="dash-hero"
              style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: 20,
                border: `1px solid ${C.border}`,
                background: `radial-gradient(ellipse 90% 80% at 12% 0%, ${C.brassSoft || "rgba(231,169,97,.14)"} 0%, transparent 55%), radial-gradient(ellipse 70% 60% at 100% 20%, rgba(123,235,212,.1) 0%, transparent 50%), ${C.surface}`,
                padding: "28px 22px 24px",
                marginBottom: 8,
              }}
            >
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  right: 16,
                  top: 18,
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 3,
                  height: 44,
                  opacity: 0.55,
                  pointerEvents: "none",
                }}
              >
                {[10, 22, 14, 32, 18, 28, 12, 36, 16, 24, 11, 30, 15, 20].map((h, i) => (
                  <span
                    key={i}
                    style={{
                      width: 3,
                      height: h,
                      borderRadius: 2,
                      background:
                        i % 3 === 0
                          ? C.brass || "#E7A961"
                          : i % 2 === 0
                            ? "rgba(123,235,212,.75)"
                            : C.textFaint || "rgba(255,255,255,.25)",
                    }}
                  />
                ))}
              </div>

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  color: C.brass,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                ◆ Live floor
              </div>

              <h1
                style={{
                  ...h1,
                  margin: "0 0 10px",
                  maxWidth: 520,
                  fontSize: "clamp(1.65rem, 4.2vw, 2.15rem)",
                  lineHeight: 1.15,
                }}
              >
                {userName && userName !== "Artist" ? (
                  <>
                    <span style={{ fontWeight: 500, color: C.textMuted, fontSize: "0.72em", display: "block", marginBottom: 6 }}>
                      Hey {userName}
                    </span>
                    Ready when you are.
                    <br />
                    <em style={{ fontStyle: "italic", fontWeight: 400, color: C.text }}>Mic up. Drop a beat.</em>
                  </>
                ) : (
                  <>
                    Ready when you are.
                    <br />
                    <em style={{ fontStyle: "italic", fontWeight: 400 }}>Mic up. Drop a beat.</em>
                  </>
                )}
              </h1>

              <p
                style={{
                  ...sub,
                  margin: "0 0 22px",
                  maxWidth: 440,
                  fontSize: 14.5,
                  lineHeight: 1.5,
                }}
              >
                This is your booth — not a project manager. Load a beat, follow the plan, stack vocals, and leave with a mix.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 12,
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
                    padding: "16px 18px",
                    textAlign: "left",
                    minHeight: 100,
                    borderRadius: 14,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", opacity: 0.9 }}>
                    ● RECORD
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>Open the booth</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.85, lineHeight: 1.35 }}>
                    Guided session — beat in, vocals on the grid
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
                    padding: "16px 18px",
                    textAlign: "left",
                    minHeight: 100,
                    borderRadius: 14,
                    borderColor: C.brassLine || C.border,
                    background: "transparent",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.brass }}>
                    ▣ BOARD
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Open console</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: C.textMuted, lineHeight: 1.35 }}>
                    Timeline, layers, and mix direction
                  </span>
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 16,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  style={{
                    ...secondary,
                    padding: "8px 12px",
                    fontSize: 12.5,
                    borderRadius: 999,
                    background: "transparent",
                  }}
                  onClick={() => {
                    setTab("library");
                    router.replace("/app?tab=library");
                  }}
                >
                  Tape library
                </button>
                <button
                  type="button"
                  style={{
                    ...secondary,
                    padding: "8px 12px",
                    fontSize: 12.5,
                    borderRadius: 999,
                    background: "transparent",
                  }}
                  onClick={() => window.dispatchEvent(new Event("studio-tour-start"))}
                >
                  How a session runs
                </button>
                {!loading && projects.length > 0 && (
                  <span style={{ fontSize: 12, color: C.textFaint, marginLeft: 4 }}>
                    {projects.length} on the desk
                  </span>
                )}
              </div>
            </section>

            <div
              style={{
                marginTop: 28,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 1.2,
                color: C.textFaint,
                textTransform: "uppercase",
              }}
            >
              On the desk
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
              <div className="dash-project-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                {projects
                  .filter((p) => p.has_beat && !isFinishedSong(p))
                  .map((p) => (
                    <ProjectRow
                      key={p.id}
                      p={p}
                      meta={`Beat · ${[p.genre, p.mood].filter(Boolean).join(" · ") || p.status}`}
                    />
                  ))}
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
            <button type="button" style={{ ...secondary, marginTop: 12, width: "100%" }} onClick={signOut}>
              Log out
            </button>
          </div>
        )}
      </div>

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

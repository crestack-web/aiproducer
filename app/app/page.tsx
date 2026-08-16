"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useTheme } from "@/lib/theme";

type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
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

  function ProjectRow({ p, meta }: { p: Project; meta: string }) {
    return (
      <div style={rowStyle}>
        <Link href={`/app/studio/${p.id}`} style={{ ...rowBody, textDecoration: "none", color: "inherit" }}>
          <div style={rowTitle}>{p.title}</div>
          <div style={rowMeta}>{meta}</div>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Link href={`/app/studio/${p.id}`} style={{ ...rowAction, textDecoration: "none" }}>
            Open
          </Link>
          <button
            type="button"
            disabled={deletingId === p.id}
            onClick={() => deleteProject(p.id, p.title)}
            style={{
              background: "none",
              border: "none",
              color: C.textFaint,
              fontSize: 12,
              cursor: deletingId === p.id ? "wait" : "pointer",
              fontFamily: "inherit",
              padding: 0,
            }}
            aria-label={`Delete ${p.title}`}
          >
            {deletingId === p.id ? "…" : "Delete"}
          </button>
        </div>
      </div>
    );
  }

  const activeNav = tab === "library" ? "library" : tab === "profile" ? "profile" : "home";

  return (
    <AppShell active={activeNav} userName={userName} onSignOut={signOut}>
<div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 40px", boxSizing: "border-box", width: "100%" }}>
        {tab === "home" && (
          <>
            <div style={eyebrow}>◆ STUDIO</div>
            <h1 style={h1}>
              Make music.
              <br />
              With your voice.
            </h1>
            <p style={sub}>Create a beat, then let your AI producer guide you until you have a finished song.</p>
            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              <button type="button" style={primary} onClick={() => router.push("/app/studio")}>
                Create a song
              </button>
              <button
                type="button"
                style={secondary}
                onClick={() => {
                  setTab("library");
                  router.replace("/app?tab=library");
                }}
              >
                Explore my songs
              </button>
              <button type="button" style={secondary} onClick={() => window.dispatchEvent(new Event("studio-tour-start"))}>
                How it works
              </button>
            </div>
            <div
              style={{
                marginTop: 36,
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
                {!loading && projects.filter((p) => p.status === "complete").length === 0 && (
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
                  .filter((p) => p.status === "complete")
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
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.length === 0 && (
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
                {projects.map((p) => (
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
                  projects.filter((p) =>
                    ["recording", "in_progress", "blueprint_ready", "complete", "beat_ready"].includes(p.status)
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
                  .filter((p) =>
                    ["recording", "in_progress", "blueprint_ready", "complete", "beat_ready"].includes(p.status)
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

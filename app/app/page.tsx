"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  borderHi: "rgba(255,255,255,0.16)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
};

const COVER_GRADIENTS = [
  ["#3A2E52", "#0B0A0F"],
  ["#2E4A4A", "#0B0A0F"],
  ["#4A2E3A", "#0B0A0F"],
  ["#39422E", "#0B0A0F"],
  ["#2E3A4A", "#0B0A0F"],
];

const GENRES = ["R&B", "Afrobeats", "Hip-Hop", "Pop", "Amapiano", "Gospel", "Highlife"];
const MOODS = ["Emotional", "Confident", "Dark", "Romantic", "Energetic", "Chill"];

type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
};

type Tab = "home" | "library" | "profile";

function coverFor(seed: string) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i) * (i + 1)) % COVER_GRADIENTS.length;
  return COVER_GRADIENTS[n];
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
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
  return map[status] || status;
}

export default function StudioAppPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState("R&B");
  const [mood, setMood] = useState("Emotional");
  const [beatMode, setBeatMode] = useState<"ai" | "upload">("ai");
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const fileRef = useRef<HTMLInputElement>(null);

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
        setProjects(json.projects || []);
      }
      setLoading(false);
    })();
  }, [router]);

  async function createAndGenerate() {
    setCreating(true);
    setError(null);
    try {
      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: beatMode === "upload" && beatFile ? beatFile.name.replace(/\.[^.]+$/, "") : `${mood} ${genre}`,
          genre,
          mood,
          tempo: 90,
        }),
      });
      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}));
        throw new Error(j.error || "Could not create project");
      }
      const { project } = await createRes.json();

      if (beatMode === "upload") {
        if (!beatFile) throw new Error("Choose a beat file to upload");
        const form = new FormData();
        form.append("file", beatFile);
        form.append("genre", genre);
        form.append("mood", mood);
        form.append("tempo", "90");
        const beatRes = await fetch(`/api/projects/${project.id}/beat`, { method: "POST", body: form });
        if (!beatRes.ok) {
          const j = await beatRes.json().catch(() => ({}));
          throw new Error(j.error || "Beat upload failed");
        }
      } else {
        const beatRes = await fetch(`/api/projects/${project.id}/generate-beat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ genre, mood, tempo: 90 }),
        });
        if (!beatRes.ok) {
          const j = await beatRes.json().catch(() => ({}));
          throw new Error(j.error || "Beat generation failed");
        }
      }

      const analyzeRes = await fetch(`/api/projects/${project.id}/analyze`, { method: "POST" });
      if (!analyzeRes.ok) {
        const j = await analyzeRes.json().catch(() => ({}));
        throw new Error(j.error || "Analyze failed");
      }
      router.push(`/app/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function renderProjects() {
    if (loading) return <p style={S.muted}>Loading…</p>;
    if (projects.length === 0) {
      return (
        <div style={S.empty}>
          <p style={S.emptyTitle}>No songs yet</p>
          <p style={S.muted}>Start a producer session from Home.</p>
          {tab !== "home" && (
            <button type="button" style={{ ...S.primaryBtn, marginTop: 16, maxWidth: 280 }} onClick={() => setTab("home")}>
              Go to Home
            </button>
          )}
        </div>
      );
    }
    return (
      <div style={S.grid}>
        {projects.map((p) => {
          const g = coverFor(p.id + (p.title || ""));
          return (
            <Link key={p.id} href={`/app/projects/${p.id}`} style={S.projectCard}>
              <div style={{ ...S.cover, background: `linear-gradient(145deg, ${g[0]}, ${g[1]})` }} />
              <div style={S.projectTitle}>{p.title}</div>
              <div style={S.projectMeta}>{[p.genre, p.mood].filter(Boolean).join(" · ") || "Untitled"}</div>
              <div style={S.status}>{statusLabel(p.status)}</div>
            </Link>
          );
        })}
      </div>
    );
  }

  const navBtn = (key: Tab, label: string) => (
    <button
      type="button"
      key={key}
      onClick={() => setTab(key)}
      style={{ ...S.navItem, ...(tab === key ? S.navActive : {}) }}
    >
      {label}
    </button>
  );

  return (
    <div style={S.shell}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
        .studio-bottom-nav { display: none; }
        @media (max-width: 860px) {
          .studio-sidebar { display: none !important; }
          .studio-bottom-nav { display: flex !important; }
          .studio-main-inner { padding: 24px 16px 96px !important; }
          .studio-hero-row { flex-direction: column !important; align-items: flex-start !important; }
          .studio-hero-art { display: none !important; }
          .studio-field-row { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <aside className="studio-sidebar" style={S.sidebar}>
        <div style={S.brand}>◆ STUDIO</div>
        <nav style={S.nav}>
          {navBtn("home", "Home")}
          {navBtn("library", "Library")}
          {navBtn("profile", "Profile")}
        </nav>
        <div style={S.sideCard}>
          <div style={S.sideCardLabel}>AI Producer</div>
          <div style={S.sideCardBody}>Your voice. Guided. Finished.</div>
        </div>
        <div style={S.sideFoot}>
          <div style={S.avatar}>{initials || "A"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={S.userName}>{userName}</div>
            <button type="button" onClick={signOut} style={S.signOut}>Log out</button>
          </div>
        </div>
      </aside>

      <main style={S.main}>
        <div className="studio-main-inner" style={S.mainInner}>
          {tab === "home" && (
            <>
              <div className="studio-hero-row" style={S.heroRow}>
                <div style={{ flex: 1, maxWidth: 520 }}>
                  <div style={S.monoEyebrow}>◆ STUDIO</div>
                  <h1 style={S.h1}>Make music.<br />With your voice.</h1>
                  <p style={S.sub}>Create a beat, then let your AI producer guide you section by section until you have a finished song.</p>
                </div>
                <div className="studio-hero-art" style={S.heroArt}>
                  <div style={S.heroGlow} />
                </div>
              </div>

              <section style={S.card}>
                <div style={S.cardTitle}>New song</div>
                <div className="studio-field-row" style={S.fieldRow}>
                  <label style={S.label}>
                    Genre
                    <select style={S.select} value={genre} onChange={(e) => setGenre(e.target.value)}>
                      {GENRES.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  <label style={S.label}>
                    Mood
                    <select style={S.select} value={mood} onChange={(e) => setMood(e.target.value)}>
                      {MOODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={S.chipRow}>
                  <button type="button" style={beatMode === "ai" ? S.chipOn : S.chip} onClick={() => setBeatMode("ai")}>AI beat</button>
                  <button type="button" style={beatMode === "upload" ? S.chipOn : S.chip} onClick={() => setBeatMode("upload")}>Upload my beat</button>
                </div>
                {beatMode === "upload" && (
                  <div style={S.uploadRow}>
                    <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" style={{ display: "none" }} onChange={(e) => setBeatFile(e.target.files?.[0] || null)} />
                    <button type="button" style={S.secondaryBtn} onClick={() => fileRef.current?.click()}>
                      {beatFile ? "Change file" : "Choose beat file"}
                    </button>
                    <span style={S.fileHint}>{beatFile ? beatFile.name : "WAV, MP3, M4A…"}</span>
                  </div>
                )}
                {error && <div style={S.error}>{error}</div>}
                <button
                  type="button"
                  style={{ ...S.primaryBtn, opacity: creating || (beatMode === "upload" && !beatFile) ? 0.55 : 1 }}
                  disabled={creating || (beatMode === "upload" && !beatFile)}
                  onClick={createAndGenerate}
                >
                  {creating ? "Creating…" : beatMode === "upload" ? "Start with my beat" : "Start producer session"}
                </button>
              </section>

              <section style={{ marginTop: 36 }}>
                <div style={S.sectionLabel}>Your sessions</div>
                <div style={{ marginTop: 14 }}>{renderProjects()}</div>
              </section>
            </>
          )}

          {tab === "library" && (
            <section>
              <div style={S.monoEyebrow}>◆ LIBRARY</div>
              <h1 style={{ ...S.h1, fontSize: "clamp(1.75rem, 3.5vw, 2.4rem)" }}>Your songs</h1>
              <p style={{ ...S.sub, marginBottom: 24 }}>Everything you've started or finished.</p>
              {renderProjects()}
            </section>
          )}

          {tab === "profile" && (
            <section>
              <div style={S.monoEyebrow}>◆ PROFILE</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 12, marginBottom: 28 }}>
                <div style={{ ...S.avatar, width: 84, height: 84, fontSize: 28 }}>{initials || "A"}</div>
                <div style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, marginTop: 14 }}>{userName}</div>
                <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
                  {projects.length} session{projects.length === 1 ? "" : "s"}
                </div>
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>Account</div>
                <p style={{ fontSize: 14, color: C.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
                  Preferences come from onboarding. Start new songs from Home.
                </p>
                <button type="button" style={S.secondaryBtn} onClick={() => setTab("home")}>Back to Home</button>
                <button type="button" style={{ ...S.secondaryBtn, marginTop: 10, width: "100%", color: C.textMuted }} onClick={signOut}>
                  Log out
                </button>
              </div>
            </section>
          )}
        </div>
      </main>

      <nav className="studio-bottom-nav" style={S.bottomNav} aria-label="Main">
        {(["home", "library", "profile"] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{ ...S.bottomItem, ...(tab === key ? S.bottomItemActive : {}) }}
            aria-current={tab === key ? "page" : undefined}
          >
            <span style={S.bottomIcon} aria-hidden>
              {key === "home" ? "⌂" : key === "library" ? "≡" : "◯"}
            </span>
            {key === "home" ? "Home" : key === "library" ? "Library" : "Profile"}
          </button>
        ))}
      </nav>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100vh", display: "flex", background: C.bgDeep, color: C.text, fontFamily: "Inter, system-ui, sans-serif", position: "relative" },
  sidebar: { width: 240, flexShrink: 0, display: "flex", flexDirection: "column", padding: "28px 18px 24px", borderRight: `1px solid ${C.border}`, background: `linear-gradient(180deg, ${C.bg}, ${C.bgDeep})` },
  brand: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: 2.5, color: C.brass, marginBottom: 36, paddingLeft: 10 },
  nav: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navItem: { padding: "11px 12px", borderRadius: 12, fontSize: 14.5, fontWeight: 500, color: C.textMuted, border: "1px solid transparent", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit", width: "100%" },
  navActive: { background: C.brassSoft, border: `1px solid ${C.brassLine}`, color: C.brass, fontWeight: 600 },
  sideCard: { marginTop: "auto", padding: "14px 12px", borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, marginBottom: 14 },
  sideCardLabel: { fontSize: 12, color: C.textFaint, marginBottom: 6 },
  sideCardBody: { fontSize: 13.5, color: C.text, lineHeight: 1.4 },
  sideFoot: { display: "flex", alignItems: "center", gap: 10, paddingTop: 12, borderTop: `1px solid ${C.border}` },
  avatar: { width: 36, height: 36, borderRadius: 999, background: `linear-gradient(145deg, ${C.brass}, #6B3F17)`, color: "#1A1208", display: "grid", placeItems: "center", fontFamily: "Fraunces, Georgia, serif", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  userName: { fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" },
  signOut: { background: "none", border: "none", color: C.textFaint, fontSize: 12, cursor: "pointer", padding: 0, marginTop: 2 },
  main: { flex: 1, minWidth: 0, overflowY: "auto", background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 40%)` },
  mainInner: { maxWidth: 1100, margin: "0 auto", padding: "40px 32px 80px" },
  heroRow: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40, marginBottom: 40 },
  monoEyebrow: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: 2.5, color: C.brass, marginBottom: 16 },
  h1: { fontFamily: "Fraunces, Georgia, serif", fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, fontWeight: 500, margin: 0, color: C.text },
  sub: { fontSize: 16, color: C.textMuted, marginTop: 16, lineHeight: 1.55, maxWidth: 420 },
  heroArt: { width: 200, height: 200, borderRadius: 28, flexShrink: 0, background: `linear-gradient(145deg, ${COVER_GRADIENTS[0][0]}, ${C.bgDeep})`, border: `1px solid ${C.border}`, position: "relative", overflow: "hidden", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)" },
  heroGlow: { position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 20%, rgba(123,235,212,0.15), transparent 60%)" },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: 22, maxWidth: 560 },
  cardTitle: { fontSize: 15, fontWeight: 600, marginBottom: 16 },
  fieldRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 },
  label: { display: "block", fontSize: 12, color: C.textMuted, fontWeight: 500 },
  select: { display: "block", width: "100%", marginTop: 6, padding: "11px 12px", borderRadius: 12, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.35)", color: C.text, fontSize: 14 },
  chipRow: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  chip: { padding: "9px 16px", borderRadius: 999, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.02)", color: C.textMuted, fontWeight: 500, fontSize: 13.5, cursor: "pointer" },
  chipOn: { padding: "9px 16px", borderRadius: 999, border: `1px solid ${C.brassLine}`, background: C.brassSoft, color: C.brass, fontWeight: 600, fontSize: 13.5, cursor: "pointer" },
  uploadRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  secondaryBtn: { padding: "10px 14px", borderRadius: 999, border: `1px solid ${C.borderHi}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 13.5 },
  fileHint: { fontSize: 13, color: C.textMuted },
  primaryBtn: { width: "100%", padding: "15px 20px", borderRadius: 16, border: "none", background: `linear-gradient(180deg, #F0BC80, ${C.brass})`, color: "#1A1208", fontWeight: 600, fontSize: 15.5, cursor: "pointer", boxShadow: "0 8px 24px -8px rgba(231,169,97,0.55)" },
  error: { marginBottom: 12, padding: 12, borderRadius: 12, background: "rgba(255,107,107,0.1)", color: "#ffb4b4", fontSize: 13.5 },
  sectionLabel: { fontSize: 12.5, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", color: C.textFaint },
  muted: { color: C.textMuted, fontSize: 14 },
  empty: { padding: "36px 20px", textAlign: "center", borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface },
  emptyTitle: { fontFamily: "Fraunces, Georgia, serif", fontSize: 18, marginBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 },
  projectCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 16, textDecoration: "none", color: "inherit" },
  cover: { width: "100%", aspectRatio: "1", borderRadius: 14, border: `1px solid ${C.border}` },
  projectTitle: { fontFamily: "Fraunces, Georgia, serif", fontSize: 17, marginTop: 12, color: C.text },
  projectMeta: { fontSize: 13, color: C.textMuted, marginTop: 4 },
  status: { marginTop: 10, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.brass },
  bottomNav: {
    position: "fixed", left: 0, right: 0, bottom: 0, height: 74,
    paddingBottom: "env(safe-area-inset-bottom)",
    background: "rgba(11,10,15,0.94)", backdropFilter: "blur(16px)",
    borderTop: `1px solid ${C.border}`, zIndex: 50,
    alignItems: "stretch", justifyContent: "space-around",
  },
  bottomItem: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 4, color: C.textFaint, fontSize: 10.5, fontWeight: 500, fontFamily: "inherit",
    background: "transparent", border: "none", cursor: "pointer", paddingBottom: 8,
  },
  bottomItemActive: { color: C.brass, fontWeight: 600 },
  bottomIcon: { fontSize: 18, lineHeight: 1 },
};

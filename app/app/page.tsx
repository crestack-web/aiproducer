"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const C = {
  bg: "#0B0A0F", bgDeep: "#050508", surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)", borderHi: "rgba(255,255,255,0.16)",
  brass: "#E7A961", brassSoft: "rgba(231,169,97,0.15)", brassLine: "rgba(231,169,97,0.55)",
  text: "#F4F1EC", textMuted: "#9B96A3", textFaint: "#5C5866",
};
const GRAD = [["#3A2E52","#0B0A0F"],["#2E4A4A","#0B0A0F"],["#4A2E3A","#0B0A0F"],["#39422E","#0B0A0F"],["#2E3A4A","#0B0A0F"]];
const GENRES = ["R&B","Afrobeats","Hip-Hop","Pop","Amapiano","Gospel","Highlife"];
const MOODS = ["Emotional","Confident","Dark","Romantic","Energetic","Chill"];

type Project = { id: string; title: string; status: string; genre: string | null; mood: string | null; updated_at: string };
type Tab = "home" | "create" | "library" | "profile";

function coverFor(seed: string) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i) * (i + 1)) % GRAD.length;
  return GRAD[n];
}
function statusLabel(s: string) {
  const m: Record<string, string> = {
    draft: "Draft", generating_beat: "Creating beat…", beat_ready: "Beat ready", analyzing: "Producer analyzing…",
    blueprint_ready: "Plan ready", recording: "Recording", processing: "Assembling…", mixing: "Mixing…",
    mastering: "Mastering…", complete: "Song ready", failed: "Needs attention",
  };
  return m[s] || s;
}
function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function IconHome({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.5v-6h-3v6H5a1 1 0 0 1-1-1v-9.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/></svg>;
}
function IconLibrary({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="m16 6 4 14M12 6v14M8 8v12M4 4v16" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function IconProfile({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="9" r="3.5" stroke={color} strokeWidth="1.8"/><path d="M5.5 19.5c1.2-3 3.4-4.5 6.5-4.5s5.3 1.5 6.5 4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round"/></svg>;
}
function IconMusic({ size = 28, color = "rgba(244,241,236,0.88)" }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M9 18.5a2.75 2.75 0 1 1-2.1-2.68V7.4c0-.7.46-1.32 1.14-1.52L18 3.2v11.9" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16.25" cy="16.75" r="2.75" stroke={color} strokeWidth="1.7"/></svg>;
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
  const [prompt, setPrompt] = useState("");
  const [tempo, setTempo] = useState(104);
  const [beatMode, setBeatMode] = useState<"ai" | "upload">("ai");
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [libraryTab, setLibraryTab] = useState<"songs" | "beats" | "recordings">("songs");
  const fileRef = useRef<HTMLInputElement>(null);
  const tempoLabel = tempo < 90 ? "Slow" : tempo < 125 ? "Medium" : "Fast";

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/auth?mode=login"); return; }
      const { data: profile } = await supabase.from("profiles").select("display_name, genre").eq("id", user.id).maybeSingle();
      setUserName(profile?.display_name || user.email?.split("@")[0] || "Artist");
      if (profile?.genre) setGenre(profile.genre);
      const res = await fetch("/api/projects");
      if (res.ok) {
        const json = await res.json();
        const list = (json.projects || []).filter((p: Project) => p.status !== "draft");
        setProjects(list);
      }
      setLoading(false);
    })();
  }, [router]);

  async function uploadCustomBeat(projectId: string, file: File) {
    const signRes = await fetch(`/api/projects/${projectId}/beat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "sign", filename: file.name, contentType: file.type || "audio/wav" }),
    });
    if (!signRes.ok) {
      const j = await signRes.json().catch(() => ({}));
      if (file.size <= 4 * 1024 * 1024) {
        const form = new FormData();
        form.append("file", file); form.append("genre", genre); form.append("mood", mood); form.append("tempo", String(tempo));
        const beatRes = await fetch(`/api/projects/${projectId}/beat`, { method: "POST", body: form });
        if (!beatRes.ok) { const err = await beatRes.json().catch(() => ({})); throw new Error(err.error || j.error || "Beat upload failed"); }
        return;
      }
      throw new Error(j.error || "Could not start beat upload");
    }
    const signed = await signRes.json();
    const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "Content-Type": file.type || "audio/wav" }, body: file });
    if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
    const completeRes = await fetch(`/api/projects/${projectId}/beat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "complete", path: signed.path, filename: file.name, contentType: file.type || "audio/wav", size: file.size, genre, mood, tempo }),
    });
    if (!completeRes.ok) { const j = await completeRes.json().catch(() => ({})); throw new Error(j.error || "Could not save uploaded beat"); }
  }

  async function discardFailedProject(projectId: string) {
    try {
      await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    } catch {
      /* best-effort cleanup */
    }
  }

  async function createAndGenerate() {
    setCreating(true); setError(null);
    let projectId: string | null = null;
    try {
      if (beatMode === "upload" && !beatFile) {
        throw new Error("Choose a beat file to upload");
      }

      const createRes = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: beatMode === "upload" && beatFile ? beatFile.name.replace(/\.[^.]+$/, "") : `${mood} ${genre}`,
          genre, mood, tempo, prompt: prompt.trim() || undefined,
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
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ genre, mood, tempo, prompt: prompt.trim() || undefined }),
        });
        if (!beatRes.ok) {
          const j = await beatRes.json().catch(() => ({}));
          throw new Error(j.error || "Beat generation failed");
        }
      }

      router.push(`/app/projects/${project.id}`);
    } catch (e) {
      if (projectId) await discardFailedProject(projectId);
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

  const initials = userName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  function renderProjects() {
    if (loading) return <p style={{ color: C.textMuted }}>Loading…</p>;
    if (projects.length === 0) {
      return (
        <div style={S.empty}>
          <p style={S.emptyTitle}>No songs yet</p>
          <p style={{ color: C.textMuted, fontSize: 14 }}>Start a producer session from Home.</p>
        </div>
      );
    }
    return (
      <div style={S.grid}>
        {projects.map((p) => {
          const g = coverFor(p.id + (p.title || ""));
          return (
            <Link key={p.id} href={`/app/projects/${p.id}`} style={S.card}>
              <div style={{ ...S.cover, background: `linear-gradient(145deg, ${g[0]}, ${g[1]})` }}>
                <IconMusic size={32} />
              </div>
              <div style={S.title} title={p.title}>{p.title}</div>
              <div style={S.meta}>{[p.genre, p.mood].filter(Boolean).join(" · ") || "Untitled"}</div>
              <div style={S.status}>{statusLabel(p.status)}</div>
            </Link>
          );
        })}
      </div>
    );
  }

  function renderProjectList(emptyTitle = "No songs yet", emptyBody = "Start a producer session from Home.") {
    if (loading) return <p style={{ color: C.textMuted }}>Loading…</p>;
    if (projects.length === 0) {
      return (
        <div style={S.empty}>
          <p style={S.emptyTitle}>{emptyTitle}</p>
          <p style={{ color: C.textMuted, fontSize: 14 }}>{emptyBody}</p>
        </div>
      );
    }
    return (
      <div style={S.list}>
        {projects.map((p) => {
          const g = coverFor(p.id + (p.title || ""));
          const date = formatDate(p.updated_at);
          const meta = [p.genre, date, statusLabel(p.status)].filter(Boolean).join(" · ");
          return (
            <Link key={p.id} href={`/app/projects/${p.id}`} style={S.listRow}>
              <div style={{ ...S.listCover, background: `linear-gradient(145deg, ${g[0]}, ${g[1]})` }}>
                <IconMusic size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.listTitle} title={p.title || "Untitled"}>{p.title || "Untitled"}</div>
                <div style={S.listMeta}>{meta || "Untitled"}</div>
              </div>
              <div style={S.listRight}>{date}</div>
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <div style={S.shell}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
        html, body { height: 100%; overflow: hidden; }
        .studio-bottom-nav { display: none; }
        @media (max-width: 860px) {
          .studio-sidebar { display: none !important; }
          .studio-bottom-nav { display: flex !important; }
          .studio-main-inner { padding: 24px 16px 100px !important; }
          .studio-hero-art { display: none !important; }
          .studio-cta-row { flex-direction: column !important; }
        }
        input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.12); width: 100%; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 999px; background: #E7A961; box-shadow: 0 0 0 4px rgba(231,169,97,0.2); cursor: pointer; }
      `}</style>

      <aside className="studio-sidebar" style={S.sidebar}>
        <div style={S.brand}>◆ STUDIO</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {([
            ["home", "Home", IconHome],
            ["library", "Library", IconLibrary],
            ["profile", "Profile", IconProfile],
          ] as const).map(([key, label, Icon]) => {
            const active = tab === key || (key === "home" && tab === "create");
            return (
              <button key={key} type="button" onClick={() => setTab(key)} style={{ ...S.navItem, ...(active ? S.navActive : {}) }}>
                <Icon size={18} color={active ? C.brass : C.textMuted} /> {label}
              </button>
            );
          })}
        </nav>
        <div style={S.sideCard}>
          <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 6 }}>AI Producer</div>
          <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.4 }}>Your voice. Guided. Finished.</div>
          <button type="button" onClick={() => setTab("create")} style={S.sideCta}>New song</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 14, paddingBottom: 28, borderTop: `1px solid rgba(255,255,255,0.06)` }}>
          <div style={S.avatar}>{initials || "A"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</div>
            <button type="button" onClick={signOut} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 12, cursor: "pointer", padding: 0, marginTop: 2 }}>Log out</button>
          </div>
        </div>
      </aside>

      <main style={S.main}>
        <div className="studio-main-inner" style={{ width: "100%", maxWidth: 1200, margin: "0 auto", padding: "36px 40px 64px", boxSizing: "border-box" }}>
          {tab === "home" && (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40, marginBottom: 40 }}>
                <div style={{ flex: 1, maxWidth: 520 }}>
                  <div style={S.eyebrow}>◆ STUDIO</div>
                  <h1 style={S.h1}>Make music.<br />With your voice.</h1>
                  <p style={S.sub}>Create a beat, then let your AI producer guide you section by section until you have a finished song.</p>
                  <div className="studio-cta-row" style={{ display: "flex", gap: 12, marginTop: 28, maxWidth: 420 }}>
                    <button type="button" style={S.primary} onClick={() => setTab("create")}>Create a song</button>
                    <button type="button" style={S.secondary} onClick={() => setTab("library")}>Explore my songs</button>
                  </div>
                </div>
                <div className="studio-hero-art" style={S.heroArt}><IconMusic size={42} /></div>
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", color: C.textFaint, marginBottom: 14 }}>Recent projects</div>
              {renderProjects()}
            </>
          )}

          {tab === "create" && (
            <section style={{ width: "100%", maxWidth: 920, margin: "0 auto", boxSizing: "border-box" }}>
              <button type="button" onClick={() => setTab("home")} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 13.5, cursor: "pointer", marginBottom: 18, padding: 0 }}>← Back</button>
              <div style={S.eyebrow}>◆ CREATE</div>
              <h1 style={{ ...S.h1, fontSize: "clamp(1.75rem, 3.2vw, 2.35rem)", marginBottom: 8 }}>Create your beat</h1>
              <p style={{ ...S.sub, margin: "0 0 24px", maxWidth: 520 }}>Describe the sound, pick genre and mood, set tempo — then let your AI producer guide the session.</p>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: "28px 28px 24px", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="Emotional Afrobeats song about falling in love at night, warm guitars, deep bass, catchy percussion." style={{ ...S.prompt, boxSizing: "border-box", minHeight: 110 }} />
                <div style={{ marginTop: 20 }}>
                  <div style={S.label}>Genre</div>
                  <div style={S.chips}>{GENRES.map((g) => <button key={g} type="button" style={genre === g ? S.chipOn : S.chip} onClick={() => setGenre(g)}>{g}</button>)}</div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <div style={S.label}>Mood</div>
                  <div style={S.chips}>{MOODS.map((m) => <button key={m} type="button" style={mood === m ? S.chipOn : S.chip} onClick={() => setMood(m)}>{m}</button>)}</div>
                </div>
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={S.label}>Tempo</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: C.brass }}>{tempo} BPM · {tempoLabel}</div>
                  </div>
                  <input type="range" min={60} max={160} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} aria-label="Tempo" />
                </div>
                <div style={{ marginTop: 20 }}>
                  <div style={S.label}>Beat source</div>
                  <div style={S.chips}>
                    <button type="button" style={beatMode === "ai" ? S.chipOn : S.chip} onClick={() => setBeatMode("ai")}>AI beat</button>
                    <button type="button" style={beatMode === "upload" ? S.chipOn : S.chip} onClick={() => setBeatMode("upload")}>Upload my beat</button>
                  </div>
                </div>
                {beatMode === "upload" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
                    <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" style={{ display: "none" }} onChange={(e) => setBeatFile(e.target.files?.[0] || null)} />
                    <button type="button" style={S.secondary} onClick={() => fileRef.current?.click()}>{beatFile ? "Change file" : "Choose beat file"}</button>
                    <span style={{ fontSize: 13, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{beatFile ? beatFile.name : "WAV, MP3, M4A…"}</span>
                  </div>
                )}
                {error && <div style={{ marginTop: 14, padding: 12, borderRadius: 12, background: "rgba(255,107,107,0.1)", color: "#ffb4b4", fontSize: 13.5 }}>{error}</div>}
                <button type="button" style={{ ...S.primary, width: "100%", marginTop: 22, opacity: creating || (beatMode === "upload" && !beatFile) ? 0.55 : 1 }} disabled={creating || (beatMode === "upload" && !beatFile)} onClick={createAndGenerate}>
                  {creating ? "Creating beat…" : beatMode === "upload" ? "Start with my beat" : "Create beat"}
                </button>
              </div>
            </section>
          )}

          {tab === "library" && (
            <section style={{ width: "100%", maxWidth: 900, margin: "0 auto" }}>
              <div style={S.eyebrow}>◆ LIBRARY</div>
              <h1 style={{ ...S.h1, fontSize: "clamp(1.75rem, 3.5vw, 2.4rem)", marginBottom: 8 }}>Your library</h1>
              <p style={{ ...S.sub, marginBottom: 20, maxWidth: 480 }}>Songs, instrumentals, and takes in one place.</p>
              <div style={{ ...S.chips, marginBottom: 12 }}>
                {([["songs","Songs"],["beats","Beats"],["recordings","Recordings"]] as const).map(([k,l]) => (
                  <button key={k} type="button" style={libraryTab === k ? S.chipOn : S.chip} onClick={() => setLibraryTab(k)}>{l}</button>
                ))}
              </div>
              {libraryTab === "songs" && renderProjectList("No songs yet", "Start a producer session from Home.")}
              {libraryTab === "beats" && renderProjectList("No beats yet", "AI and uploaded instrumentals show up here.")}
              {libraryTab === "recordings" && (
                <div style={S.empty}>
                  <p style={S.emptyTitle}>Your voice belongs here.</p>
                  <p style={{ color: C.textMuted, fontSize: 14 }}>Every take you record will show up in this tab.</p>
                </div>
              )}
            </section>
          )}

          {tab === "profile" && (
            <section style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
              <div style={S.eyebrow}>◆ PROFILE</div>
              <div style={{ ...S.avatar, width: 84, height: 84, fontSize: 28, margin: "12px auto" }}>{initials || "A"}</div>
              <div style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 22, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{userName}</div>
              <p style={{ color: C.textMuted, marginTop: 8 }}>{projects.length} session{projects.length === 1 ? "" : "s"}</p>
              <button type="button" style={{ ...S.secondary, marginTop: 24 }} onClick={signOut}>Log out</button>
            </section>
          )}
        </div>
      </main>

      <nav className="studio-bottom-nav" style={S.bottomNav}>
        {([
          ["home", "Home", IconHome],
          ["library", "Library", IconLibrary],
          ["profile", "Profile", IconProfile],
        ] as const).map(([key, label, Icon]) => {
          const active = tab === key || (key === "home" && tab === "create");
          return (
            <button key={key} type="button" onClick={() => setTab(key)} style={{ ...S.bottomItem, color: active ? C.brass : C.textFaint, fontWeight: active ? 600 : 500 }}>
              <Icon size={22} color={active ? C.brass : C.textFaint} />{label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { height: "100vh", maxHeight: "100dvh", display: "flex", background: C.bgDeep, color: C.text, fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden" },
  sidebar: { width: 200, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", padding: "24px 12px 0", borderRight: `1px solid rgba(255,255,255,0.06)`, background: C.bgDeep },
  brand: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 2, color: C.brass, marginBottom: 28, paddingLeft: 10, opacity: 0.9 },
  navItem: { padding: "10px 12px", borderRadius: 10, fontSize: 14, fontWeight: 500, color: C.textMuted, border: "1px solid transparent", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit", width: "100%", display: "flex", alignItems: "center", gap: 10 },
  navActive: { background: C.brassSoft, border: `1px solid ${C.brassLine}`, color: C.brass, fontWeight: 600 },
  sideCard: { marginTop: "auto", padding: "12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid rgba(255,255,255,0.06)`, marginBottom: 12 },
  sideCta: { marginTop: 10, width: "100%", padding: "9px 12px", borderRadius: 10, border: "none", background: `linear-gradient(180deg, #F0BC80, ${C.brass})`, color: "#1A1208", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  avatar: { width: 36, height: 36, borderRadius: 999, background: `linear-gradient(145deg, ${C.brass}, #6B3F17)`, color: "#1A1208", display: "grid", placeItems: "center", fontFamily: "Fraunces, Georgia, serif", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  main: { flex: 1, minWidth: 0, height: "100%", overflowY: "auto", background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 45%)` },
  eyebrow: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: 2.5, color: C.brass, marginBottom: 16 },
  h1: { fontFamily: "Fraunces, Georgia, serif", fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, fontWeight: 500, margin: 0, color: C.text },
  sub: { fontSize: 16, color: C.textMuted, marginTop: 16, lineHeight: 1.55, maxWidth: 420 },
  heroArt: { width: 200, height: 200, borderRadius: 28, flexShrink: 0, background: `linear-gradient(145deg, ${GRAD[0][0]}, ${C.bgDeep})`, border: `1px solid ${C.border}`, display: "grid", placeItems: "center" },
  primary: { padding: "15px 20px", borderRadius: 16, border: "none", background: `linear-gradient(180deg, #F0BC80, ${C.brass})`, color: "#1A1208", fontWeight: 600, fontSize: 15.5, cursor: "pointer", boxShadow: "0 8px 24px -8px rgba(231,169,97,0.55)", fontFamily: "inherit" },
  secondary: { padding: "14px 20px", borderRadius: 16, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)", color: C.text, fontWeight: 500, fontSize: 15, cursor: "pointer", fontFamily: "inherit" },
  prompt: { width: "100%", resize: "none", background: "rgba(0,0,0,0.28)", border: `1px solid ${C.border}`, borderRadius: 16, padding: 16, color: C.text, fontFamily: "Inter, system-ui, sans-serif", fontSize: 14.5, lineHeight: 1.5, outline: "none", boxSizing: "border-box" },
  label: { fontSize: 12.5, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: C.textFaint, marginBottom: 10 },
  chips: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: { padding: "9px 16px", borderRadius: 999, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.02)", color: C.textMuted, fontWeight: 500, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" },
  chipOn: { padding: "9px 16px", borderRadius: 999, border: `1px solid ${C.brassLine}`, background: C.brassSoft, color: C.brass, fontWeight: 600, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 },
  card: {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: 16,
    textDecoration: "none", color: "inherit", overflow: "hidden", minWidth: 0,
  },
  cover: { width: "100%", aspectRatio: "1", borderRadius: 14, border: `1px solid ${C.border}`, display: "grid", placeItems: "center" },
  title: {
    fontFamily: "Fraunces, Georgia, serif", fontSize: 17, marginTop: 12, color: C.text,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  meta: {
    fontSize: 13, color: C.textMuted, marginTop: 4,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  status: {
    marginTop: 10, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace", color: C.brass,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  list: { display: "flex", flexDirection: "column", gap: 2, width: "100%", minWidth: 0 },
  listRow: {
    display: "flex", alignItems: "center", gap: 14, padding: "12px 8px", borderRadius: 14,
    textDecoration: "none", color: "inherit", border: "1px solid transparent",
    minWidth: 0, overflow: "hidden",
  },
  listCover: {
    width: 52, height: 52, borderRadius: 11, flexShrink: 0, border: `1px solid ${C.border}`,
    display: "grid", placeItems: "center",
  },
  listTitle: {
    fontFamily: "Fraunces, Georgia, serif", fontSize: 15.5, color: C.text,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listMeta: {
    fontSize: 12.5, color: C.textMuted, marginTop: 3,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  listRight: {
    fontSize: 12, color: C.textFaint, fontFamily: "'IBM Plex Mono', monospace",
    flexShrink: 0, marginLeft: 8, maxWidth: 72,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  empty: { padding: "36px 20px", textAlign: "center", borderRadius: 18, border: `1px solid ${C.border}`, background: C.surface },
  emptyTitle: { fontFamily: "Fraunces, Georgia, serif", fontSize: 18, marginBottom: 8 },
  bottomNav: { position: "fixed", left: 0, right: 0, bottom: 0, height: 74, paddingBottom: "env(safe-area-inset-bottom)", background: "rgba(11,10,15,0.94)", backdropFilter: "blur(16px)", borderTop: `1px solid ${C.border}`, zIndex: 50, alignItems: "stretch", justifyContent: "space-around" },
  bottomItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 10.5, fontFamily: "inherit", background: "transparent", border: "none", cursor: "pointer", paddingBottom: 8 },
};

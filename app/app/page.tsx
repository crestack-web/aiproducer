"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const C = {
  bg: "#0B0A0F",
  bgDeep: "#050508",
  surface: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.09)",
  brass: "#E7A961",
  brassSoft: "rgba(231,169,97,0.15)",
  brassLine: "rgba(231,169,97,0.55)",
  text: "#F4F1EC",
  textMuted: "#9B96A3",
  textFaint: "#5C5866",
};

type Project = { id: string; title: string; status: string; genre: string | null; mood: string | null; updated_at: string };
type Tab = "home" | "library" | "profile";

function IconHome({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.5v-6h-3v6H5a1 1 0 0 1-1-1v-9.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function IconStudio({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v10.5a3.5 3.5 0 1 1-2-3.175V3h2Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 7v2.5a2.5 2.5 0 1 0 2-2.45V7h-2Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function IconLibrary({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m16 6 4 14M12 6v14M8 8v12M4 4v16" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconProfile({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="9" r="3.5" stroke={color} strokeWidth="1.8" />
      <path d="M5.5 19.5c1.2-3 3.4-4.5 6.5-4.5s5.3 1.5 6.5 4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AppInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userName, setUserName] = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "library" || t === "profile" || t === "home") setTab(t);
    if (t === "create" || t === "studio") router.replace("/app/studio");
  }, [searchParams, router]);

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
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
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

  function go(key: string) {
    if (key === "studio") router.push("/app/studio");
    else if (key === "home") {
      setTab("home");
      router.replace("/app");
    } else if (key === "library") {
      setTab("library");
      router.replace("/app?tab=library");
    } else if (key === "profile") {
      setTab("profile");
      router.replace("/app?tab=profile");
    }
  }

  const nav = [
    { key: "home", label: "Home", Icon: IconHome },
    { key: "studio", label: "Studio", Icon: IconStudio },
    { key: "library", label: "Library", Icon: IconLibrary },
    { key: "profile", label: "Profile", Icon: IconProfile },
  ];

  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div style={S.shell}>
      <style>{`
        .studio-bottom-nav { display: none; }
        @media (max-width: 860px) {
          .studio-sidebar { display: none !important; }
          .studio-bottom-nav { display: flex !important; }
          .studio-main-inner { padding: 24px 16px 100px !important; }
        }
      `}</style>

      <aside className="studio-sidebar" style={S.sidebar}>
        <div style={S.brand}>
          <img src="/logo.svg" alt="" width={18} height={18} style={{ borderRadius: 4, marginRight: 8 }} />
          STUDIO
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {nav.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button key={key} type="button" onClick={() => go(key)} style={{ ...S.navItem, ...(active ? S.navActive : {}) }}>
                <Icon size={18} color={active ? C.brass : C.textMuted} /> {label}
              </button>
            );
          })}
        </nav>
        <div style={S.sideCard}>
          <div style={{ fontSize: 12, color: C.textFaint, marginBottom: 6 }}>AI Producer</div>
          <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.4 }}>Your voice. Guided. Finished.</div>
          <button type="button" onClick={() => router.push("/app/studio")} style={S.sideCta}>
            New song
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0 28px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={S.avatar}>{initials || "A"}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{userName}</div>
            <button type="button" onClick={signOut} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 12, cursor: "pointer", padding: 0 }}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main style={S.main}>
        <div className="studio-main-inner" style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px 64px" }}>
          {tab === "home" && (
            <>
              <div style={S.eyebrow}>◆ STUDIO</div>
              <h1 style={S.h1}>
                Make music.
                <br />
                With your voice.
              </h1>
              <p style={S.sub}>Create a beat, then let your AI producer guide you until you have a finished song.</p>
              <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
                <button type="button" style={S.primary} onClick={() => router.push("/app/studio")}>
                  Create a song
                </button>
                <button type="button" style={S.secondary} onClick={() => go("library")}>
                  Explore my songs
                </button>
              </div>
              <div style={{ marginTop: 36, fontSize: 12, fontWeight: 600, letterSpacing: 1.2, color: C.textFaint, textTransform: "uppercase" }}>Recent projects</div>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.length === 0 && (
                  <p style={{ color: C.textMuted, fontSize: 14 }}>No songs yet — start from Studio.</p>
                )}
                {projects.slice(0, 12).map((p) => (
                  <Link key={p.id} href={`/app/projects/${p.id}`} style={S.row}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.title}</div>
                      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
                        {p.status} · {[p.genre, p.mood].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span style={{ color: C.brass, fontSize: 13, fontWeight: 600 }}>Open</span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {tab === "library" && (
            <>
              <div style={S.eyebrow}>◆ LIBRARY</div>
              <h1 style={S.h1}>Your library</h1>
              <p style={S.sub}>Songs and sessions in one place.</p>
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
                {!loading && projects.length === 0 && <p style={{ color: C.textMuted }}>Nothing here yet.</p>}
                {projects.map((p) => (
                  <Link key={p.id} href={`/app/projects/${p.id}`} style={S.row}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.title}</div>
                      <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>{p.status}</div>
                    </div>
                    <span style={{ color: C.brass, fontSize: 13, fontWeight: 600 }}>Open</span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {tab === "profile" && (
            <div style={{ textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
              <div style={S.eyebrow}>◆ PROFILE</div>
              <div style={{ ...S.avatar, width: 72, height: 72, fontSize: 24, margin: "16px auto" }}>{initials || "A"}</div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 22 }}>{userName}</div>
              <p style={{ color: C.textMuted, marginTop: 8 }}>
                {projects.length} session{projects.length === 1 ? "" : "s"}
              </p>
              <button type="button" style={{ ...S.secondary, marginTop: 24 }} onClick={signOut}>
                Log out
              </button>
            </div>
          )}
        </div>
      </main>

      <nav className="studio-bottom-nav" style={S.bottomNav}>
        {nav.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => go(key)}
              style={{ ...S.bottomItem, color: active ? C.brass : C.textFaint, fontWeight: active ? 600 : 500 }}
            >
              <Icon size={22} color={active ? C.brass : C.textFaint} />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function StudioAppPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#050508", color: "#9B96A3", display: "grid", placeItems: "center" }}>Loading…</div>}>
      <AppInner />
    </Suspense>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell: { height: "100vh", maxHeight: "100dvh", display: "flex", background: C.bgDeep, color: C.text, fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden" },
  sidebar: { width: 200, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", padding: "24px 12px 0", borderRight: "1px solid rgba(255,255,255,0.06)", background: C.bgDeep },
  brand: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: 2, color: C.brass, marginBottom: 28, paddingLeft: 8, display: "flex", alignItems: "center" },
  navItem: { padding: "10px 12px", borderRadius: 10, fontSize: 14, fontWeight: 500, color: C.textMuted, border: "1px solid transparent", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit", width: "100%", display: "flex", alignItems: "center", gap: 10 },
  navActive: { background: C.brassSoft, border: `1px solid ${C.brassLine}`, color: C.brass, fontWeight: 600 },
  sideCard: { marginTop: "auto", padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 12 },
  sideCta: { marginTop: 10, width: "100%", padding: "9px 12px", borderRadius: 10, border: "none", background: `linear-gradient(180deg, #F0BC80, ${C.brass})`, color: "#1A1208", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  avatar: { width: 36, height: 36, borderRadius: 999, background: `linear-gradient(145deg, ${C.brass}, #6B3F17)`, color: "#1A1208", display: "grid", placeItems: "center", fontFamily: "Georgia, serif", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  main: { flex: 1, minWidth: 0, height: "100%", overflowY: "auto", background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgDeep} 45%)` },
  eyebrow: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: 2.5, color: C.brass, marginBottom: 12 },
  h1: { fontFamily: "Georgia, serif", fontSize: "clamp(1.85rem, 4vw, 2.75rem)", lineHeight: 1.08, fontWeight: 500, margin: 0 },
  sub: { fontSize: 15.5, color: C.textMuted, marginTop: 14, lineHeight: 1.55, maxWidth: 440 },
  primary: { padding: "14px 20px", borderRadius: 14, border: "none", background: `linear-gradient(180deg, #F0BC80, ${C.brass})`, color: "#1A1208", fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: "inherit" },
  secondary: { padding: "13px 18px", borderRadius: 14, border: `1px solid ${C.border}`, background: "rgba(255,255,255,0.04)", color: C.text, fontWeight: 500, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderRadius: 14, background: C.surface, border: `1px solid ${C.border}`, textDecoration: "none", color: C.text },
  bottomNav: { position: "fixed", left: 0, right: 0, bottom: 0, height: 74, paddingBottom: "env(safe-area-inset-bottom)", background: "rgba(11,10,15,0.94)", backdropFilter: "blur(16px)", borderTop: `1px solid ${C.border}`, zIndex: 50, alignItems: "stretch", justifyContent: "space-around" },
  bottomItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 10.5, fontFamily: "inherit", background: "transparent", border: "none", cursor: "pointer", paddingBottom: 8 },
};

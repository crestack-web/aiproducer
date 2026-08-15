"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Project = {
  id: string;
  title: string;
  status: string;
  genre: string | null;
  mood: string | null;
  updated_at: string;
};

export default function StudioAppPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("Artist");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genre, setGenre] = useState("R&B");
  const [mood, setMood] = useState("Emotional");

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
        .select("display_name, genre, role, experience_level")
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
          title: `${mood} ${genre}`,
          genre,
          mood,
          tempo: 90,
        }),
      });
      if (!createRes.ok) {
        const j = await createRes.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Could not create project");
      }
      const { project } = await createRes.json();

      const beatRes = await fetch(`/api/projects/${project.id}/generate-beat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre, mood, tempo: 90 }),
      });
      if (!beatRes.ok) {
        const j = await beatRes.json().catch(() => ({}));
        throw new Error(j.error || "Beat generation failed");
      }

      const analyzeRes = await fetch(`/api/projects/${project.id}/analyze`, {
        method: "POST",
      });
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

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.logo}>◆ Studio</div>
        <div style={styles.headerRight}>
          <span style={styles.user}>{userName}</span>
          <button type="button" style={styles.ghost} onClick={signOut}>
            Log out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <h1 style={styles.h1}>Make music with your voice</h1>
        <p style={styles.sub}>
          Create a beat → AI producer plan → guided recording → mix &amp; master.
        </p>

        <section style={styles.card}>
          <h2 style={styles.h2}>New song</h2>
          <div style={styles.row}>
            <label style={styles.label}>
              Genre
              <select style={styles.select} value={genre} onChange={(e) => setGenre(e.target.value)}>
                {["R&B", "Afrobeats", "Hip-Hop", "Pop", "Amapiano", "Gospel"].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              Mood
              <select style={styles.select} value={mood} onChange={(e) => setMood(e.target.value)}>
                {["Emotional", "Confident", "Dark", "Romantic", "Energetic", "Chill"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button type="button" style={styles.primary} disabled={creating} onClick={createAndGenerate}>
            {creating ? "Creating beat & plan…" : "Start producer session"}
          </button>
          <p style={styles.hint}>Uses DEV_MODE mock beat + blueprint when enabled (no paid APIs).</p>
        </section>

        <section style={{ marginTop: 36 }}>
          <h2 style={styles.h2}>Your projects</h2>
          {loading && <p style={styles.sub}>Loading…</p>}
          {!loading && projects.length === 0 && (
            <p style={styles.sub}>No projects yet — start your first song above.</p>
          )}
          <div style={styles.list}>
            {projects.map((p) => (
              <Link key={p.id} href={`/app/projects/${p.id}`} style={styles.project}>
                <div>
                  <strong>{p.title}</strong>
                  <div style={styles.meta}>
                    {p.genre || "—"} · {p.status}
                  </div>
                </div>
                <span style={styles.chev}>→</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#050508", color: "#F4F1EC", fontFamily: "Inter, system-ui, sans-serif" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.09)",
  },
  logo: { fontWeight: 600, color: "#7BEBD4" },
  headerRight: { display: "flex", gap: 12, alignItems: "center" },
  user: { color: "#9B96A3", fontSize: 14 },
  ghost: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.16)",
    color: "#F4F1EC",
    borderRadius: 999,
    padding: "8px 14px",
    cursor: "pointer",
  },
  main: { maxWidth: 720, margin: "0 auto", padding: "40px 24px 80px" },
  h1: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "2.2rem", margin: "0 0 10px" },
  sub: { color: "#9B96A3", marginBottom: 28, lineHeight: 1.5 },
  card: {
    padding: 24,
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.04)",
  },
  h2: { fontSize: 18, margin: "0 0 16px" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 },
  label: { display: "block", fontSize: 13, color: "#9B96A3", fontWeight: 500 },
  select: {
    display: "block",
    width: "100%",
    marginTop: 8,
    padding: "12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "#0B0A0F",
    color: "#F4F1EC",
  },
  primary: {
    width: "100%",
    padding: "14px 18px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(180deg, #F0BC80, #E7A961)",
    color: "#1A1208",
    fontWeight: 600,
    cursor: "pointer",
  },
  hint: { marginTop: 12, fontSize: 12.5, color: "#5C5866" },
  error: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,107,107,0.1)",
    color: "#ffb4b4",
    fontSize: 13.5,
  },
  list: { display: "grid", gap: 10, marginTop: 12 },
  project: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.03)",
    color: "inherit",
    textDecoration: "none",
  },
  meta: { fontSize: 13, color: "#9B96A3", marginTop: 4 },
  chev: { color: "#E7A961" },
};

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Task = {
  id: string;
  type: string;
  instruction: string;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
  metadata?: { section_label?: string };
};

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [statusRes, beatRes, tasksRes] = await Promise.all([
          fetch(`/api/projects/${id}/status`),
          fetch(`/api/projects/${id}/beat`),
          fetch(`/api/projects/${id}/recording-tasks`),
        ]);

        if (statusRes.ok) {
          const j = await statusRes.json();
          setStatus(j.project?.status || "");
        }
        if (beatRes.ok) {
          const j = await beatRes.json();
          setBeatUrl(j.audio_url || null);
        }
        if (tasksRes.ok) {
          const j = await tasksRes.json();
          setTasks(j.tasks || []);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load project");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <Link href="/app" style={styles.back}>
          ← Projects
        </Link>
        <span style={styles.badge}>{status || "…"}</span>
      </header>

      <main style={styles.main}>
        <h1 style={styles.h1}>Producer session</h1>
        <p style={styles.sub}>Beat, plan, and recording tasks from the backend.</p>

        {loading && <p style={styles.sub}>Loading…</p>}
        {error && <div style={styles.error}>{error}</div>}

        <section style={styles.card}>
          <h2 style={styles.h2}>Instrumental</h2>
          {beatUrl ? (
            <audio controls src={beatUrl} style={{ width: "100%" }} />
          ) : (
            <p style={styles.sub}>No beat audio URL yet.</p>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <h2 style={styles.h2}>Recording plan</h2>
          <div style={styles.list}>
            {tasks.map((t, i) => (
              <div key={t.id} style={styles.task}>
                <div style={styles.num}>{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <strong>
                    {(t.metadata as { section_label?: string })?.section_label || "Section"} · {t.type}
                  </strong>
                  <p style={styles.instruction}>{t.instruction}</p>
                  <span style={styles.meta}>
                    {t.required ? "Required" : "Optional"} · {t.status}
                  </span>
                </div>
              </div>
            ))}
            {!loading && tasks.length === 0 && (
              <p style={styles.sub}>No tasks — run analyze on this project.</p>
            )}
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
  back: { color: "#9B96A3", textDecoration: "none", fontSize: 14 },
  badge: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#E7A961",
    background: "rgba(231,169,97,0.15)",
    padding: "6px 10px",
    borderRadius: 999,
  },
  main: { maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px" },
  h1: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "2rem", margin: "0 0 8px" },
  sub: { color: "#9B96A3", marginBottom: 20, lineHeight: 1.5 },
  card: {
    padding: 20,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.04)",
  },
  h2: { fontSize: 16, margin: "0 0 12px" },
  list: { display: "grid", gap: 10 },
  task: {
    display: "flex",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.03)",
  },
  num: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "rgba(231,169,97,0.15)",
    color: "#E7A961",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  instruction: { color: "#9B96A3", fontSize: 13.5, margin: "4px 0 6px", lineHeight: 1.4 },
  meta: { fontSize: 12, color: "#5C5866" },
  error: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,107,107,0.1)",
    color: "#ffb4b4",
  },
};

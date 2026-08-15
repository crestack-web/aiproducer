"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  reason?: string | null;
  status: string;
  required: boolean;
  metadata?: { section_label?: string; vocal_part?: string; production_type?: string };
};

/** Producer session — NOT a DAW. One task at a time. */
export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [beatUrl, setBeatUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"task" | "review" | "done">("task");
  const [producerNote, setProducerNote] = useState(
    "I'll guide you one part at a time. You just listen and perform."
  );

  const load = useCallback(async () => {
    try {
      const [statusRes, beatRes, tasksRes] = await Promise.all([
        fetch(`/api/projects/${id}/status`),
        fetch(`/api/projects/${id}/beat`),
        fetch(`/api/projects/${id}/recording-tasks`),
      ]);
      if (statusRes.ok) setStatus((await statusRes.json()).project?.status || "");
      if (beatRes.ok) setBeatUrl((await beatRes.json()).audio_url || null);
      if (tasksRes.ok) setTasks((await tasksRes.json()).tasks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = useMemo(
    () => tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
    [tasks]
  );
  const current = pending[0] || null;

  function markComplete() {
    if (!current) return;
    setTasks((prev) => prev.map((t) => (t.id === current.id ? { ...t, status: "completed" } : t)));
    const left = pending.filter((t) => t.id !== current.id);
    if (left.length === 0) {
      setPhase("done");
      setProducerNote("That's enough. Let's put everything together.");
      return;
    }
    setProducerNote("Got it. Here's what the song needs next.");
    setPhase("task");
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <p style={styles.sub}>Loading your producer session…</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <Link href="/app" style={styles.back}>
          ← Projects
        </Link>
        <span style={styles.badge}>{status || "session"}</span>
      </header>
      <main style={styles.main}>
        <p style={styles.producer}>{producerNote}</p>
        {error && <div style={styles.error}>{error}</div>}
        {beatUrl && (
          <section style={styles.card}>
            <div style={styles.cardLabel}>Your beat</div>
            <audio controls src={beatUrl} style={{ width: "100%" }} />
          </section>
        )}
        {phase === "done" || !current ? (
          <section style={styles.focus}>
            <h1 style={styles.h1}>Your performances are in</h1>
            <p style={styles.sub}>
              Next we arrange, clean, mix, and master — you don't need a mixer.
            </p>
            <div style={{ color: "#7BEBD4" }}>
              {tasks.filter((t) => t.status === "completed").length} of {tasks.length} parts captured
            </div>
          </section>
        ) : phase === "review" ? (
          <section style={styles.focus}>
            <div style={styles.cardLabel}>{current.metadata?.section_label || "Section"}</div>
            <h1 style={styles.h1}>Nice. Let's hear it.</h1>
            <p style={styles.sub}>Keep it if it feels right — or try again.</p>
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} onClick={() => setPhase("task")}>
                Try again
              </button>
              <button type="button" style={styles.primary} onClick={markComplete}>
                Keep & continue
              </button>
            </div>
          </section>
        ) : (
          <section style={styles.focus}>
            <div style={styles.cardLabel}>
              {current.metadata?.section_label || "Section"}
              {current.required ? " · essential" : " · optional"}
            </div>
            <h1 style={styles.h1}>{current.title || current.type}</h1>
            <p style={styles.instruction}>{current.instruction}</p>
            {current.reason && <p style={styles.reason}>{current.reason}</p>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondary} disabled={!beatUrl}>
                Hear section
              </button>
              <button type="button" style={styles.primary} onClick={() => setPhase("review")}>
                Record
              </button>
            </div>
            <p style={styles.hint}>{pending.length} left in plan</p>
          </section>
        )}
        <section style={{ marginTop: 36 }}>
          <h2 style={styles.h2}>Session plan</h2>
          <div style={styles.list}>
            {tasks.map((t, i) => (
              <div key={t.id} style={{ ...styles.taskRow, opacity: t.status === "completed" ? 0.45 : 1 }}>
                <span style={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>
                    {t.title || t.type}
                    {t.status === "completed" ? " ✓" : ""}
                  </strong>
                  <div style={styles.meta}>
                    {t.metadata?.section_label || "—"} · {t.required ? "essential" : "if needed"}
                  </div>
                </div>
              </div>
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
  main: { maxWidth: 640, margin: "0 auto", padding: "28px 24px 80px" },
  producer: {
    color: "#7BEBD4",
    fontSize: 14.5,
    lineHeight: 1.5,
    marginBottom: 20,
    padding: "12px 14px",
    borderRadius: 14,
    background: "rgba(123,235,212,0.08)",
    border: "1px solid rgba(123,235,212,0.2)",
  },
  card: {
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.03)",
    marginBottom: 20,
  },
  cardLabel: {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#E7A961",
    fontWeight: 600,
    marginBottom: 10,
  },
  focus: {
    padding: 24,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
  },
  h1: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "1.85rem", margin: "0 0 12px" },
  instruction: { fontSize: 16, lineHeight: 1.5, marginBottom: 10 },
  reason: { fontSize: 13.5, color: "#9B96A3", lineHeight: 1.45, marginBottom: 20 },
  sub: { color: "#9B96A3", marginBottom: 16, lineHeight: 1.5 },
  actions: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 },
  primary: {
    flex: 1,
    minWidth: 120,
    padding: "14px 18px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(180deg, #F0BC80, #E7A961)",
    color: "#1A1208",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    padding: "14px 18px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    color: "#F4F1EC",
    cursor: "pointer",
  },
  hint: { marginTop: 14, fontSize: 12.5, color: "#5C5866" },
  h2: { fontSize: 15, margin: "0 0 8px", color: "#9B96A3", fontWeight: 600 },
  list: { display: "grid", gap: 8 },
  taskRow: {
    display: "flex",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(255,255,255,0.02)",
  },
  num: {
    width: 28,
    height: 28,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: "rgba(231,169,97,0.12)",
    color: "#E7A961",
    fontSize: 11,
    fontWeight: 700,
  },
  meta: { fontSize: 12, color: "#5C5866", marginTop: 2 },
  error: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,107,107,0.1)",
    color: "#ffb4b4",
  },
};

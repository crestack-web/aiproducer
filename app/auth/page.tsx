"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function AuthPage() {
  const router = useRouter();
  const search = useSearchParams();
  const initialMode = (search.get("mode") === "signup" ? "signup" : "login") as Mode;
  const nextPath = search.get("next") || "/onboarding";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const title = useMemo(
    () => (mode === "login" ? "Welcome back" : "Create your account"),
    [mode]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "signup") {
        if (!name.trim()) throw new Error("Enter an artist name.");
        const { data, error: signErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/auth?mode=login`,
          },
        });
        if (signErr) throw signErr;

        if (data.session) {
          await supabase.from("profiles").upsert({
            id: data.session.user.id,
            display_name: name.trim(),
          });
          router.push("/onboarding");
          router.refresh();
          return;
        }

        setError("Check your email to confirm your account, then log in.");
        setMode("login");
        return;
      }

      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (loginErr) throw loginErr;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Login failed.");

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, role, genre, experience_level")
        .eq("id", user.id)
        .maybeSingle();

      const needsOnboarding =
        !profile?.role || !profile?.genre || !profile?.experience_level;

      router.push(needsOnboarding ? "/onboarding" : nextPath === "/onboarding" ? "/app" : nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.shell}>
      <aside style={styles.brand}>
        <Link href="/" style={styles.logo}>
          <span style={styles.logoMark}>◆</span> Studio
        </Link>
        <div>
          <h1 style={styles.brandTitle}>
            Your voice.
            <br />
            <span style={styles.grad}>A finished song.</span>
          </h1>
          <p style={styles.brandText}>
            Log in to continue producer sessions, or create an account and ship your first
            radio-ready track.
          </p>
        </div>
        <p style={styles.foot}>You bring the voice. Studio helps you make the song.</p>
      </aside>

      <main style={styles.main}>
        <div style={styles.card}>
          <Link href="/" style={styles.back}>
            ← Back to Studio
          </Link>

          <div style={styles.tabs}>
            <button
              type="button"
              style={{ ...styles.tab, ...(mode === "login" ? styles.tabOn : {}) }}
              onClick={() => setMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              style={{ ...styles.tab, ...(mode === "signup" ? styles.tabOn : {}) }}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>

          <h2 style={styles.h2}>{title}</h2>
          <p style={styles.sub}>
            {mode === "login"
              ? "Continue your songs and producer sessions."
              : "Free includes 1 finished song so you can try the full producer flow."}
          </p>

          {error && <div style={styles.error}>{error}</div>}

          <form onSubmit={onSubmit}>
            {mode === "signup" && (
              <label style={styles.label}>
                Artist name
                <input
                  style={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="How should we call you?"
                  required
                />
              </label>
            )}
            <label style={styles.label}>
              Email
              <input
                style={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                required
              />
            </label>
            <label style={styles.label}>
              Password
              <input
                style={styles.input}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                minLength={6}
                required
              />
            </label>
            <button type="submit" style={styles.primary} disabled={loading}>
              {loading ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateColumns: "1.05fr 0.95fr",
    background: "#050508",
    color: "#F4F1EC",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  brand: {
    padding: "40px 48px",
    borderRight: "1px solid rgba(255,255,255,0.09)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  logo: { display: "flex", alignItems: "center", gap: 10, fontWeight: 600, textDecoration: "none", color: "inherit" },
  logoMark: { color: "#7BEBD4" },
  brandTitle: {
    fontFamily: "Fraunces, Georgia, serif",
    fontWeight: 500,
    fontSize: "2.4rem",
    lineHeight: 1.12,
    margin: "0 0 16px",
  },
  grad: {
    background: "linear-gradient(120deg, #7BEBD4, #a8f0e0 45%, #E7A961)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  },
  brandText: { color: "#9B96A3", fontSize: 15.5, lineHeight: 1.55, maxWidth: 420 },
  foot: { color: "#5C5866", fontSize: 13 },
  main: { display: "grid", placeItems: "center", padding: 24 },
  card: { width: "100%", maxWidth: 400 },
  back: { color: "#9B96A3", fontSize: 13.5, textDecoration: "none", display: "inline-block", marginBottom: 28 },
  tabs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 4,
    padding: 4,
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    marginBottom: 28,
  },
  tab: {
    padding: "10px 12px",
    borderRadius: 11,
    border: "none",
    background: "transparent",
    color: "#9B96A3",
    fontWeight: 600,
    cursor: "pointer",
  },
  tabOn: { background: "rgba(255,255,255,0.08)", color: "#F4F1EC" },
  h2: { fontFamily: "Fraunces, serif", fontWeight: 500, fontSize: "1.75rem", margin: "0 0 8px" },
  sub: { color: "#9B96A3", fontSize: 14.5, marginBottom: 24, lineHeight: 1.45 },
  error: {
    marginBottom: 14,
    padding: "11px 13px",
    borderRadius: 12,
    background: "rgba(255,107,107,0.1)",
    border: "1px solid rgba(255,107,107,0.25)",
    color: "#ffb4b4",
    fontSize: 13.5,
  },
  label: { display: "block", fontSize: 13, color: "#9B96A3", marginBottom: 16, fontWeight: 500 },
  input: {
    display: "block",
    width: "100%",
    marginTop: 8,
    padding: "13px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.04)",
    color: "#F4F1EC",
    fontSize: 15,
  },
  primary: {
    width: "100%",
    marginTop: 8,
    padding: "14px 18px",
    borderRadius: 999,
    border: "none",
    background: "linear-gradient(180deg, #F0BC80, #E7A961)",
    color: "#1A1208",
    fontWeight: 600,
    fontSize: 15,
    cursor: "pointer",
  },
};

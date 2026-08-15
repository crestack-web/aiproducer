"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ROLES = [
  { value: "singer", label: "Singer / songwriter", desc: "Melodies, hooks, full vocal performances" },
  { value: "rapper", label: "Rapper / MC", desc: "Bars, hooks, adlibs over beats" },
  { value: "both", label: "Both / hybrid", desc: "Sing and rap — flexible sessions" },
  { value: "creator", label: "Creator / content", desc: "Songs for social, YouTube, brand work" },
];
const GENRES = ["R&B", "Afrobeats", "Hip-Hop", "Pop", "Amapiano", "Gospel"];
const LEVELS = [
  { value: "beginner", label: "I’m new", desc: "I’ve never finished a full song in a studio" },
  { value: "some", label: "Some experience", desc: "I’ve recorded before, but mixing is hard" },
  { value: "pro", label: "I know my way around", desc: "I want speed and a clear producer plan" },
];

function errMsg(e: unknown): string {
  if (!e) return "Could not save profile";
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  const o = e as { message?: string; details?: string; hint?: string };
  if (o.message) return [o.message, o.details, o.hint].filter(Boolean).join(" — ");
  return "Could not save profile";
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [genre, setGenre] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = useMemo(() => {
    if (step === 0) return name.trim().length >= 2;
    if (step === 1) return !!role;
    if (step === 2) return !!genre;
    if (step === 3) return !!level;
    return false;
  }, [step, name, role, genre, level]);

  async function saveProfile(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    patch: Record<string, unknown>
  ) {
    // Profile is usually created by signup trigger — upsert on primary key only.
    const { error: upErr } = await supabase.from("profiles").upsert(
      { id: userId, ...patch },
      { onConflict: "id" }
    );
    if (!upErr) return;

    // Fallback: update only (never insert again — avoids profiles_pkey)
    const { error: updateErr } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (updateErr) throw updateErr;
    if (/duplicate key|profiles_pkey|23505/i.test(upErr.message || "")) return;
    // If upsert failed for another reason but update worked, we're fine
  }

  async function finish() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth?mode=login");
        return;
      }
      await saveProfile(supabase, user.id, {
        display_name: name.trim(),
        role,
        genre,
        experience_level: level,
        onboarding_completed_at: new Date().toISOString(),
      });
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  async function skip() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await saveProfile(supabase, user.id, {
          onboarding_completed_at: new Date().toISOString(),
        });
      }
      router.push("/app");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  const choice = (selected: boolean): React.CSSProperties => ({
    textAlign: "left",
    padding: 16,
    borderRadius: 16,
    border: selected ? "1px solid rgba(123,235,212,0.45)" : "1px solid rgba(255,255,255,0.09)",
    background: selected ? "rgba(123,235,212,0.14)" : "rgba(255,255,255,0.045)",
    color: "#F4F1EC",
    cursor: "pointer",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#050508", color: "#F4F1EC", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 64px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 36 }}>
          <Link href="/" style={{ color: "inherit", textDecoration: "none", fontWeight: 600 }}>◆ Studio</Link>
          <button type="button" onClick={skip} disabled={loading} style={{ background: "none", border: "none", color: "#9B96A3", cursor: "pointer" }}>Skip for now</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i <= step ? "linear-gradient(90deg, #7BEBD4, #E7A961)" : "rgba(255,255,255,0.08)" }} />
          ))}
        </div>

        {step === 0 && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E7A961", marginBottom: 12 }}>Step 1 of 4</div>
            <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "2rem", margin: "0 0 10px" }}>What should we call you?</h1>
            <p style={{ color: "#9B96A3", marginBottom: 28 }}>Your artist name inside Studio.</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nova Lane" style={{ width: "100%", padding: "13px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)", color: "#F4F1EC", fontSize: 15 }} />
          </section>
        )}
        {step === 1 && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E7A961", marginBottom: 12 }}>Step 2 of 4</div>
            <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "2rem", margin: "0 0 10px" }}>What do you make?</h1>
            <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
              {ROLES.map((r) => (
                <button key={r.value} type="button" style={choice(role === r.value)} onClick={() => setRole(r.value)}>
                  <strong style={{ display: "block" }}>{r.label}</strong>
                  <span style={{ fontSize: 13.5, color: "#9B96A3" }}>{r.desc}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 2 && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E7A961", marginBottom: 12 }}>Step 3 of 4</div>
            <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "2rem", margin: "0 0 10px" }}>What’s your lane?</h1>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
              {GENRES.map((g) => (
                <button key={g} type="button" style={choice(genre === g)} onClick={() => setGenre(g)}>
                  <strong>{g}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 3 && (
          <section>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#E7A961", marginBottom: 12 }}>Step 4 of 4</div>
            <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "2rem", margin: "0 0 10px" }}>How experienced are you?</h1>
            <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
              {LEVELS.map((l) => (
                <button key={l.value} type="button" style={choice(level === l.value)} onClick={() => setLevel(l.value)}>
                  <strong style={{ display: "block" }}>{l.label}</strong>
                  <span style={{ fontSize: 13.5, color: "#9B96A3" }}>{l.desc}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {error && <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(255,107,107,0.1)", color: "#ffb4b4" }}>{error}</div>}

        <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", gap: 10 }}>
          {step > 0 && (
            <button type="button" onClick={() => setStep((x) => x - 1)} style={{ padding: "13px 18px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.045)", color: "#F4F1EC", cursor: "pointer" }}>Back</button>
          )}
          <button
            type="button"
            disabled={!canContinue || loading}
            onClick={() => (step < 3 ? setStep((x) => x + 1) : finish())}
            style={{ flex: 1, padding: "14px 18px", borderRadius: 999, border: "none", background: "linear-gradient(180deg, #F0BC80, #E7A961)", color: "#1A1208", fontWeight: 600, cursor: "pointer", opacity: !canContinue || loading ? 0.5 : 1 }}
          >
            {loading ? "Saving…" : step === 3 ? "Enter Studio" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

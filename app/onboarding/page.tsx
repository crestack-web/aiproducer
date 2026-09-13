"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STUDIO_LOGO_URL } from "@/lib/brand";

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

const STEP_META = [
  { kicker: "Step 1 of 4", title: "What should we call you?", sub: "Your artist name appears on sessions and masters." },
  { kicker: "Step 2 of 4", title: "What do you make?", sub: "So AP knows how to plan your vocal layers." },
  { kicker: "Step 3 of 4", title: "What’s your lane?", sub: "Genre shapes the production decisions." },
  { kicker: "Step 4 of 4", title: "How experienced are you?", sub: "We’ll match guidance to your level." },
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
    const { error: upErr } = await supabase.from("profiles").upsert(
      { id: userId, ...patch },
      { onConflict: "id" }
    );
    if (!upErr) return;

    const { error: updateErr } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (updateErr) throw updateErr;
    if (/duplicate key|profiles_pkey|23505/i.test(upErr.message || "")) return;
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

  const meta = STEP_META[step];

  return (
    <>
      <style>{css}</style>
      <div className="ob-root">
        <div className="ob-shell">
          <header className="ob-header">
            <Link href="/" className="ob-logo">
              <img src={STUDIO_LOGO_URL} alt="" width={24} height={24} />
              AP Studio
            </Link>
            <button type="button" className="ob-skip" onClick={() => void skip()} disabled={loading}>
              Skip for now
            </button>
          </header>

          <div className="ob-progress" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i <= step ? "ob-bar on" : "ob-bar"} />
            ))}
          </div>

          <section className="ob-body">
            <p className="ob-kicker">{meta.kicker}</p>
            <h1 className="ob-title">{meta.title}</h1>
            <p className="ob-sub">{meta.sub}</p>

            {step === 0 && (
              <label className="ob-field">
                Artist name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Nova"
                  autoComplete="nickname"
                  autoFocus
                />
              </label>
            )}

            {step === 1 && (
              <div className="ob-choices">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={role === r.value ? "ob-choice on" : "ob-choice"}
                    onClick={() => setRole(r.value)}
                  >
                    <strong>{r.label}</strong>
                    <span>{r.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {step === 2 && (
              <div className="ob-genres">
                {GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={genre === g ? "ob-chip on" : "ob-chip"}
                    onClick={() => setGenre(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="ob-choices">
                {LEVELS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    className={level === l.value ? "ob-choice on" : "ob-choice"}
                    onClick={() => setLevel(l.value)}
                  >
                    <strong>{l.label}</strong>
                    <span>{l.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {error && <div className="ob-error">{error}</div>}
          </section>

          <footer className="ob-footer">
            {step > 0 && (
              <button type="button" className="ob-back" onClick={() => setStep((x) => x - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className="ob-next"
              disabled={!canContinue || loading}
              onClick={() => (step < 3 ? setStep((x) => x + 1) : void finish())}
            >
              {loading ? "Saving…" : step === 3 ? "Enter Studio" : "Continue"}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

const css = `
.ob-root{
  min-height:100dvh;background:#0B0A0F;color:#F4F1EA;
  font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  display:flex;justify-content:center;
  background-image:
    radial-gradient(ellipse 70% 40% at 50% -10%, rgba(240,188,128,.12), transparent 55%),
    radial-gradient(ellipse 50% 30% at 100% 100%, rgba(123,235,212,.05), transparent 45%);
}
.ob-shell{
  width:100%;max-width:440px;min-height:100dvh;
  display:flex;flex-direction:column;padding:20px 22px 28px;box-sizing:border-box;
}
.ob-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}
.ob-logo{
  display:inline-flex;align-items:center;gap:10px;text-decoration:none;
  color:#F4F1EA;font-weight:600;font-size:14px;
}
.ob-logo img{border-radius:8px}
.ob-skip{
  background:none;border:none;color:#9B96A3;cursor:pointer;font-size:13px;font-family:inherit;padding:8px 0;
}
.ob-skip:disabled{opacity:.5}
.ob-progress{display:flex;gap:6px;margin-bottom:32px}
.ob-bar{
  flex:1;height:3px;border-radius:99px;background:rgba(255,255,255,.08);
  display:block;transition:background .2s;
}
.ob-bar.on{background:linear-gradient(90deg,#F0BC80,#E7A961)}
.ob-body{flex:1}
.ob-kicker{
  font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:#E7A961;margin:0 0 12px;
}
.ob-title{
  font-family:Georgia,"Times New Roman",serif;font-weight:500;
  font-size:clamp(1.65rem,5vw,2rem);line-height:1.2;margin:0 0 10px;letter-spacing:-0.02em;
}
.ob-sub{margin:0 0 28px;color:#9B96A3;font-size:14px;line-height:1.5}
.ob-field{
  display:flex;flex-direction:column;gap:8px;
  font-size:11px;font-weight:600;color:#9B96A3;letter-spacing:.06em;text-transform:uppercase;
}
.ob-field input{
  width:100%;padding:15px 16px;border-radius:14px;box-sizing:border-box;
  border:1px solid rgba(255,255,255,.1);background:#12101A;color:#F4F1EA;
  font-size:16px;font-family:inherit;font-weight:400;letter-spacing:0;text-transform:none;
  -webkit-appearance:none;appearance:none;
}
.ob-field input:focus{
  outline:none;border-color:rgba(240,188,128,.55);
  box-shadow:0 0 0 3px rgba(240,188,128,.12);
}
.ob-choices{display:grid;gap:10px}
.ob-choice{
  text-align:left;padding:16px 16px;border-radius:16px;cursor:pointer;font-family:inherit;
  border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);color:#F4F1EA;
  transition:border-color .15s,background .15s,box-shadow .15s;
}
.ob-choice strong{display:block;font-size:15px;font-weight:600;margin-bottom:4px}
.ob-choice span{font-size:13px;color:#9B96A3;line-height:1.4}
.ob-choice.on{
  border-color:rgba(240,188,128,.5);background:rgba(240,188,128,.1);
  box-shadow:0 0 0 1px rgba(240,188,128,.15);
}
.ob-genres{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ob-chip{
  padding:16px 12px;border-radius:14px;cursor:pointer;font-family:inherit;
  border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);
  color:#F4F1EA;font-weight:600;font-size:14px;
  transition:border-color .15s,background .15s;
}
.ob-chip.on{
  border-color:rgba(240,188,128,.5);background:rgba(240,188,128,.12);
  color:#F0BC80;
}
.ob-error{
  margin-top:16px;padding:12px 14px;border-radius:12px;
  background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);color:#FCA5A5;font-size:13px;
}
.ob-footer{display:flex;gap:10px;padding-top:28px;margin-top:auto}
.ob-back{
  padding:14px 18px;border-radius:999px;cursor:pointer;font-family:inherit;
  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#F4F1EA;font-weight:600;
}
.ob-next{
  flex:1;padding:15px 18px;border-radius:999px;border:none;cursor:pointer;font-family:inherit;
  background:linear-gradient(180deg,#F0BC80,#E7A961);color:#1A1208;font-weight:700;font-size:15px;
  box-shadow:0 8px 24px rgba(231,169,97,.25);
}
.ob-next:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}
@media (min-width:520px){
  .ob-shell{padding:32px 28px 40px;min-height:auto;margin:40px 0;border-radius:24px;
    border:1px solid rgba(255,255,255,.07);background:rgba(12,11,16,.85);
    box-shadow:0 24px 64px rgba(0,0,0,.35)}
  .ob-root{align-items:center;padding:0 20px}
}
`;

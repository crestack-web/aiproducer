"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STUDIO_LOGO_URL } from "@/lib/brand";

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
  const [oauthBusy, setOauthBusy] = useState(false);

  async function continueWithGoogle() {
    setOauthBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (oauthErr) throw oauthErr;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setOauthBusy(false);
    }
  }

  const [loading, setLoading] = useState(false);

  const title = useMemo(
    () => (mode === "login" ? "Welcome back" : "Start creating"),
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
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
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
      const needsOnboarding = !profile?.role || !profile?.genre || !profile?.experience_level;
      router.push(needsOnboarding ? "/onboarding" : nextPath === "/onboarding" ? "/app" : nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{css}</style>
      <div className="auth-root">
        <aside className="auth-brand-panel" aria-hidden={false}>
          <Link href="/" className="auth-mark">
            <img src={STUDIO_LOGO_URL} alt="" width={36} height={36} />
            <span>AP Studio</span>
          </Link>
          <div className="auth-brand-copy">
            <h1>
              Your voice.
              <br />
              <em>Produced.</em>
            </h1>
            <p>
              Record on your device. AP mixes and masters with you — so the song still sounds like you.
            </p>
          </div>
          <p className="auth-brand-foot">Artist-first production · Not another AI singer</p>
        </aside>

        <main className="auth-form-panel">
          <div className="auth-form-inner">
            <div className="auth-top-mobile">
              <Link href="/">
                <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} />
                AP Studio
              </Link>
              <Link
                href={mode === "login" ? "/auth?mode=signup" : "/auth?mode=login"}
                className="auth-switch-link"
                onClick={(e) => {
                  e.preventDefault();
                  setMode(mode === "login" ? "signup" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? (
                  <>
                    New here? <strong>Sign up</strong>
                  </>
                ) : (
                  <>
                    Have an account? <strong>Log in</strong>
                  </>
                )}
              </Link>
            </div>

            <div className="auth-card">
              <div className="auth-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  className={mode === "login" ? "auth-tab on" : "auth-tab"}
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  Log in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  className={mode === "signup" ? "auth-tab on" : "auth-tab"}
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                  }}
                >
                  Sign up
                </button>
              </div>

              <h2>{title}</h2>
              <p className="auth-sub">
                {mode === "login"
                  ? "Pick up where you left off — sessions, takes, and masters."
                  : "Create an account in a minute. Finish songs when you’re ready."}
              </p>

              {error && <div className="auth-error">{error}</div>}

              <form onSubmit={onSubmit}>
                {mode === "signup" && (
                  <label className="auth-field">
                    Artist name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="How should we call you?"
                      autoComplete="nickname"
                      required
                    />
                  </label>
                )}
                <label className="auth-field">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <label className="auth-field">
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    minLength={6}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                  />
                </label>
                
                <button
                  type="button"
                  className="auth-google"
                  onClick={() => void continueWithGoogle()}
                  disabled={oauthBusy || loading}
                >
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"/>
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.5 7.3l6.2 5.2C38.9 37.1 44 31.3 44 24c0-1.3-.1-2.5-.4-3.5z"/>
                  </svg>
                  {oauthBusy ? "Connecting…" : "Continue with Google"}
                </button>
                <div className="auth-or"><span>or</span></div>
<button type="submit" className="auth-primary" disabled={loading}>
                  {loading ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}
                </button>
              </form>
            </div>

            <p className="auth-foot-mobile">You bring the voice. AP helps you make the song.</p>
          </div>
        </main>
      </div>
    </>
  );
}

const css = `
.auth-root{
  min-height:100dvh;display:grid;grid-template-columns:1fr;
  background:#0B0A0F;color:#F4F1EA;
  font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
}
.auth-brand-panel{
  display:none;position:relative;overflow:hidden;
  background:
    radial-gradient(ellipse 80% 60% at 15% 15%, rgba(240,188,128,.2), transparent 55%),
    radial-gradient(ellipse 60% 45% at 95% 85%, rgba(123,235,212,.07), transparent 50%),
    linear-gradient(165deg, #14121C 0%, #0B0A0F 50%, #0E0C14 100%);
  padding:48px 44px;flex-direction:column;justify-content:space-between;
}
.auth-mark{display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:#F4F1EA;position:relative;z-index:1}
.auth-mark img{border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.35)}
.auth-mark span{font-weight:600;letter-spacing:.02em;font-size:15px}
.auth-brand-copy{position:relative;z-index:1;max-width:380px}
.auth-brand-copy h1{
  font-family:Georgia,"Times New Roman",serif;font-weight:500;
  font-size:clamp(2.1rem,3.8vw,2.9rem);line-height:1.12;margin:0 0 18px;letter-spacing:-0.025em;
}
.auth-brand-copy h1 em{font-style:italic;color:#F0BC80}
.auth-brand-copy p{margin:0;color:#9B96A3;font-size:15px;line-height:1.6}
.auth-brand-foot{position:relative;z-index:1;font-size:12px;color:#5C5866;letter-spacing:.02em}
.auth-form-panel{
  display:flex;flex-direction:column;justify-content:center;
  padding:28px 22px 40px;min-height:100dvh;
}
.auth-form-inner{width:100%;max-width:400px;margin:0 auto}
.auth-top-mobile{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}
.auth-top-mobile a{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#F4F1EA;font-weight:600;font-size:14px}
.auth-top-mobile a img{border-radius:8px}
.auth-switch-link{font-size:13px;color:#9B96A3;text-decoration:none}
.auth-switch-link strong{color:#F0BC80;font-weight:600}
.auth-card{
  background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.08);
  border-radius:24px;padding:28px 24px 26px;
  box-shadow:0 24px 48px rgba(0,0,0,.22);
}
.auth-tabs{
  display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:999px;
  background:#16141C;border:1px solid rgba(255,255,255,.06);margin-bottom:22px;
}
.auth-tab{
  border:none;background:transparent;color:#9B96A3;padding:11px 12px;border-radius:999px;
  font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s,color .15s;
}
.auth-tab.on{
  background:linear-gradient(180deg,#F0BC80,#E7A961);color:#1A1208;
  box-shadow:0 2px 10px rgba(231,169,97,.35);
}
.auth-card h2{
  font-family:Georgia,"Times New Roman",serif;font-weight:500;
  font-size:1.7rem;margin:0 0 8px;letter-spacing:-0.02em;line-height:1.2;
}
.auth-sub{margin:0 0 20px;color:#9B96A3;font-size:14px;line-height:1.5}
.auth-error{
  background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);
  color:#FCA5A5;padding:12px 14px;border-radius:12px;font-size:13px;margin-bottom:16px;
}
.auth-field{
  display:flex;flex-direction:column;gap:8px;margin-bottom:14px;
  font-size:11px;font-weight:600;color:#9B96A3;letter-spacing:.06em;text-transform:uppercase;
}
.auth-field input{
  width:100%;padding:14px 16px;border-radius:14px;
  border:1px solid rgba(255,255,255,.1);background:#12101A;color:#F4F1EA;
  font-size:16px;font-family:inherit;box-sizing:border-box;
  -webkit-appearance:none;appearance:none;text-transform:none;letter-spacing:0;font-weight:400;
  transition:border-color .15s,box-shadow .15s;
}
.auth-field input::placeholder{color:#5C5866}
.auth-field input:focus{
  outline:none;border-color:rgba(240,188,128,.55);
  box-shadow:0 0 0 3px rgba(240,188,128,.12);
}
.auth-google{
  width:100%;display:flex;align-items:center;justify-content:center;gap:10px;
  padding:13px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.05);color:#F4F1EC;font-weight:600;font-size:14px;
  font-family:inherit;cursor:pointer;margin-bottom:4px;
}
.auth-google:hover{background:rgba(255,255,255,.09)}
.auth-google:disabled{opacity:.6;cursor:wait}
.auth-or{display:flex;align-items:center;gap:12px;margin:14px 0 10px;color:#5C5866;font-size:12px}
.auth-or::before,.auth-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.1)}
.auth-or span{flex-shrink:0}
.auth-primary{
  width:100%;margin-top:10px;padding:15px 18px;border-radius:999px;border:none;
  background:linear-gradient(180deg,#F0BC80,#E7A961);color:#1A1208;
  font-weight:700;font-size:15px;cursor:pointer;font-family:inherit;box-sizing:border-box;
  box-shadow:0 8px 24px rgba(231,169,97,.28);
}
.auth-primary:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
.auth-foot-mobile{display:block;margin-top:28px;text-align:center;font-size:12px;color:#5C5866;line-height:1.5}
@media (min-width:900px){
  .auth-root{grid-template-columns:minmax(0,1.1fr) minmax(420px,0.9fr)}
  .auth-brand-panel{display:flex;padding:56px 52px}
  .auth-form-panel{
    padding:56px 48px 56px;
    min-height:auto;
    border-left:1px solid rgba(255,255,255,.06);
    align-items:center;
  }
  .auth-form-inner{max-width:420px}
  .auth-top-mobile{display:none}
  .auth-card{
    background:rgba(255,255,255,.03);
    border:1px solid rgba(255,255,255,.08);
    border-radius:20px;
    box-shadow:0 20px 50px rgba(0,0,0,.28);
    padding:36px 32px 32px;
  }
  .auth-card h2{font-size:1.85rem;margin-bottom:10px}
  .auth-sub{font-size:14.5px;margin-bottom:24px}
  .auth-tabs{margin-bottom:26px}
  .auth-field{margin-bottom:16px;gap:9px}
  .auth-field input{
    padding:15px 16px;
    border-radius:12px;
    border:1px solid rgba(255,255,255,.12);
    background:#0E0C14;
    transition:border-color .15s,box-shadow .15s,background .15s;
  }
  .auth-field input:hover{border-color:rgba(255,255,255,.18)}
  .auth-field input:focus{
    border-color:rgba(240,188,128,.55);
    box-shadow:0 0 0 4px rgba(240,188,128,.12);
    background:#12101A;
  }
  .auth-google{
  width:100%;display:flex;align-items:center;justify-content:center;gap:10px;
  padding:13px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.05);color:#F4F1EC;font-weight:600;font-size:14px;
  font-family:inherit;cursor:pointer;margin-bottom:4px;
}
.auth-google:hover{background:rgba(255,255,255,.09)}
.auth-google:disabled{opacity:.6;cursor:wait}
.auth-or{display:flex;align-items:center;gap:12px;margin:14px 0 10px;color:#5C5866;font-size:12px}
.auth-or::before,.auth-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.1)}
.auth-or span{flex-shrink:0}
.auth-primary{
    margin-top:14px;
    padding:15px 18px;
    font-size:15px;
  }
  .auth-foot-mobile{display:none}
}
@media (min-width:1200px){
  .auth-root{grid-template-columns:minmax(0,1.15fr) minmax(440px,0.85fr)}
  .auth-form-panel{padding:64px 56px}
  .auth-form-inner{max-width:440px}
  .auth-card{padding:40px 36px 36px}
}
@media (max-width:400px){
  .auth-form-panel{padding:20px 16px 32px}
  .auth-card{padding:22px 18px}
}
`;

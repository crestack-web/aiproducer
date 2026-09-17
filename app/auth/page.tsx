"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STUDIO_LOGO_URL } from "@/lib/brand";

type Mode = "login" | "signup" | "forgot" | "update-password";


const authCss = `
.auth-root{
  min-height:100dvh;position:relative;overflow:hidden;
  background:var(--bg,#050508);color:var(--text,#F4F1EC);
  --auth-brass:#E7A961;
  --auth-brass-deep:#c8893f;
  --auth-signal:#7BEBD4;
  --auth-muted:#9B96A3;
}
.auth-bg{
  position:absolute;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse 90% 55% at 12% -10%, rgba(231,169,97,.16), transparent 58%),
    radial-gradient(ellipse 70% 50% at 95% 85%, rgba(123,235,212,.10), transparent 55%),
    radial-gradient(ellipse 50% 40% at 50% 50%, rgba(231,169,97,.04), transparent 70%);
}
.auth-orb{position:absolute;border-radius:50%;filter:blur(72px);pointer-events:none}
.auth-orb-a{
  width:320px;height:320px;top:-100px;left:-80px;
  background:var(--auth-brass);opacity:0.22;
}
.auth-orb-b{
  width:260px;height:260px;bottom:8%;right:-50px;
  background:var(--auth-signal);opacity:0.14;
}
.auth-shell{position:relative;z-index:1;min-height:100dvh;display:grid;grid-template-columns:1fr;max-width:1100px;margin:0 auto}
.auth-brand-panel{display:none;padding:48px 40px;flex-direction:column;justify-content:center}
.auth-brand-mark{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:700;font-size:15px;margin-bottom:28px}
.auth-brand-mark img{border-radius:10px}
.auth-brand-title{font-size:clamp(28px,3.5vw,40px);font-weight:750;line-height:1.15;letter-spacing:-0.03em;margin:0 0 14px}
.auth-brand-copy{margin:0 0 20px;color:var(--auth-muted);font-size:15px;line-height:1.55;max-width:360px}
.auth-brand-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;color:var(--auth-muted);font-size:14px}
.auth-brand-list li{display:flex;align-items:center;gap:8px}
.auth-brand-list li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--auth-brass);flex-shrink:0;box-shadow:0 0 10px rgba(231,169,97,.45)}
.auth-form-panel{display:flex;align-items:center;justify-content:center;padding:28px 20px 40px}
.auth-form-inner{width:100%;max-width:400px}
.auth-card{
  background:rgba(12,12,16,0.88);
  border:1px solid rgba(231,169,97,.14);
  border-radius:20px;
  padding:28px 24px 24px;
  backdrop-filter:blur(14px);
  box-shadow:0 24px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,.03) inset;
}
.auth-card-logo{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:16px}
.auth-card-logo img{border-radius:8px}
.auth-card-title{margin:0 0 6px;font-size:22px;font-weight:700;letter-spacing:-0.02em}
.auth-card-sub{margin:0 0 18px;font-size:14px;color:var(--auth-muted);line-height:1.45}
.auth-error{font-size:13px;color:#f87171;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.auth-success{font-size:14px;color:var(--auth-signal);background:rgba(123,235,212,0.1);border:1px solid rgba(123,235,212,0.28);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.auth-form{display:flex;flex-direction:column;gap:14px}
.auth-label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:500;color:var(--auth-muted)}
.auth-input{
  width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;
  border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.4);color:var(--text);font-size:15px;outline:none;
}
.auth-input:focus{
  border-color:rgba(231,169,97,0.55);
  box-shadow:0 0 0 3px rgba(231,169,97,0.14);
}
.auth-pw-wrap{position:relative}
.auth-pw-wrap .auth-input{padding-right:64px}
.auth-pw-toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--auth-muted);font-size:12px;cursor:pointer;font-weight:600}
.auth-submit{
  margin-top:4px;width:100%;padding:13px 16px;border:none;border-radius:12px;
  background:linear-gradient(135deg, var(--auth-brass) 0%, var(--auth-brass-deep) 55%, #b87a35 100%);
  color:#1a1208;font-size:15px;font-weight:700;cursor:pointer;
  box-shadow:0 8px 24px rgba(231,169,97,.28), 0 1px 0 rgba(255,255,255,.2) inset;
  letter-spacing:0.01em;
}
.auth-submit:disabled{opacity:0.55;cursor:not-allowed;box-shadow:none}
.auth-submit:not(:disabled):hover{filter:brightness(1.06)}
.auth-submit:not(:disabled):active{transform:translateY(1px)}
.auth-switch{margin:18px 0 0;text-align:center;font-size:13px;color:var(--auth-muted)}
.auth-switch button{background:none;border:none;color:var(--auth-brass);font-weight:600;cursor:pointer;font-size:13px;padding:0}
.auth-switch button:hover{color:#f0c07a}
.auth-text-btn{background:none;border:none;color:var(--auth-muted);font-size:13px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}
.auth-text-btn:hover{color:var(--auth-brass)}
.auth-foot-mobile{margin:20px 0 0;text-align:center;font-size:12px;color:var(--auth-muted)}
@media (min-width:860px){
  .auth-shell{grid-template-columns:1fr 1fr;align-items:stretch}
  .auth-brand-panel{display:flex}
  .auth-form-panel{padding:48px 40px}
  .auth-card{padding:36px 32px 32px}
}
[data-theme="light"] .auth-root{--bg:#F7F1E8;--text:#121218;--auth-muted:#5c5c6a}
[data-theme="light"] .auth-card{
  background:rgba(255,255,255,0.92);
  border-color:rgba(231,169,97,.22);
  box-shadow:0 16px 40px rgba(0,0,0,0.08);
}
[data-theme="light"] .auth-input{background:#fff;border-color:rgba(0,0,0,0.12);color:#121218}
[data-theme="light"] .auth-bg{
  background:
    radial-gradient(ellipse 90% 55% at 12% -10%, rgba(231,169,97,.20), transparent 58%),
    radial-gradient(ellipse 70% 50% at 95% 85%, rgba(123,235,212,.12), transparent 55%);
}
[data-theme="light"] .auth-orb-a{opacity:0.18}
[data-theme="light"] .auth-orb-b{opacity:0.12}
[data-theme="light"] .auth-submit{color:#1a1208}

.auth-oauth{display:flex;flex-direction:column;gap:10px;margin-bottom:4px}
.auth-oauth-btn{
  display:flex;align-items:center;justify-content:center;gap:10px;
  width:100%;padding:12px 14px;border-radius:12px;cursor:pointer;
  font-size:14px;font-weight:600;color:var(--text,#F4F1EC);
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.12);
  transition:background .15s,border-color .15s,filter .15s;
}
.auth-oauth-btn:hover:not(:disabled){background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18)}
.auth-oauth-btn:disabled{opacity:0.55;cursor:not-allowed}
.auth-oauth-icon{display:inline-flex;line-height:0;flex-shrink:0}
.auth-oauth-spotify:hover:not(:disabled){border-color:rgba(29,185,84,.45)}
.auth-divider{
  display:flex;align-items:center;gap:12px;margin:14px 0 4px;
  color:var(--auth-muted,#9B96A3);font-size:12px;font-weight:500;
}
.auth-divider::before,.auth-divider::after{
  content:"";flex:1;height:1px;background:rgba(255,255,255,.1);
}
.auth-divider span{flex-shrink:0}
[data-theme="light"] .auth-oauth-btn{
  background:#fff;border-color:rgba(0,0,0,.1);color:#121218;
}
[data-theme="light"] .auth-oauth-btn:hover:not(:disabled){background:#f7f5f2}
[data-theme="light"] .auth-divider::before,
[data-theme="light"] .auth-divider::after{background:rgba(0,0,0,.1)}
`;


export default function AuthPage() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/app";
  const modeParam = search.get("mode");
  const initialMode: Mode =
    modeParam === "signup"
      ? "signup"
      : modeParam === "forgot"
        ? "forgot"
        : modeParam === "update-password"
          ? "update-password"
          : "login";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const title = useMemo(() => {
    if (mode === "login") return "Welcome back";
    if (mode === "signup") return "Create your account";
    if (mode === "forgot") return "Reset password";
    return "Choose a new password";
  }, [mode]);

  const subtitle = useMemo(() => {
    if (mode === "login") return "Log in to continue your session.";
    if (mode === "signup") return "Start recording with your real voice.";
    if (mode === "forgot") return "We’ll email you a secure reset link.";
    return "You’re signed in via the reset link. Set a new password below.";
  }, [mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = createClient();

      if (mode === "forgot") {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Could not send reset email");
          return;
        }
        setInfo(data.message || "Check your email for a reset link.");
        return;
      }

      if (mode === "update-password") {
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          return;
        }
        if (password !== confirm) {
          setError("Passwords do not match");
          return;
        }
        const { error: upErr } = await supabase.auth.updateUser({ password });
        if (upErr) {
          setError(upErr.message);
          return;
        }
        setInfo("Password updated. Taking you to the studio…");
        router.replace(next);
        router.refresh();
        return;
      }

      if (mode === "login") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) {
          const msg = err.message || "";
          if (/invalid login credentials|invalid credentials/i.test(msg)) {
            setError(
              "Invalid email or password. If you just signed up, confirm your email first (check inbox/spam). You can also use Forgot password."
            );
          } else if (/email not confirmed/i.test(msg)) {
            setError("Confirm your email before logging in. Check inbox/spam for the AP message.");
            try {
              await fetch("/api/auth/send-confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim() }),
              });
            } catch { /* ignore */ }
          } else {
            setError(msg);
          }
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      // signup
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (err) {
        if (/already registered|already been registered|user already exists/i.test(err.message)) {
          setError("That email already has an account. Log in, or use Forgot password if you need access.");
          setMode("login");
        } else {
          setError(err.message);
        }
        return;
      }

      // Welcome + confirmation via Resend (best-effort)
      try {
        await fetch("/api/auth/send-welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
      } catch { /* non-blocking */ }
      try {
        await fetch("/api/auth/send-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
      } catch { /* non-blocking */ }

      if (data.session) {
        router.replace(next);
        router.refresh();
      } else {
        setInfo(
          "Account created. Check your email (and spam) to confirm, then log in. If no email arrives, set RESEND_FROM_EMAIL to a verified domain in Resend."
        );
        setMode("login");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }


  async function oauthSignIn(provider: "google" | "spotify") {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
          scopes: provider === "spotify" ? "user-read-email" : undefined,
        },
      });
      if (err) {
        setError(err.message);
        setLoading(false);
      }
      // On success the browser redirects away
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth failed");
      setLoading(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setInfo(null);
    setPassword("");
    setConfirm("");
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: authCss }} />
      <div className="auth-root">
        <div className="auth-bg" aria-hidden />
        <div className="auth-orb auth-orb-a" aria-hidden />
        <div className="auth-orb auth-orb-b" aria-hidden />

        <main className="auth-shell">
          <div className="auth-brand-panel">
            <Link href="/" className="auth-brand-mark">
              <img src={STUDIO_LOGO_URL} alt="" width={40} height={40} />
              <span>AP Studio</span>
            </Link>
            <h1 className="auth-brand-title">
              Your voice.
              <br />
              Finished records.
            </h1>
            <p className="auth-brand-copy">
              Record on your device, follow a clear plan, and let AP assemble, mix, and master —
              so you leave with a track, not a rough freestyle.
            </p>
            <ul className="auth-brand-list">
              <li>Section-by-section recording plan</li>
              <li>Real vocal processing & mix</li>
              <li>Download when you’re ready</li>
            </ul>
          </div>

          <div className="auth-form-panel">
            <div className="auth-form-inner">
              <div className="auth-card">
                <div className="auth-card-logo">
                  <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} />
                  <span>AP</span>
                </div>
                <h2 className="auth-card-title">{title}</h2>
                <p className="auth-card-sub">{subtitle}</p>

                {error && <div className="auth-error">{error}</div>}
                {info && <div className="auth-success">{info}</div>}

                {(mode === "login" || mode === "signup") && (
                  <>
                    <div className="auth-oauth">
                      <button
                        type="button"
                        className="auth-oauth-btn"
                        disabled={loading}
                        onClick={() => oauthSignIn("google")}
                      >
                        <span className="auth-oauth-icon" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                          </svg>
                        </span>
                        Continue with Google
                      </button>
                      <button
                        type="button"
                        className="auth-oauth-btn auth-oauth-spotify"
                        disabled={loading}
                        onClick={() => oauthSignIn("spotify")}
                      >
                        <span className="auth-oauth-icon" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 24 24">
                            <path fill="#1DB954" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                          </svg>
                        </span>
                        Continue with Spotify
                      </button>
                    </div>
                    <div className="auth-divider"><span>or</span></div>
                  </>
                )}


                <form onSubmit={onSubmit} className="auth-form">
                  {mode !== "update-password" && (
                    <label className="auth-label">
                      Email
                      <input
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="auth-input"
                        placeholder="you@email.com"
                      />
                    </label>
                  )}

                  {(mode === "login" || mode === "signup" || mode === "update-password") && (
                    <label className="auth-label">
                      {mode === "update-password" ? "New password" : "Password"}
                      <div className="auth-pw-wrap">
                        <input
                          type={showPw ? "text" : "password"}
                          autoComplete={mode === "login" ? "current-password" : "new-password"}
                          required
                          minLength={mode === "signup" || mode === "update-password" ? 8 : undefined}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="auth-input"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          className="auth-pw-toggle"
                          onClick={() => setShowPw((s) => !s)}
                          aria-label={showPw ? "Hide password" : "Show password"}
                        >
                          {showPw ? "Hide" : "Show"}
                        </button>
                      </div>
                    </label>
                  )}

                  {mode === "update-password" && (
                    <label className="auth-label">
                      Confirm password
                      <input
                        type={showPw ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        className="auth-input"
                        placeholder="••••••••"
                      />
                    </label>
                  )}

                  {mode === "login" && (
                    <div style={{ textAlign: "right", marginTop: -4 }}>
                      <button type="button" className="auth-text-btn" onClick={() => switchMode("forgot")}>
                        Forgot password?
                      </button>
                    </div>
                  )}

                  <button type="submit" className="auth-submit" disabled={loading}>
                    {loading
                      ? "Please wait…"
                      : mode === "login"
                        ? "Log in"
                        : mode === "signup"
                          ? "Continue"
                          : mode === "forgot"
                            ? "Send reset link"
                            : "Update password"}
                  </button>
                </form>

                <p className="auth-switch">
                  {mode === "login" && (
                    <>
                      New here?{" "}
                      <button type="button" onClick={() => switchMode("signup")}>
                        Create account
                      </button>
                    </>
                  )}
                  {mode === "signup" && (
                    <>
                      Already have an account?{" "}
                      <button type="button" onClick={() => switchMode("login")}>
                        Log in
                      </button>
                    </>
                  )}
                  {(mode === "forgot" || mode === "update-password") && (
                    <>
                      Remembered it?{" "}
                      <button type="button" onClick={() => switchMode("login")}>
                        Back to log in
                      </button>
                    </>
                  )}
                </p>
              </div>

              <p className="auth-foot-mobile">You bring the voice. AP helps you make the song.</p>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}


"use client";

import { useEffect, FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STUDIO_LOGO_URL } from "@/lib/brand";

type Mode = "login" | "signup" | "forgot" | "update-password";


const authCss = `
.auth-root{
  min-height:100dvh;position:relative;overflow-x:clip;
  background:#050508;color:#F4F1EC;
  --auth-brass:#E7A961;
  --auth-brass-deep:#c8893f;
  --auth-signal:#7BEBD4;
  --auth-muted:#9B96A3;
  --auth-line:rgba(255,255,255,.1);
  --auth-glass:rgba(16,16,22,.72);
}
.auth-bg{
  position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(231,169,97,.14), transparent 55%),
    radial-gradient(ellipse 60% 40% at 100% 100%, rgba(123,235,212,.08), transparent 50%),
    #050508;
}
.auth-shell{
  position:relative;z-index:1;
  min-height:100dvh;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:24px 16px 32px;
  box-sizing:border-box;
}
.auth-top{
  display:flex;align-items:center;justify-content:space-between;
  width:100%;max-width:420px;margin:0 auto 20px;
}
.auth-top a{
  display:inline-flex;align-items:center;gap:8px;
  text-decoration:none;color:#F4F1EC;font-weight:700;font-size:15px;
}
.auth-top img{border-radius:8px;display:block}
.auth-top-back{
  font-size:13px;font-weight:600;color:var(--auth-muted);
  text-decoration:none;padding:8px 12px;border-radius:999px;
  border:1px solid transparent;
}
.auth-top-back:hover{color:#F4F1EC;border-color:var(--auth-line);background:rgba(255,255,255,.04)}

.auth-card{
  width:100%;max-width:400px;
  margin:0 auto;
  padding:28px 22px 24px;
  border-radius:24px;
  background:var(--auth-glass);
  border:1px solid var(--auth-line);
  backdrop-filter:saturate(160%) blur(20px);
  -webkit-backdrop-filter:saturate(160%) blur(20px);
  box-shadow:0 24px 64px -28px rgba(0,0,0,.7);
  box-sizing:border-box;
}
.auth-card-title{
  margin:0 0 6px;
  font-size:1.45rem;font-weight:700;letter-spacing:-0.02em;
  color:#F4F1EC;text-align:center;
}
.auth-card-sub{
  margin:0 0 22px;
  font-size:14px;line-height:1.45;color:var(--auth-muted);
  text-align:center;
}
.auth-error{
  font-size:13px;color:#fca5a5;
  background:rgba(248,113,113,.1);
  border:1px solid rgba(248,113,113,.25);
  border-radius:12px;padding:10px 12px;margin-bottom:14px;
}
.auth-success{
  font-size:13px;color:var(--auth-signal);
  background:rgba(123,235,212,.1);
  border:1px solid rgba(123,235,212,.28);
  border-radius:12px;padding:10px 12px;margin-bottom:14px;
}
.auth-oauth{display:flex;flex-direction:column;gap:10px}
.auth-oauth-btn{
  display:flex;align-items:center;justify-content:center;gap:10px;
  width:100%;padding:12px 14px;border-radius:14px;cursor:pointer;
  font-size:14px;font-weight:600;color:#F4F1EC;
  background:rgba(255,255,255,.05);
  border:1px solid var(--auth-line);
  transition:background .15s,border-color .15s;
  box-sizing:border-box;
}
.auth-oauth-btn:hover:not(:disabled){background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.18)}
.auth-oauth-btn:disabled{opacity:.55;cursor:not-allowed}
.auth-oauth-icon{display:inline-flex;line-height:0;flex-shrink:0}
.auth-divider{
  display:flex;align-items:center;gap:12px;margin:18px 0 16px;
  color:var(--auth-muted);font-size:12px;font-weight:500;
}
.auth-divider::before,.auth-divider::after{
  content:"";flex:1;height:1px;background:var(--auth-line);
}
.auth-form{display:flex;flex-direction:column;gap:12px}
.auth-label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:500;color:var(--auth-muted)}
.auth-input{
  width:100%;box-sizing:border-box;padding:12px 14px;border-radius:14px;
  border:1px solid var(--auth-line);background:rgba(0,0,0,.35);color:#F4F1EC;
  font-size:15px;outline:none;
}
.auth-input::placeholder{color:#5C5866}
.auth-input:focus{
  border-color:rgba(231,169,97,.55);
  box-shadow:0 0 0 3px rgba(231,169,97,.14);
}
.auth-pw-wrap{position:relative}
.auth-pw-wrap .auth-input{padding-right:64px}
.auth-pw-toggle{
  position:absolute;right:10px;top:50%;transform:translateY(-50%);
  background:none;border:none;color:var(--auth-muted);font-size:12px;
  cursor:pointer;font-weight:600;padding:4px 6px;
}
.auth-pw-toggle:hover{color:#F4F1EC}
.auth-submit{
  margin-top:4px;width:100%;padding:13px 16px;border:none;border-radius:14px;
  background:linear-gradient(180deg,#F0BC80,var(--auth-brass));
  color:#1a1208;font-size:15px;font-weight:700;cursor:pointer;
  box-shadow:0 8px 24px rgba(231,169,97,.25);
  letter-spacing:0.01em;
}
.auth-submit:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
.auth-submit:not(:disabled):hover{filter:brightness(1.05)}
.auth-text-btn{
  background:none;border:none;color:var(--auth-muted);font-size:13px;
  cursor:pointer;padding:0;font-weight:600;
}
.auth-text-btn:hover{color:var(--auth-brass)}
.auth-switch{
  margin:18px 0 0;text-align:center;font-size:13px;color:var(--auth-muted);
}
.auth-switch button{
  background:none;border:none;color:var(--auth-brass);font-weight:700;
  cursor:pointer;font-size:13px;padding:0;
}
.auth-switch button:hover{color:#f0c07a}
.auth-legal{
  margin:20px auto 0;max-width:400px;text-align:center;
  font-size:12px;color:var(--auth-muted);line-height:1.45;
}
.auth-legal a{color:var(--auth-muted);text-decoration:underline;text-underline-offset:2px}
.auth-legal a:hover{color:var(--auth-brass)}

/* Hide legacy brand panel / mobile foot if still in DOM */
.auth-brand-panel,.auth-orb,.auth-card-logo,.auth-foot-mobile{display:none!important}
.auth-form-panel{width:100%;display:flex;justify-content:center}
.auth-form-inner{width:100%;max-width:400px}

@media (min-width:640px){
  .auth-card{padding:32px 28px 28px}
  .auth-card-title{font-size:1.55rem}
}
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

  useEffect(() => {
    const err = search.get("error");
    const detail = search.get("detail");
    if (err === "oauth") {
      setError(
        detail
          ? `Google sign-in failed: ${detail}`
          : "Google sign-in failed. Try again, or use email."
      );
    }
  }, [search]);

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

      // signup — server creates user + sends Resend only (no Supabase Auth email)
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "already_registered" || /already/i.test(String(data.error || ""))) {
          setError(
            "That email already has an account. Log in, or use Forgot password if you need access."
          );
          setMode("login");
        } else {
          setError(typeof data.error === "string" ? data.error : "Could not create account");
        }
        return;
      }
      setInfo(
        typeof data.message === "string"
          ? data.message
          : "Account created. Check your email (and spam) for the AP confirmation link, then log in."
      );
      setMode("login");
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

        <main className="auth-shell">
          <div className="auth-top">
            <Link href="/">
              <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} />
              <span>AP Studio</span>
            </Link>
            <Link href="/" className="auth-top-back">
              Home
            </Link>
          </div>

          <div className="auth-form-panel">
            <div className="auth-form-inner">
              <div className="auth-card">
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

              <p className="auth-legal">
                By continuing you agree to our{" "}
                <Link href="/terms">Terms</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>.
              </p>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}


"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STUDIO_LOGO_URL } from "@/lib/brand";

type Mode = "login" | "signup" | "forgot" | "update-password";


const authCss = `
.auth-root{min-height:100dvh;position:relative;overflow:hidden;background:var(--bg,#0a0a0c);color:var(--text,#f5f5f7)}
.auth-bg{position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 20% 0%,rgba(124,92,255,0.18),transparent 55%),radial-gradient(ellipse 60% 40% at 90% 80%,rgba(56,189,248,0.08),transparent 50%);pointer-events:none}
.auth-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:0.45;pointer-events:none}
.auth-orb-a{width:280px;height:280px;background:#7c5cff;top:-80px;left:-60px}
.auth-orb-b{width:220px;height:220px;background:#38bdf8;bottom:10%;right:-40px;opacity:0.25}
.auth-shell{position:relative;z-index:1;min-height:100dvh;display:grid;grid-template-columns:1fr;max-width:1100px;margin:0 auto}
.auth-brand-panel{display:none;padding:48px 40px;flex-direction:column;justify-content:center}
.auth-brand-mark{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);font-weight:700;font-size:15px;margin-bottom:28px}
.auth-brand-mark img{border-radius:10px}
.auth-brand-title{font-size:clamp(28px,3.5vw,40px);font-weight:750;line-height:1.15;letter-spacing:-0.03em;margin:0 0 14px}
.auth-brand-copy{margin:0 0 20px;color:var(--muted,#a1a1aa);font-size:15px;line-height:1.55;max-width:360px}
.auth-brand-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;color:var(--muted);font-size:14px}
.auth-brand-list li{display:flex;align-items:center;gap:8px}
.auth-brand-list li::before{content:"";width:6px;height:6px;border-radius:50%;background:#7c5cff;flex-shrink:0}
.auth-form-panel{display:flex;align-items:center;justify-content:center;padding:28px 20px 40px}
.auth-form-inner{width:100%;max-width:400px}
.auth-card{background:rgba(20,20,24,0.92);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:28px 24px 24px;backdrop-filter:blur(12px);box-shadow:0 24px 48px rgba(0,0,0,0.35)}
.auth-card-logo{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:16px}
.auth-card-logo img{border-radius:8px}
.auth-card-title{margin:0 0 6px;font-size:22px;font-weight:700;letter-spacing:-0.02em}
.auth-card-sub{margin:0 0 18px;font-size:14px;color:var(--muted,#a1a1aa);line-height:1.45}
.auth-error{font-size:13px;color:#f87171;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.auth-success{font-size:14px;color:#3ecf8e;background:rgba(62,207,142,0.1);border:1px solid rgba(62,207,142,0.25);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.auth-form{display:flex;flex-direction:column;gap:14px}
.auth-label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:500;color:var(--muted)}
.auth-input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.35);color:var(--text);font-size:15px;outline:none}
.auth-input:focus{border-color:rgba(124,92,255,0.55);box-shadow:0 0 0 3px rgba(124,92,255,0.15)}
.auth-pw-wrap{position:relative}
.auth-pw-wrap .auth-input{padding-right:64px}
.auth-pw-toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;font-weight:600}
.auth-submit{margin-top:4px;width:100%;padding:13px 16px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c5cff,#5b8cff);color:#fff;font-size:15px;font-weight:650;cursor:pointer}
.auth-submit:disabled{opacity:0.6;cursor:not-allowed}
.auth-submit:not(:disabled):hover{filter:brightness(1.06)}
.auth-switch{margin:18px 0 0;text-align:center;font-size:13px;color:var(--muted)}
.auth-switch button{background:none;border:none;color:#a78bfa;font-weight:600;cursor:pointer;font-size:13px;padding:0}
.auth-text-btn{background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}
.auth-text-btn:hover{color:var(--text)}
.auth-foot-mobile{margin:20px 0 0;text-align:center;font-size:12px;color:var(--muted)}
@media (min-width:860px){
  .auth-shell{grid-template-columns:1fr 1fr;align-items:stretch}
  .auth-brand-panel{display:flex}
  .auth-form-panel{padding:48px 40px}
  .auth-card{padding:36px 32px 32px}
}
[data-theme="light"] .auth-root{--bg:#f6f5f8;--text:#121218;--muted:#5c5c6a}
[data-theme="light"] .auth-card{background:rgba(255,255,255,0.92);border-color:rgba(0,0,0,0.08);box-shadow:0 16px 40px rgba(0,0,0,0.08)}
[data-theme="light"] .auth-input{background:#fff;border-color:rgba(0,0,0,0.12);color:#121218}
[data-theme="light"] .auth-bg{background:radial-gradient(ellipse 80% 50% at 20% 0%,rgba(124,92,255,0.12),transparent 55%),radial-gradient(ellipse 60% 40% at 90% 80%,rgba(56,189,248,0.08),transparent 50%)}
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


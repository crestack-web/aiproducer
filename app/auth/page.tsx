"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STUDIO_LOGO_URL } from "@/lib/brand";

type Mode = "login" | "signup" | "forgot" | "update-password";

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
          setError(err.message);
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
        setError(err.message);
        return;
      }

      // Branded welcome via Resend (best-effort)
      try {
        await fetch("/api/auth/send-welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        });
      } catch {
        /* non-blocking */
      }

      if (data.session) {
        router.replace(next);
        router.refresh();
      } else {
        setInfo("Check your email to confirm your account, then log in.");
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
                          autoComplete={
                            mode === "login"
                              ? "current-password"
                              : mode === "update-password"
                                ? "new-password"
                                : "new-password"
                          }
                          required={mode !== "forgot"}
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


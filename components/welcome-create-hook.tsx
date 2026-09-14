"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Suno-style create bar — captures intent (beat description) then routes to signup.
 * Optional Google one-tap path.
 */
export function WelcomeCreateHook() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stashIntent() {
    try {
      const value = prompt.trim();
      if (value) sessionStorage.setItem("ap_create_intent", value);
      sessionStorage.setItem("ap_create_source", "welcome_hook");
    } catch {
      /* ignore */
    }
  }

  function goSignup() {
    stashIntent();
    const q = new URLSearchParams({
      mode: "signup",
      next: "/onboarding",
    });
    if (prompt.trim()) q.set("intent", prompt.trim().slice(0, 120));
    router.push(`/auth?${q.toString()}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    goSignup();
  }

  async function continueWithGoogle() {
    setBusy(true);
    setError(null);
    stashIntent();
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (oauthErr) throw oauthErr;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <section className="create-hook" id="create" aria-label="Start creating">
      <p className="create-hook-lead">
        Drop a beat idea or describe your track — AP guides your vocals and produces the record.
      </p>

      <form className="create-bar" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="create-prompt">
          Describe your beat or song
        </label>
        <input
          id="create-prompt"
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Upload a beat or describe your track…"
          autoComplete="off"
          maxLength={200}
        />
        <div className="create-bar-actions">
          <span className="create-bar-hint" aria-hidden>
            +
          </span>
          <button type="submit" className="create-btn">
            <span aria-hidden>♪</span> Create
          </button>
        </div>
      </form>

      <div className="create-google-row">
        <button
          type="button"
          className="google-btn"
          onClick={() => void continueWithGoogle()}
          disabled={busy}
        >
          <GoogleIcon />
          {busy ? "Connecting…" : "Continue with Google"}
        </button>
        <button type="button" className="create-email-link" onClick={goSignup}>
          or sign up with email
        </button>
      </div>
      {error && <p className="create-error">{error}</p>}
    </section>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.5 7.3l6.2 5.2C38.9 37.1 44 31.3 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

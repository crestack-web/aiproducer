"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const BEAT_DB = "ap_welcome_beat";
const BEAT_STORE = "files";

async function stashBeatFile(file: File): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(BEAT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BEAT_STORE)) db.createObjectStore(BEAT_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(BEAT_STORE, "readwrite");
      tx.objectStore(BEAT_STORE).put(
        { blob: file, name: file.name, type: file.type, size: file.size, at: Date.now() },
        "pending_beat"
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Hero create bar — describe a track and/or upload a beat, then register modal.
 */
export function WelcomeCreateHook() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const [beatFile, setBeatFile] = useState<File | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  function onPickFile(file: File | null) {
    if (!file) return;
    const ok =
      file.type.startsWith("audio/") ||
      /\.(mp3|wav|m4a|aac|ogg|flac|mpeg)$/i.test(file.name);
    if (!ok) {
      setError("Please choose an audio file (MP3, WAV, M4A…).");
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setError("Beat must be under 80MB.");
      return;
    }
    setError(null);
    setBeatFile(file);
  }

  async function stashIntent() {
    try {
      const value = prompt.trim();
      if (value) sessionStorage.setItem("ap_create_intent", value);
      else sessionStorage.removeItem("ap_create_intent");
      sessionStorage.setItem("ap_create_source", "welcome_hook");
      if (beatFile) {
        sessionStorage.setItem(
          "ap_pending_beat_meta",
          JSON.stringify({ name: beatFile.name, type: beatFile.type, size: beatFile.size })
        );
        await stashBeatFile(beatFile);
      } else {
        sessionStorage.removeItem("ap_pending_beat_meta");
      }
    } catch {
      /* ignore */
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = prompt.trim();
    if (!value && !beatFile) {
      setError("Upload a beat or describe your track to continue.");
      return;
    }
    setError(null);
    await stashIntent();
    setModalOpen(true);
  }

  function authHref(mode: "signup" | "login") {
    const q = new URLSearchParams({ mode, next: "/onboarding" });
    if (prompt.trim()) q.set("intent", prompt.trim().slice(0, 120));
    if (beatFile) q.set("beat", "1");
    return `/auth?${q.toString()}`;
  }

  async function continueWithGoogle() {
    setBusy(true);
    setError(null);
    await stashIntent();
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

  const summary =
    beatFile && prompt.trim()
      ? `${beatFile.name} · ${prompt.trim().slice(0, 60)}`
      : beatFile
        ? beatFile.name
        : prompt.trim().slice(0, 80);

  return (
    <section className="create-hook" id="create" aria-label="Start creating">
      <p className="create-hook-lead">
        Upload your beat or describe the track — AP guides your vocals and produces the record.
      </p>

      <form className="create-bar" onSubmit={(e) => void onSubmit(e)}>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
          className="sr-only"
          onChange={(e) => onPickFile(e.target.files?.[0] || null)}
        />
        <label className="sr-only" htmlFor="create-prompt">
          Describe your beat or song
        </label>
        <input
          id="create-prompt"
          type="text"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Describe your track (optional if you upload a beat)…"
          autoComplete="off"
          maxLength={200}
        />
        {beatFile && (
          <div className="create-file-chip">
            <span className="create-file-name" title={beatFile.name}>
              ♪ {beatFile.name}
            </span>
            <button
              type="button"
              className="create-file-clear"
              aria-label="Remove beat"
              onClick={() => setBeatFile(null)}
            >
              ×
            </button>
          </div>
        )}
        <div className="create-bar-actions">
          <button
            type="button"
            className="create-bar-hint create-upload-btn"
            aria-label="Upload beat"
            title="Upload beat"
            onClick={() => fileRef.current?.click()}
          >
            +
          </button>
          <button type="submit" className="create-btn">
            Continue
          </button>
        </div>
      </form>
      {error && !modalOpen && <p className="create-error">{error}</p>}

      {modalOpen && (
        <div
          className="reg-modal-backdrop"
          role="presentation"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="reg-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reg-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="reg-modal-close"
              aria-label="Close"
              onClick={() => setModalOpen(false)}
            >
              ×
            </button>
            <p className="reg-modal-kicker">Your session is ready</p>
            <h2 id="reg-modal-title">Create a free account to continue</h2>
            <p className="reg-modal-body">
              {summary ? (
                <>
                  We’ll start from <strong>“{summary}{summary.length >= 80 ? "…" : ""}”</strong> —
                  register to open the booth with your beat.
                </>
              ) : (
                <>Register to open the booth and produce with your real voice.</>
              )}
            </p>

            <button
              type="button"
              className="google-btn reg-modal-google"
              onClick={() => void continueWithGoogle()}
              disabled={busy}
            >
              <GoogleIcon />
              {busy ? "Connecting…" : "Continue with Google"}
            </button>

            <div className="reg-modal-or">
              <span>or</span>
            </div>

            <Link href={authHref("signup")} className="reg-modal-primary">
              Sign up with email
            </Link>
            <Link href={authHref("login")} className="reg-modal-secondary">
              Already have an account? Log in
            </Link>
            {error && <p className="create-error">{error}</p>}
          </div>
        </div>
      )}
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

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
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
html,body{margin:0;width:100%;max-width:100%;overflow-x:hidden;background:#050508}
.auth-shell{min-height:100dvh;min-height:100vh;display:grid;grid-template-columns:1fr;background:#050508;color:#F4F1EC;font-family:Inter,system-ui,sans-serif;width:100%;max-width:100%;overflow-x:hidden}
.auth-brand{display:none}
.auth-main{display:flex;align-items:flex-start;justify-content:center;padding:24px 16px 40px;padding-top:max(24px,env(safe-area-inset-top));padding-bottom:max(40px,env(safe-area-inset-bottom));width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.auth-card{width:100%;max-width:360px;min-width:0;box-sizing:border-box}
.auth-logo{display:inline-flex;align-items:center;gap:8px;font-weight:600;text-decoration:none;color:inherit;margin-bottom:24px;font-size:15px}
.auth-logo img{display:block;flex-shrink:0;border-radius:6px;object-fit:cover}
.auth-back{color:#9B96A3;font-size:13px;text-decoration:none;display:inline-block;margin-bottom:16px}
.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);margin-bottom:18px;width:100%;box-sizing:border-box}
.auth-tab{padding:10px 8px;border-radius:10px;border:none;background:transparent;color:#9B96A3;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit}
.auth-tab.on{background:rgba(255,255,255,.08);color:#F4F1EC}
.auth-card h2{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:1.5rem;margin:0 0 6px;line-height:1.2}
.auth-sub{color:#9B96A3;font-size:14px;margin:0 0 18px;line-height:1.45}
.auth-error{margin-bottom:12px;padding:10px 12px;border-radius:10px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);color:#ffb4b4;font-size:13px;word-break:break-word}
.auth-field{display:block;font-size:13px;color:#9B96A3;margin-bottom:14px;font-weight:500}
.auth-field input{display:block;width:100%;max-width:100%;margin-top:6px;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.04);color:#F4F1EC;font-size:16px;font-family:inherit;outline:none;box-sizing:border-box;-webkit-appearance:none;appearance:none}
.auth-field input:focus{border-color:rgba(123,235,212,.45);background:rgba(123,235,212,.04)}
.auth-primary{width:100%;margin-top:6px;padding:13px 16px;border-radius:999px;border:none;background:linear-gradient(180deg,#F0BC80,#E7A961);color:#1A1208;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit;box-sizing:border-box}
.auth-primary:disabled{opacity:.55;cursor:not-allowed}
.auth-foot-mobile{display:block;margin-top:24px;text-align:center;font-size:12px;color:#5C5866;line-height:1.4}
@media (min-width:900px){
.auth-shell{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.auth-brand{display:flex;flex-direction:column;justify-content:space-between;padding:40px 48px;border-right:1px solid rgba(255,255,255,.09);min-width:0}
.auth-brand-copy{max-width:420px;padding:32px 0}
.auth-brand-copy h1{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:2.4rem;line-height:1.12;margin:0 0 16px}
.auth-brand-copy h1 em{font-style:normal;background:linear-gradient(120deg,#7BEBD4,#a8f0e0 45%,#E7A961);-webkit-background-clip:text;background-clip:text;color:transparent}
.auth-brand-copy p{color:#9B96A3;font-size:15px;line-height:1.55;margin:0 0 24px}
.auth-points{list-style:none;margin:0;padding:0}
.auth-points li{position:relative;padding-left:18px;font-size:14px;color:#9B96A3;line-height:1.45;margin-bottom:12px}
.auth-points li::before{content:"";position:absolute;left:0;top:7px;width:7px;height:7px;border-radius:99px;background:#7BEBD4}
.auth-foot{color:#5C5866;font-size:13px;margin:0}
.auth-main{align-items:center;padding:40px 24px}
.auth-card{max-width:380px}
.auth-logo.mobile-only{display:none}
.auth-foot-mobile{display:none}
}
`}</style>
      <div className="auth-shell">
        <aside className="auth-brand">
          <Link href="/" className="auth-logo">
            <img src={STUDIO_LOGO_URL} alt="" width={22} height={22} /> Studio
          </Link>
          <div className="auth-brand-copy">
            <h1>
              Your voice.
              <br />
              <em>A finished song.</em>
            </h1>
            <p>Log in to continue producer sessions, or create an account and ship your first radio-ready track.</p>
            <ul className="auth-points">
              <li>AI plans the structure — you record the lead</li>
              <li>Guided takes: doubles, harmonies, adlibs</li>
              <li>Professional mix & master included on every credit</li>
            </ul>
          </div>
          <p className="auth-foot">You bring the voice. Studio helps you make the song.</p>
        </aside>

        <main className="auth-main">
          <div className="auth-card">
            <Link href="/" className="auth-logo mobile-only">
              <img src={STUDIO_LOGO_URL} alt="" width={22} height={22} /> Studio
            </Link>
            <Link href="/" className="auth-back">
              ← Back
            </Link>

            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "login" ? "auth-tab on" : "auth-tab"}
                onClick={() => setMode("login")}
              >
                Log in
              </button>
              <button
                type="button"
                className={mode === "signup" ? "auth-tab on" : "auth-tab"}
                onClick={() => setMode("signup")}
              >
                Sign up
              </button>
            </div>

            <h2>{title}</h2>
            <p className="auth-sub">
              {mode === "login"
                ? "Continue your songs and producer sessions."
                : "Buy a Session when you’re ready to finish a song."}
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
              <button type="submit" className="auth-primary" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}
              </button>
            </form>
            <p className="auth-foot-mobile">You bring the voice. Studio helps you make the song.</p>
          </div>
        </main>
      </div>
    </>
  );
}

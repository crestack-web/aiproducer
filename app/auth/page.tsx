"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
      const { data: { user } } = await supabase.auth.getUser();
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
  .auth-shell{min-height:100dvh;min-height:100vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);background:#050508;color:#F4F1EC;font-family:Inter,system-ui,sans-serif;width:100%;max-width:100vw;overflow-x:hidden}
  .auth-brand{padding:40px 48px;border-right:1px solid rgba(255,255,255,.09);display:flex;flex-direction:column;justify-content:space-between;min-width:0}
  .auth-logo{display:inline-flex;align-items:center;gap:10px;font-weight:600;text-decoration:none;color:inherit}
  .auth-logo-mark{color:#7BEBD4}
  .auth-brand-copy{max-width:420px;padding:32px 0}
  .auth-brand-copy h1{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:clamp(1.85rem,3vw,2.6rem);line-height:1.12;margin:0 0 16px}
  .auth-brand-copy h1 em{font-style:normal;background:linear-gradient(120deg,#7BEBD4,#a8f0e0 45%,#E7A961);-webkit-background-clip:text;background-clip:text;color:transparent}
  .auth-brand-copy p{color:#9B96A3;font-size:15.5px;line-height:1.55;margin:0 0 24px}
  .auth-points{list-style:none;margin:0;padding:0}
  .auth-points li{position:relative;padding-left:18px;font-size:14px;color:#9B96A3;line-height:1.45;margin-bottom:12px}
  .auth-points li::before{content:"";position:absolute;left:0;top:7px;width:7px;height:7px;border-radius:99px;background:#7BEBD4}
  .auth-foot{color:#5C5866;font-size:13px;margin:0}
  .auth-main{display:flex;align-items:center;justify-content:center;padding:32px 20px;min-width:0;width:100%}
  .auth-card{width:100%;max-width:400px;min-width:0}
  .auth-back{color:#9B96A3;font-size:13.5px;text-decoration:none;display:inline-block;margin-bottom:24px}
  .auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);margin-bottom:24px}
  .auth-tab{padding:10px 12px;border-radius:11px;border:none;background:transparent;color:#9B96A3;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit}
  .auth-tab.on{background:rgba(255,255,255,.08);color:#F4F1EC}
  .auth-card h2{font-family:Fraunces,serif;font-weight:500;font-size:clamp(1.45rem,4vw,1.75rem);margin:0 0 8px}
  .auth-sub{color:#9B96A3;font-size:14.5px;margin:0 0 24px;line-height:1.45}
  .auth-error{margin-bottom:14px;padding:11px 13px;border-radius:12px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);color:#ffb4b4;font-size:13.5px}
  .auth-field{display:block;font-size:13px;color:#9B96A3;margin-bottom:16px;font-weight:500}
  .auth-field input{display:block;width:100%;margin-top:8px;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.04);color:#F4F1EC;font-size:16px;font-family:inherit;outline:none;box-sizing:border-box}
  .auth-primary{width:100%;margin-top:8px;padding:14px 18px;border-radius:999px;border:none;background:linear-gradient(180deg,#F0BC80,#E7A961);color:#1A1208;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit}
  .auth-primary:disabled{opacity:.55;cursor:not-allowed}
  @media (max-width:900px){.auth-shell{grid-template-columns:1fr}.auth-brand{display:none}.auth-main{padding:20px 16px 40px;align-items:flex-start}.auth-card{max-width:100%}}
  @media (max-width:380px){.auth-main{padding-left:14px;padding-right:14px}}
`}</style>
      <div className="auth-shell">
        <aside className="auth-brand">
          <Link href="/" className="auth-logo"><span className="auth-logo-mark">◆</span> Studio</Link>
          <div className="auth-brand-copy">
            <h1>Your voice.<br /><em>A finished song.</em></h1>
            <p>Log in to continue producer sessions, or create an account and ship your first radio-ready track.</p>
            <ul className="auth-points">
              <li>AI plans the structure — you record the lead</li>
              <li>Guided takes: doubles, harmonies, adlibs</li>
              <li>Professional mix &amp; master on paid plans</li>
            </ul>
          </div>
          <p className="auth-foot">You bring the voice. Studio helps you make the song.</p>
        </aside>
        <main className="auth-main">
          <div className="auth-card">
            <Link href="/" className="auth-back">← Back to Studio</Link>
            <div className="auth-tabs">
              <button type="button" className={mode === "login" ? "auth-tab on" : "auth-tab"} onClick={() => setMode("login")}>Log in</button>
              <button type="button" className={mode === "signup" ? "auth-tab on" : "auth-tab"} onClick={() => setMode("signup")}>Sign up</button>
            </div>
            <h2>{title}</h2>
            <p className="auth-sub">{mode === "login" ? "Continue your songs and producer sessions." : "Free includes 1 finished song so you can try the full producer flow."}</p>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={onSubmit}>
              {mode === "signup" && (
                <label className="auth-field">Artist name
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="How should we call you?" required />
                </label>
              )}
              <label className="auth-field">Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" required />
              </label>
              <label className="auth-field">Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required />
              </label>
              <button type="submit" className="auth-primary" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Log in" : "Continue"}</button>
            </form>
          </div>
        </main>
      </div>
    </>
  );
}

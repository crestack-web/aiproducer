import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { RotatingHeadline } from "@/components/rotating-headline";
import { WelcomeCreateHook } from "@/components/welcome-create-hook";
import { STUDIO_LOGO_URL } from "@/lib/brand";

const START_HREF = "/auth?mode=signup";
const LOGIN_HREF = "/auth?mode=login";

export default function WelcomePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />
      <div className="studio-page">
        <div className="studio-atmosphere" aria-hidden>
          <div className="glow glow-brass" />
          <div className="glow glow-signal" />
          <div className="wave-line wave-1" />
          <div className="wave-line wave-2" />
        </div>

        <header className="header">
          <div className="header-inner">
            <Link href="/" className="logo">
              <img src={STUDIO_LOGO_URL} alt="" width={32} height={32} />
              <span>AP Studio</span>
            </Link>
            <nav className="nav-links" aria-label="Primary">
              <a href="#booth">The booth</a>
              <a href="#how">How it works</a>
              <a href="#faq">FAQ</a>
            </nav>
            <div className="header-actions">
              <ThemeToggle />
              <Link href={LOGIN_HREF} className="link-quiet">
                Log in
              </Link>
              <Link href={START_HREF} className="btn-brass">
                Enter studio
              </Link>
            </div>
          </div>
        </header>

        <main>
          <section className="hero">
            <div className="hero-inner">
              <p className="hero-kicker">Recording booth · real voice · finished record</p>
              <h1 className="hero-title">
                Make the song
                <br />
                <span className="hero-title-em">with your real voice</span>
              </h1>
              <p className="hero-sub">
                Drop a beat, step into the booth, and let AP produce — mix, balance, and master —
                so you leave with a track that sounds like a session, not a voice memo.
              </p>
              <div className="hero-actions">
                <Link href={START_HREF} className="btn-brass btn-lg">
                  Start a session
                </Link>
                <a href="#booth" className="btn-ghost btn-lg">
                  See the booth
                </a>
              </div>
              <p className="hero-rotating">
                <RotatingHeadline />
              </p>
            </div>

            <div className="hero-stage" aria-hidden>
              <div className="stage-frame">
                <div className="stage-label">LIVE BOOTH</div>
                <div className="stage-meters">
                  <span /><span /><span /><span /><span /><span /><span /><span />
                </div>
                <div className="stage-waveform">
                  {Array.from({ length: 48 }).map((_, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${12 + Math.abs(Math.sin(i * 0.55) * 28) + (i % 5) * 3}px`,
                        animationDelay: `${(i % 8) * 0.08}s`,
                      }}
                    />
                  ))}
                </div>
                <div className="stage-caption">Lead · Harmony · Ad-lib — on your timeline</div>
              </div>
            </div>
          </section>

          <section className="hook-band" id="start">
            <div className="wrap">
              <div className="hook-head">
                <h2>Bring your beat. We’ll open the booth.</h2>
                <p>Upload an instrumental to start — no account until you’re ready to continue.</p>
              </div>
              <WelcomeCreateHook />
            </div>
          </section>

          <section className="booth" id="booth">
            <div className="wrap">
              <div className="section-label">Inside the room</div>
              <h2 className="section-title">Not another dashboard. A session.</h2>
              <div className="booth-grid">
                <article className="booth-card">
                  <div className="booth-icon" aria-hidden>
                    ♪
                  </div>
                  <h3>Beat on the monitors</h3>
                  <p>
                    Your instrumental stays the backbone. Sections map to verse, chorus, bridge —
                    the way a producer marks the form on a whiteboard.
                  </p>
                </article>
                <article className="booth-card">
                  <div className="booth-icon" aria-hidden>
                    ◉
                  </div>
                  <h3>Takes in the booth</h3>
                  <p>
                    Record lead, doubles, harmonies, and ad-libs section by section. Retake when you
                    need to. Your voice stays your voice.
                  </p>
                </article>
                <article className="booth-card">
                  <div className="booth-icon" aria-hidden>
                    ◆
                  </div>
                  <h3>AP on the desk</h3>
                  <p>
                    When you hit Produce, AP levels, cleans, stacks, and masters — engineer work,
                    not a karaoke filter chain.
                  </p>
                </article>
              </div>
            </div>
          </section>

          <section className="how" id="how">
            <div className="wrap how-inner">
              <div>
                <div className="section-label">Session flow</div>
                <h2 className="section-title">From first take to final bounce</h2>
              </div>
              <ol className="flow">
                <li>
                  <span className="flow-n">01</span>
                  <div>
                    <strong>Load the beat</strong>
                    <p>MP3 or WAV — the track you’ll sing over.</p>
                  </div>
                </li>
                <li>
                  <span className="flow-n">02</span>
                  <div>
                    <strong>Plan the form</strong>
                    <p>Let AP plan sections, or build verse/chorus yourself.</p>
                  </div>
                </li>
                <li>
                  <span className="flow-n">03</span>
                  <div>
                    <strong>Track the vocals</strong>
                    <p>Phone or interface — capture performance in the booth UI.</p>
                  </div>
                </li>
                <li>
                  <span className="flow-n">04</span>
                  <div>
                    <strong>Produce & download</strong>
                    <p>AP mixes and masters. Preview, tweak, then take WAV or MP3.</p>
                  </div>
                </li>
              </ol>
            </div>
          </section>

          <section className="sessions" id="sessions">
            <div className="wrap">
              <div className="section-label">Sessions</div>
              <h2 className="section-title">Pay for the record, not a seat license</h2>
              <div className="session-cards">
                <div className="session-card">
                  <div className="session-name">Single session</div>
                  <div className="session-price">
                    $2.99<span>/song</span>
                  </div>
                  <p>One produced track — mix, master, download when you’re happy.</p>
                  <Link href={START_HREF} className="btn-ghost block">
                    Book a session
                  </Link>
                </div>
                <div className="session-card session-card-hot">
                  <div className="session-tag">For regulars</div>
                  <div className="session-name">Studio pass</div>
                  <div className="session-price">
                    Plans<span> from the app</span>
                  </div>
                  <p>More sessions when you’re writing every week. Unlock after your first produce.</p>
                  <Link href={START_HREF} className="btn-brass block">
                    Enter studio
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="faq" id="faq">
            <div className="wrap">
              <div className="section-label">FAQ</div>
              <h2 className="section-title">Before you press record</h2>
              <div className="faq-list">
                <details>
                  <summary>Is this AI singing for me?</summary>
                  <p>
                    No. AP is the producer/engineer. Your recorded voice is the performance in the
                    final song.
                  </p>
                </details>
                <details>
                  <summary>Can I use my phone?</summary>
                  <p>
                    Yes. The booth is built for device mics. You can also use an interface when you
                    have one.
                  </p>
                </details>
                <details>
                  <summary>What do I download?</summary>
                  <p>Produced audio as WAV and/or MP3 after the session is paid and complete.</p>
                </details>
                <details>
                  <summary>Do I need a DAW?</summary>
                  <p>
                    No. Structure, recording, and production happen in AP. Producer View is optional
                    for deeper control.
                  </p>
                </details>
              </div>
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="footer-inner">
            <Link href="/" className="footer-logo">
              <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} />
              <span>AP Studio</span>
            </Link>
            <div className="footer-links">
              <Link href={START_HREF}>Start a session</Link>
              <Link href={LOGIN_HREF}>Log in</Link>
              <a href="https://instagram.com/apstudio.site" target="_blank" rel="noreferrer">
                Instagram
              </a>
              <a href="https://www.tiktok.com/@apstudio.site" target="_blank" rel="noreferrer">
                TikTok
              </a>
            </div>
            <p className="footer-note">You bring the voice. AP helps you make the song.</p>
          </div>
        </footer>
      </div>
    </>
  );
}

const pageCss = `
.studio-page{
  min-height:100dvh;position:relative;overflow-x:hidden;
  background:#050508;color:#F4F1EC;
  font-family:Inter,system-ui,sans-serif;
}
.studio-atmosphere{position:fixed;inset:0;pointer-events:none;z-index:0}
.glow{position:absolute;border-radius:50%;filter:blur(80px)}
.glow-brass{width:48vw;height:48vw;max-width:640px;max-height:640px;top:-12%;left:-10%;background:rgba(231,169,97,.14)}
.glow-signal{width:40vw;height:40vw;max-width:520px;max-height:520px;bottom:5%;right:-8%;background:rgba(123,235,212,.08)}
.wave-line{position:absolute;left:0;right:0;height:1px;opacity:.35;
  background:linear-gradient(90deg,transparent,rgba(231,169,97,.35),rgba(123,235,212,.25),transparent)}
.wave-1{top:28%}.wave-2{top:72%;opacity:.22}

.header{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);
  background:rgba(5,5,8,.72);border-bottom:1px solid rgba(255,255,255,.06)}
.header-inner{max-width:1120px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:16px}
.logo{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#F4F1EC;font-weight:700;font-size:15px}
.logo img{border-radius:9px}
.nav-links{display:none;gap:18px;margin-left:12px}
.nav-links a{color:#9B96A3;text-decoration:none;font-size:13px;font-weight:500}
.nav-links a:hover{color:#F4F1EC}
.header-actions{margin-left:auto;display:flex;align-items:center;gap:10px}
.link-quiet{color:#9B96A3;text-decoration:none;font-size:13px;font-weight:500;padding:8px 4px}
.link-quiet:hover{color:#F4F1EC}

.btn-brass{
  display:inline-flex;align-items:center;justify-content:center;
  padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:700;font-size:13px;
  color:#1a1208;background:linear-gradient(135deg,#E7A961,#c8893f);
  box-shadow:0 6px 20px rgba(231,169,97,.25);border:none;cursor:pointer;
}
.btn-brass:hover{filter:brightness(1.05)}
.btn-ghost{
  display:inline-flex;align-items:center;justify-content:center;
  padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;
  color:#F4F1EC;background:transparent;border:1px solid rgba(255,255,255,.14);
}
.btn-ghost:hover{border-color:rgba(231,169,97,.45);color:#E7A961}
.btn-lg{padding:14px 22px;font-size:15px}
.btn-brass.block,.btn-ghost.block{display:flex;width:100%}

.hero{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:48px 20px 32px;
  display:grid;gap:36px}
.hero-kicker{
  display:inline-block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:#E7A961;font-weight:600;margin:0 0 14px;
}
.hero-title{margin:0 0 16px;font-size:clamp(34px,6vw,56px);line-height:1.05;letter-spacing:-.03em;font-weight:750}
.hero-title-em{
  background:linear-gradient(90deg,#E7A961,#7BEBD4);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.hero-sub{margin:0 0 24px;max-width:34rem;font-size:16px;line-height:1.6;color:#9B96A3}
.hero-actions{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.hero-rotating{margin:0;font-size:14px;color:#7BEBD4;min-height:1.4em}

.hero-stage{display:flex;align-items:center;justify-content:center}
.stage-frame{
  width:100%;max-width:420px;border-radius:20px;padding:18px 18px 16px;
  background:linear-gradient(160deg,rgba(20,18,24,.95),rgba(10,10,14,.98));
  border:1px solid rgba(231,169,97,.2);
  box-shadow:0 30px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.04);
}
.stage-label{
  font-size:10px;letter-spacing:.16em;font-weight:700;color:#7BEBD4;margin-bottom:12px;
}
.stage-meters{display:flex;gap:4px;height:8px;margin-bottom:16px}
.stage-meters span{
  flex:1;border-radius:2px;background:linear-gradient(180deg,#7BEBD4,#E7A961);
  opacity:.35;animation:meter 1.4s ease-in-out infinite alternate;
}
.stage-meters span:nth-child(2){animation-delay:.1s;opacity:.5}
.stage-meters span:nth-child(3){animation-delay:.2s;opacity:.7}
.stage-meters span:nth-child(4){animation-delay:.15s}
.stage-meters span:nth-child(5){animation-delay:.25s;opacity:.55}
@keyframes meter{from{transform:scaleY(.4)}to{transform:scaleY(1)}}
.stage-waveform{
  display:flex;align-items:flex-end;gap:3px;height:64px;padding:8px 4px;
  background:rgba(0,0,0,.35);border-radius:12px;margin-bottom:12px;
}
.stage-waveform i{
  flex:1;min-width:2px;border-radius:2px 2px 0 0;
  background:linear-gradient(180deg,#E7A961,#7BEBD4);opacity:.85;
  animation:wave 1.1s ease-in-out infinite alternate;
}
@keyframes wave{from{opacity:.45;transform:scaleY(.65)}to{opacity:1;transform:scaleY(1)}}
.stage-caption{font-size:12px;color:#9B96A3;text-align:center}

.wrap{max-width:1120px;margin:0 auto;padding:0 20px;position:relative;z-index:1}
.hook-band{padding:28px 0 56px;position:relative;z-index:1}
.hook-head{margin-bottom:18px}
.hook-head h2{margin:0 0 8px;font-size:clamp(22px,3vw,30px);letter-spacing:-.02em}
.hook-head p{margin:0;color:#9B96A3;font-size:15px}

.section-label{
  font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#E7A961;font-weight:600;margin-bottom:8px;
}
.section-title{margin:0 0 28px;font-size:clamp(24px,3.5vw,34px);letter-spacing:-.02em;font-weight:700}

.booth{padding:24px 0 64px}
.booth-grid{display:grid;gap:14px}
.booth-card{
  padding:22px 20px;border-radius:18px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);
}
.booth-card:hover{border-color:rgba(231,169,97,.28)}
.booth-icon{
  width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  background:rgba(231,169,97,.12);color:#E7A961;font-size:16px;margin-bottom:12px;
}
.booth-card h3{margin:0 0 8px;font-size:17px}
.booth-card p{margin:0;font-size:14px;line-height:1.55;color:#9B96A3}

.how{padding:24px 0 64px}
.how-inner{display:grid;gap:24px}
.flow{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.flow li{
  display:flex;gap:16px;align-items:flex-start;padding:16px 16px;
  border-radius:16px;border:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.25);
}
.flow-n{
  font-family:ui-monospace,monospace;font-size:13px;font-weight:700;color:#7BEBD4;
  min-width:2rem;padding-top:2px;
}
.flow strong{display:block;margin-bottom:4px;font-size:15px}
.flow p{margin:0;font-size:13px;color:#9B96A3;line-height:1.45}

.sessions{padding:24px 0 64px}
.session-cards{display:grid;gap:14px}
.session-card{
  padding:24px 22px;border-radius:20px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.09);
}
.session-card-hot{
  border-color:rgba(231,169,97,.35);
  background:linear-gradient(160deg,rgba(231,169,97,.1),rgba(255,255,255,.02));
}
.session-tag{
  display:inline-block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:#1a1208;background:#E7A961;font-weight:700;padding:4px 8px;border-radius:999px;margin-bottom:10px;
}
.session-name{font-size:14px;color:#9B96A3;margin-bottom:6px}
.session-price{font-size:32px;font-weight:750;letter-spacing:-.02em;margin-bottom:10px}
.session-price span{font-size:14px;font-weight:500;color:#9B96A3;margin-left:4px}
.session-card p{margin:0 0 18px;font-size:14px;color:#9B96A3;line-height:1.5}

.faq{padding:24px 0 72px}
.faq-list{display:flex;flex-direction:column;gap:10px}
.faq-list details{
  border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
  padding:14px 16px;
}
.faq-list summary{cursor:pointer;font-weight:600;font-size:14px;list-style:none}
.faq-list summary::-webkit-details-marker{display:none}
.faq-list details p{margin:10px 0 0;font-size:13px;line-height:1.55;color:#9B96A3}

.footer{border-top:1px solid rgba(255,255,255,.06);position:relative;z-index:1;padding:28px 0 40px}
.footer-inner{max-width:1120px;margin:0 auto;padding:0 20px}
.footer-logo{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:#F4F1EC;font-weight:600;margin-bottom:14px}
.footer-logo img{border-radius:8px}
.footer-links{display:flex;flex-wrap:wrap;gap:14px 18px;margin-bottom:12px}
.footer-links a{color:#9B96A3;text-decoration:none;font-size:13px}
.footer-links a:hover{color:#E7A961}
.footer-note{margin:0;font-size:12px;color:#5C5866}

@media (min-width:860px){
  .nav-links{display:flex}
  .hero{grid-template-columns:1.1fr .9fr;align-items:center;padding:64px 20px 48px}
  .booth-grid{grid-template-columns:repeat(3,1fr);gap:16px}
  .how-inner{grid-template-columns:1fr 1.2fr;align-items:start;gap:40px}
  .session-cards{grid-template-columns:1fr 1fr;gap:16px}
}
@media (min-width:1100px){
  .header-inner,.wrap,.footer-inner,.hero{max-width:1180px}
}

[data-theme="light"] .studio-page{background:#F7F1E8;color:#16141c}
[data-theme="light"] .header{background:rgba(247,241,232,.85);border-bottom-color:rgba(0,0,0,.06)}
[data-theme="light"] .logo,[data-theme="light"] .hero-title{color:#16141c}
[data-theme="light"] .link-quiet,[data-theme="light"] .nav-links a{color:#5c5c6a}
[data-theme="light"] .hero-sub,[data-theme="light"] .booth-card p,
[data-theme="light"] .flow p,[data-theme="light"] .session-card p,
[data-theme="light"] .faq-list details p,[data-theme="light"] .hook-head p{color:#5c5c6a}
[data-theme="light"] .booth-card,[data-theme="light"] .session-card,
[data-theme="light"] .flow li,[data-theme="light"] .faq-list details{
  background:rgba(255,255,255,.7);border-color:rgba(0,0,0,.08)
}
[data-theme="light"] .btn-ghost{color:#16141c;border-color:rgba(0,0,0,.12)}
[data-theme="light"] .stage-frame{background:#fff;border-color:rgba(231,169,97,.3)}
[data-theme="light"] .footer{border-top-color:rgba(0,0,0,.08)}
[data-theme="light"] .footer-logo{color:#16141c}
[data-theme="light"] .glow-brass{opacity:.7}
`;

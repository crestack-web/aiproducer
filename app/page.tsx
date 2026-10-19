import Link from "next/link";
import { RotatingHeadline } from "@/components/rotating-headline";
import { WelcomeCreateHook } from "@/components/welcome-create-hook";
import { WelcomeMusicRail } from "@/components/welcome-music-rail";
import { WelcomeProductDemo } from "@/components/welcome-product-demo";
import { WelcomeMotionSections } from "@/components/welcome-motion-sections";
import { WelcomeAnalytics } from "@/components/product-analytics";

const START_HREF = "/auth?mode=signup&next=/onboarding";

export default function WelcomePage() {
  return (
    <>
      <WelcomeAnalytics />
      <style>{css}</style>
      <div className="ambient" aria-hidden />
      <div className="beta-banner" role="status">
        <span className="beta-pill">Beta</span>
        <span className="beta-copy">Features may change</span>
      </div>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="logo">
            <img
              src="/logo.svg"
              alt="AP Studio"
              width={28}
              height={28}
              className="logo-img"
            />
            AP Studio
          </Link>
          <nav className="nav desktop-nav">
            <a href="#workspace">Workspace</a>
            <a href="#listen">Listen</a>
            <a href="#how">How it works</a>
            <a href="#motion-mix">Produce</a>
            <a href="#value">Why Studio</a>
            <a href="#faq">FAQ</a>
            <a href="#pricing">Pricing</a>
            <Link href="/auth?mode=login&next=/app" className="ghost">Log in</Link>
            <Link href={START_HREF} className="primary">Start creating</Link>
          </nav>
        </div>
      </header>

<div className="wrap">
<section className="hero">
          <h1>
            <RotatingHeadline />
            <br />
            <em>With your real voice.</em>
          </h1>
          <p className="trust">No music theory · Pay per finished song · Your voice stays the lead</p>
          <WelcomeCreateHook />
        </section>

        <WelcomeProductDemo />

        <WelcomeMotionSections />

        <WelcomeMusicRail />

        <section className="section" id="how">
          <div className="section-head">
            <p className="section-kicker">How it works</p>
            <h2>Idea in. Song out. Five plays.</h2>
            <p>No theory. No blank-page panic. Studio maps the track, coaches every take, then mixes and masters — so you just show up and sing.</p>
          </div>
          <div className="pipeline">
            {[
              ["1", "Drop the beat", "AI builds an instrumental made for vocals — or upload the one already in your head."],
              ["2", "Get the game plan", "Intro, verse, chorus laid out. You always know the next line to record."],
              ["3", "Record, one layer at a time", "Lead, doubles, harmonies, adlibs. Guided tasks — not a wall of tracks."],
              ["4", "Stack & shine", "Best takes placed, cleaned, and balanced into real vocal stacks."],
              ["5", "Master & ship", "Radio-ready export. Skip the DAW. Keep the credit."],
            ].map(([n, title, body]) => (
              <div className="pipe-row" key={n}>
                <div className="pipe-num">{n}</div>
                <div className="pipe-body">
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="difference">
          <div className="section-head">
            <h2>Not another AI voice generator</h2>
            <p>Full-song AI apps can sound impressive — but they don’t sound like you.</p>
          </div>
          <div className="compare">
            <div className="compare-card">
              <h3>Typical AI song apps</h3>
              <ul><li>Synthetic vocals</li><li>Hard to claim as your performance</li><li>One-shot output, not a session</li></ul>
            </div>
            <div className="compare-card yes">
              <h3>Studio</h3>
              <ul><li>Your real recorded voice</li><li>Guided layers & structure</li><li>Pro mix & master on every credit</li></ul>
            </div>
          </div>
        </section>

        <section className="section" id="value">
          <div className="section-head">
            <h2>The gap most artists feel</h2>
            <p>
              A real studio can sound incredible — but sessions are expensive, time is limited,
              and a lot of the money goes to hours that don’t end up on the record.
              Studio closes that gap: guided production + pro mix & master without booking a room.
            </p>
          </div>
          <div className="cost-compare">
            <div className="cost-card">
              <div className="cost-label">Traditional studio</div>
              <h3>One song, in a room</h3>
              <p>Typical independent session for a single — before mixing is even finished.</p>
              <div className="cost-total">$400–$1,200<span>+</span></div>
              <div className="cost-sub">Common range for one focused session + basic mix</div>
              <ul className="cost-list">
                <li>Studio time (2–4 hrs) <em>$150–$400+</em></li>
                <li>Engineer / producer <em>$100–$400</em></li>
                <li>Mix pass <em>$100–$300</em></li>
                <li>Mastering <em>$50–$150</em></li>
                <li className="dim">Travel, retakes, unused hours <em>often lost</em></li>
              </ul>
            </div>
            <div className="cost-card studio-app">
              <div className="cost-label">Studio app</div>
              <h3>One finished song</h3>
              <p>Beat → plan → guided vocals → mix & master. Clear cost per release.</p>
              <div className="cost-total">From $4.99<span> / song</span></div>
              <div className="cost-sub">Session: $4.99/song · Artist: ~$2.50 · Band: ~$2.36 · Label: ~$2.58</div>
              <ul className="cost-list">
                <li>AI beat + structure plan <em>included</em></li>
                <li>Guided recording (unlimited takes*) <em>included</em></li>
                <li>Pro mix & master <em>included</em></li>
                <li>WAV / MP3 export <em>included</em></li>
                <li>Record from home, any time <em>$0 room fee</em></li>
              </ul>
            </div>
          </div>
          <div className="gap-callout">
            <strong>Where the value leaks in a studio:</strong> you’re paying for the clock, not only the take that ships.
            Bad days, short sessions, and vague direction mean money spent without a radio-ready file.
            Studio flips that — you pay for a <strong>finished song path</strong>, with a producer plan and mastering baked in,
            so more of every dollar ends up in the track you release.
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="section-head">
            <h2>Simple pricing</h2>
            <p>
              Buy a single session or a monthly credit pack. Every finished song includes
              professional mix & master so every release can sound radio-ready.
            </p>
          </div>
          <div className="pricing">
            <div className="price-card">
              <div className="price-name">Session</div>
              <div className="price-amount">$4.99 <span>/ song</span></div>
              <p className="price-desc">One finished song, end to end.</p>
              <ul className="price-list">
                <li>1 song credit</li>
                <li>Beat + plan + guided record</li>
                <li>Mix, master &amp; export</li>
              </ul>
              <Link href={START_HREF} className="secondary block">Buy session</Link>
            </div>
            <div className="price-card featured">
              <div className="price-badge">Popular</div>
              <div className="price-name">Artist</div>
              <div className="price-amount">$25 <span>/ mo</span></div>
              <p className="price-desc">Ship singles every month.</p>
              <ul className="price-list">
                <li>10 songs / mo · ~$2.50</li>
                <li>Everything in Session</li>
                <li>Commercial license</li>
              </ul>
              <Link href={START_HREF} className="primary block">Start Artist</Link>
            </div>
            <div className="price-card">
              <div className="price-name">Band</div>
              <div className="price-amount">$59 <span>/ mo</span></div>
              <p className="price-desc">Higher volume for EPs.</p>
              <ul className="price-list">
                <li>25 songs / mo · ~$2.36</li>
                <li>Priority mastering</li>
                <li>Stem export</li>
              </ul>
              <Link href={START_HREF} className="secondary block">Start Band</Link>
            </div>
            <div className="price-card">
              <div className="price-name">Label</div>
              <div className="price-amount">$129 <span>/ mo</span></div>
              <p className="price-desc">Catalog-scale output.</p>
              <ul className="price-list">
                <li>50 songs / mo · ~$2.58</li>
                <li>Everything in Band</li>
                <li>Multi-artist workflow</li>
              </ul>
              <Link href={START_HREF} className="secondary block">Start Label</Link>
            </div>
          </div>
          <p className="price-note">
            Finished songs include guided recording plus professional mix & master.
            Extra songs beyond your plan can be purchased as add-ons. Cancel anytime.
          </p>
        </section>


        <section className="section" id="faq">
          <div className="section-head">
            <h2>Frequently asked questions</h2>
            <p>Straight answers before you open the booth.</p>
          </div>
          <div className="faq-list">
            <details className="faq-item" open>
              <summary>Is this my real voice or AI singing for me?</summary>
              <p>
                Your voice stays the lead. AP is the producer — cleanup, arrangement,
                mix, and master around the performance you record on your device.
              </p>
            </details>
            <details className="faq-item">
              <summary>Do I need music theory or a studio?</summary>
              <p>
                No. You upload or pick a beat, follow a clear recording plan section by section,
                and AP handles the technical production decisions.
              </p>
            </details>
            <details className="faq-item">
              <summary>What do I need to start?</summary>
              <p>
                A phone or computer with a mic, headphones if you can, and a beat (or a short
                description of the track you want to make). You can start from the create bar on this page.
              </p>
            </details>
            <details className="faq-item">
              <summary>How does pricing work?</summary>
              <p>
                Pay per finished song with a single session, or use a monthly plan for more songs.
                You can preview the produced track before you unlock download.
              </p>
            </details>
            <details className="faq-item">
              <summary>Can I record harmonies and ad-libs?</summary>
              <p>
                Yes. The plan can include lead, doubles, harmonies, and ad-libs. Record what you need;
                AP mixes layers according to their role.
              </p>
            </details>
            <details className="faq-item">
              <summary>Who owns the song?</summary>
              <p>
                You keep rights to your performance and the finished song under the terms of your plan.
                We don’t claim your voice as a generative model replacement.
              </p>
            </details>
          </div>
        </section>

        <section className="bottom-cta">
          <h2>Your next song can be radio-ready today</h2>
          <p>Beat → plan → guided vocals → mix & master.</p>
          <Link href={START_HREF} className="primary lg">Create your first song</Link>
        </section>

      </div>


      <section className="footer-banner" aria-label="AP Studio">
        <img
          src="/welcome/footer-banner.jpg"
          alt="AP Studio — record with your real voice"
          className="footer-banner-img"
          width={1400}
          height={789}
          loading="lazy"
        />
      </section>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div className="footer-brand">
            <Link href="/" className="footer-logo">
              <img
                src="/logo.svg"
                alt="AP Studio"
                width={32}
                height={32}
                className="logo-img"
              />
              <span>AP Studio</span>
            </Link>
            <span className="footer-tag">Your voice. Produced.</span>
          </div>
          <nav className="footer-legal" aria-label="Site">
            <Link href="/how" className="footer-legal-link">
              How it works
            </Link>
            <Link href="/privacy" className="footer-legal-link">
              Privacy Policy
            </Link>
            <Link href="/terms" className="footer-legal-link">
              Terms of Service
            </Link>
          </nav>
          <div className="footer-socials">
            <a
              href="https://www.instagram.com/Apstudio.site"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="AP Studio on Instagram"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.75" />
                <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.75" />
                <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
              </svg>
            </a>
            <a
              href="https://www.tiktok.com/@apstudio.site"
              target="_blank"
              rel="noopener noreferrer"
              className="social-link"
              aria-label="AP Studio on TikTok"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .56.04.82.12v-3.4a6.22 6.22 0 0 0-.82-.05A6.34 6.34 0 0 0 3.15 15.4 6.34 6.34 0 0 0 9.49 21.7a6.34 6.34 0 0 0 6.34-6.34V8.92a8.2 8.2 0 0 0 4.76 1.52V7.02a4.84 4.84 0 0 1-1-.33z" />
              </svg>
            </a>
          </div>
                </div>
      </footer>
    </>
  );
}

const css = `
  :root{--bg:#050508;--surface:rgba(255,255,255,.045);--border:rgba(255,255,255,.09);--border-hi:rgba(255,255,255,.16);--text:#F4F1EC;--muted:#9B96A3;--faint:#5C5866;--signal:#7BEBD4;--brass:#E7A961;--brass-soft:rgba(231,169,97,.15);--shadow:none;--header-bg:transparent}
  /* Warm paper studio — higher contrast muted text, soft ivory cards */
  html[data-theme="light"]{
    --bg:#F3EBE0;
    --surface:#FFFFFF;
    --border:rgba(48,36,22,.12);
    --border-hi:rgba(48,36,22,.2);
    --text:#14110E;
    --muted:#3F3830;
    --faint:#6E655C;
    --signal:#0A8F7A;
    --signal-soft:rgba(10,143,122,.14);
    --brass:#C47820;
    --brass-deep:#9A6218;
    --brass-soft:rgba(196,120,32,.16);
    --coral:#E85D4C;
    --violet:#7B5CDB;
    --shadow:0 2px 4px rgba(40,28,12,.05),0 12px 32px rgba(40,28,12,.08);
    --header-bg:#FFFBF6;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);overflow-x:hidden;max-width:100%}
  body{min-width:0}

  .theme-slot{display:inline-flex;align-items:center;margin:0 4px}
  html[data-theme="light"] .ambient{
    opacity:1;
    filter:none;
    background:
      radial-gradient(ellipse at 50% -12%,rgba(10,143,122,.16),transparent 50%),
      radial-gradient(ellipse at 100% 20%,rgba(196,120,32,.14),transparent 45%),
      radial-gradient(ellipse at 0% 70%,rgba(123,92,219,.08),transparent 42%),
      radial-gradient(ellipse at 80% 100%,rgba(232,93,76,.07),transparent 40%);
  }
    /* Light header: same structure/size as dark — colors only */
  html[data-theme="light"] .header{
    background:var(--header-bg);
    border-bottom:1px solid var(--border);
    box-shadow:0 1px 0 rgba(48,36,22,.04);
  }
  html[data-theme="light"] .nav a:not(.primary):not(.ghost){
    color:var(--muted);
  }
  html[data-theme="light"] .nav a:not(.primary):not(.ghost):hover{
    color:var(--brass-deep, var(--brass));
    background:var(--brass-soft);
  }
  html[data-theme="light"] .nav a.primary,
  html[data-theme="light"] a.primary{
    background:linear-gradient(135deg,#E8A04A 0%,#C47820 45%,#E85D4C 100%);
    color:#1A1208;
    box-shadow:0 6px 18px rgba(196,120,32,.28);
  }
  html[data-theme="light"] .nav a.ghost,
  html[data-theme="light"] a.ghost{
    border-color:rgba(196,120,32,.35);
    color:var(--brass-deep, var(--brass));
  }

html[data-theme="light"] .chip{
    background:var(--signal-soft);
    color:var(--signal);
    border:1px solid rgba(10,143,122,.22);
    font-weight:600;
  }
  html[data-theme="light"] .chip:nth-child(2){
    background:var(--brass-soft);
    color:var(--brass-deep);
    border-color:rgba(196,120,32,.28);
  }
  html[data-theme="light"] .wave i{
    background:linear-gradient(180deg,var(--signal),rgba(196,120,32,.55));
  }
  html[data-theme="light"] .hero h1 em,
  html[data-theme="light"] .hero em{
    color:var(--brass-deep);
    font-style:italic;
  }
  html[data-theme="light"] .section-title,
  html[data-theme="light"] .section-head h2{
    color:var(--text);
  }
  html[data-theme="light"] .price-card.featured,
  html[data-theme="light"] .price-card:hover{
    border-color:rgba(196,120,32,.35);
    box-shadow:0 12px 36px rgba(196,120,32,.14),var(--shadow);
  }
  /* Welcome footer — dark default; light overrides below (scoped so later rules cannot wash out dark mode) */
  .site-footer{
    width:100%;max-width:100%;
    margin-top:48px;
    box-sizing:border-box;overflow-x:clip;
    border-top:1px solid var(--border-hi, rgba(255,255,255,.12));
    background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(0,0,0,.35));
    color:var(--text);
  }
  .site-footer-inner{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px 28px;
    max-width:1200px;margin:0 auto;width:100%;
    padding:28px 24px 36px;box-sizing:border-box;
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px;
  }
  .site-footer .footer-brand{display:flex;flex-direction:column;gap:6px}
  .site-footer .footer-logo{
    display:inline-flex;align-items:center;gap:10px;
    text-decoration:none;color:var(--text);font-weight:600;font-size:15px;
  }
  .site-footer .footer-logo:hover{opacity:.9}
  .site-footer .footer-tag{font-size:13px;color:var(--muted)}
  .site-footer .footer-legal{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
  .site-footer .footer-legal-link{
    font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;
    padding:6px 0;border-bottom:1px solid transparent;
  }
  .site-footer .footer-legal-link:hover{color:var(--brass);border-bottom-color:rgba(231,169,97,.35)}
  html[data-theme="light"] .site-footer .footer-legal-link{color:var(--muted)}
  html[data-theme="light"] .site-footer .footer-legal-link:hover{color:var(--brass)}
  .site-footer .footer-socials{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .site-footer .social-link{
    display:inline-flex;align-items:center;justify-content:center;
    width:42px;height:42px;padding:0;border-radius:999px;
    border:1px solid var(--border-hi, rgba(255,255,255,.14));
    color:var(--muted);text-decoration:none;
    background:rgba(255,255,255,.06);
    transition:color .15s,border-color .15s,background .15s;
  }
  .site-footer .social-link:hover{
    color:var(--brass);
    border-color:rgba(231,169,97,.5);
    background:rgba(231,169,97,.12);
  }
  .site-footer .social-link svg{flex-shrink:0;color:currentColor}
  /* Light mode footer */
  html[data-theme="light"] .site-footer{
    border-top:1px solid var(--border);
    background:linear-gradient(180deg,#FFFBF6,var(--bg));
    color:var(--text);
  }
  html[data-theme="light"] .site-footer .footer-logo{color:var(--text)}
  html[data-theme="light"] .site-footer .footer-tag{color:var(--muted)}
  html[data-theme="light"] .site-footer .social-link{
    background:#fff;
    border-color:var(--border);
    color:var(--muted);
    box-shadow:var(--shadow);
  }
  html[data-theme="light"] .site-footer .social-link:hover{
    color:var(--brass);
    border-color:var(--brass);
    background:var(--brass-soft);
  }
  @media (min-width:1100px){
    .site-footer-inner{max-width:1240px;padding:32px 40px 40px}
  }
  @media (min-width:1400px){
    .site-footer-inner{max-width:1320px}
  }
  .create-upload-btn{
    border:none;cursor:pointer;font-family:inherit;
  }
  .create-file-chip{
    display:flex;align-items:center;gap:8px;
    padding:6px 10px;border-radius:10px;
    background:rgba(123,235,212,.1);border:1px solid rgba(123,235,212,.25);
    margin:0 2px;
  }
  .create-file-name{
    flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    font-size:13px;color:var(--signal);font-weight:600;
  }
  .create-file-clear{
    background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;
  }
  html[data-theme="light"] .create-file-chip{
    background:rgba(10,143,122,.1);border-color:rgba(10,143,122,.22);
  }

.faq-list{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
  .faq-item{
    border:1px solid var(--border);
    border-radius:14px;
    background:var(--surface);
    padding:0 18px;
  }
  .faq-item summary{
    cursor:pointer;list-style:none;
    padding:16px 0;
    font-weight:600;font-size:15px;color:var(--text);
    display:flex;align-items:center;justify-content:space-between;gap:12px;
  }
  .faq-item summary::-webkit-details-marker{display:none}
  .faq-item summary::after{
    content:"+";font-weight:500;color:var(--brass);font-size:18px;line-height:1;
  }
  .faq-item[open] summary::after{content:"–"}
  .faq-item p{
    margin:0 0 16px;padding-bottom:4px;
    font-size:14.5px;line-height:1.55;color:var(--muted);
  }
  html[data-theme="light"] .faq-item{
    background:#fff;box-shadow:var(--shadow);
  }
  .footer-top{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
    gap:20px;width:100%;margin-bottom:20px;
  }
  .footer-nav{
    display:flex;flex-wrap:wrap;align-items:center;gap:8px;
  }
  .footer-btn{
    display:inline-flex;align-items:center;justify-content:center;
    padding:8px 14px;border-radius:999px;
    font-size:13px;font-weight:600;text-decoration:none;
    color:var(--muted);border:1px solid var(--border);
    background:transparent;
  }
  .footer-btn:hover{color:var(--text);border-color:var(--border-hi)}
  .footer-btn-primary{
    background:linear-gradient(135deg,#F0BC80,#E7A961);
    color:#1A1208;border:none;
  }
  .footer-btn-primary:hover{filter:brightness(1.05);color:#1A1208}
  .footer-bottom{
    display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;
    gap:12px;width:100%;padding-top:16px;border-top:1px solid var(--border);
  }
  .footer-social{display:flex;gap:10px}
  .footer-social-link{
    display:grid;place-items:center;width:36px;height:36px;border-radius:999px;
    color:var(--muted);border:1px solid var(--border);text-decoration:none;
  }
  .footer-social-link:hover{color:var(--brass);border-color:var(--brass)}
  .footer-copy{margin:0;font-size:12.5px;color:var(--faint)}

  html[data-theme="light"] .showcase,
  html[data-theme="light"] .panel,
  html[data-theme="light"] .price-card,
  html[data-theme="light"] .compare-card,
  html[data-theme="light"] .cost-card,
  html[data-theme="light"] .bottom-cta,
  html[data-theme="light"] .pipeline{
    background:#fff;
    box-shadow:var(--shadow);
    border-color:var(--border);
  }
  html[data-theme="light"] .showcase{overflow:hidden;max-width:100%;border:1px solid var(--border)}
  html[data-theme="light"] .showcase-bar{
    background:linear-gradient(180deg,#FBF8F3,#F3EDE4);
    border-bottom:1px solid var(--border);
  }
  html[data-theme="light"] .showcase-title{color:var(--muted)}
  html[data-theme="light"] .dot{background:rgba(48,36,22,.18)}
  html[data-theme="light"] .task{
    background:#FBF8F3;
    border-color:var(--border);
  }
  html[data-theme="light"] .task-num,
  html[data-theme="light"] .pipe-num{
    background:var(--brass-soft);
    color:var(--brass);
    border-color:rgba(154,98,24,.28);
  }
  html[data-theme="light"] .pipe-row{background:transparent}
  html[data-theme="light"] .secondary,
  html[data-theme="light"] .ghost{
    background:#fff;
    border-color:var(--border-hi);
    color:var(--text)!important;
    box-shadow:0 1px 2px rgba(40,28,12,.04);
  }
  html[data-theme="light"] .secondary:hover,
  html[data-theme="light"] .ghost:hover{
    background:#FBF8F3;
    border-color:rgba(48,36,22,.22);
  }
  html[data-theme="light"] .primary{
    color:#1A1208!important;
    box-shadow:0 2px 8px rgba(154,98,24,.28);
  }
  html[data-theme="light"] .primary:hover{filter:brightness(1.03)}
  html[data-theme="light"] h1{color:var(--text);letter-spacing:-0.02em}
  html[data-theme="light"] h1 em{
    background:linear-gradient(120deg,var(--signal),#1a9a88 45%,var(--brass));
    -webkit-background-clip:text;background-clip:text;
    color:transparent;
  }
  html[data-theme="light"] .hero-sub{color:var(--muted)}
  html[data-theme="light"] .hero-sub strong{color:var(--text);font-weight:600}
  html[data-theme="light"] .trust{color:var(--faint)}
  html[data-theme="light"] .eyebrow{color:var(--brass)}
  html[data-theme="light"] .section-head h2{color:var(--text)}
  html[data-theme="light"] .section-head p{color:var(--muted)}
  html[data-theme="light"] .price-card.featured{
    border-color:rgba(154,98,24,.38);
    background:linear-gradient(180deg,#FFFCF8 0%,#FFFFFF 48%);
    box-shadow:0 12px 36px rgba(154,98,24,.12),var(--shadow);
  }
  html[data-theme="light"] .price-badge{
    background:var(--brass);
    color:#fff;
  }
  html[data-theme="light"] .price-amount span,
  html[data-theme="light"] .price-desc,
  html[data-theme="light"] .price-list,
  html[data-theme="light"] .price-note{color:var(--muted)}
  html[data-theme="light"] .compare-card.yes{
    border-color:rgba(11,127,110,.28);
    background:linear-gradient(180deg,rgba(11,127,110,.06),#fff);
  }
  html[data-theme="light"] .bottom-cta{
    background:linear-gradient(180deg,#FFFCF7,#FFFFFF);
    border:1px solid var(--border);
  }
  html[data-theme="light"] .bottom-cta h2{color:var(--text)}
  html[data-theme="light"] .bottom-cta p{color:var(--muted)}
  html[data-theme="light"] .panel-label{color:var(--brass)}
  html[data-theme="light"] .panel h3{color:var(--text)}
  html[data-theme="light"] .panel p{color:var(--muted)}
  .ambient{position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% -10%,rgba(123,235,212,.12),transparent 55%),radial-gradient(ellipse at 100% 100%,rgba(231,169,97,.08),transparent 50%)}
  .wrap{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:0 20px 96px;width:100%;box-sizing:border-box;min-width:0;overflow-x:clip}
  .beta-banner{
    position:relative;
    z-index:30;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    padding:6px 14px;
    background:rgba(231,169,97,.08);
    border-bottom:1px solid var(--border);
    font-size:12px;
    line-height:1.3;
    text-align:center;
  }
  .beta-pill{
    display:inline-flex;
    align-items:center;
    padding:1px 7px;
    border-radius:999px;
    border:1px solid rgba(231,169,97,.4);
    background:transparent;
    color:var(--brass);
    font-size:10px;
    font-weight:700;
    letter-spacing:.06em;
    text-transform:uppercase;
  }
  .beta-copy{color:var(--muted);font-weight:400}
  html[data-theme="light"] .beta-banner{
    background:rgba(196,120,32,.08);
  }
  .header{
    position:relative;z-index:30;width:100%;
    box-sizing:border-box;
  }
  .header-inner{
    display:flex;align-items:center;justify-content:space-between;gap:12px;
    max-width:1200px;margin:0 auto;width:100%;
    padding:12px 24px;min-height:56px;box-sizing:border-box;
    min-width:0;
  }
  .logo{display:inline-flex;align-items:center;gap:10px;font-weight:600;color:inherit;text-decoration:none;flex-shrink:0;min-width:0}
  .logo-img{border-radius:6px;flex-shrink:0;display:block}
  .nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;min-width:0;max-width:100%}
  .nav a{color:var(--muted);font-size:14px;font-weight:500;padding:8px 12px;border-radius:999px;text-decoration:none}
  .primary{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#F0BC80,var(--brass));color:#1A1208!important;font-weight:600;font-size:14.5px;padding:10px 18px;border-radius:999px;text-decoration:none}
  .primary.lg{font-size:16px;padding:14px 28px}.primary.block,.secondary.block{width:100%;text-align:center}
  .secondary,.ghost{display:inline-flex;align-items:center;justify-content:center;background:var(--surface);border:1px solid var(--border-hi);color:var(--text)!important;font-weight:500;font-size:14.5px;padding:12px 20px;border-radius:999px;text-decoration:none}
  .ghost{padding:8px 16px;font-size:14px}
  .hero{text-align:center;padding:72px 0 48px;max-width:760px;margin:0 auto}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin-bottom:18px}
  .eyebrow span{width:6px;height:6px;border-radius:99px;background:var(--signal);box-shadow:0 0 12px var(--signal)}
  h1{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:clamp(2.1rem,6vw,3.5rem);line-height:1.08;letter-spacing:-.02em;margin:0 0 16px}
  h1 em{font-style:normal;background:linear-gradient(120deg,var(--signal),#a8f0e0 40%,var(--brass));-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero-sub{font-size:clamp(1rem,2.2vw,1.15rem);line-height:1.55;color:var(--muted);max-width:560px;margin:0 auto 28px}
  .hero-sub strong{color:var(--text);font-weight:600}
  .cta-row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:20px}
  .trust{font-size:13px;color:var(--faint);margin:0}
  .showcase{margin:40px auto 0;max-width:880px;border-radius:24px;border:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));box-shadow:0 40px 80px -40px rgba(0,0,0,.8);overflow:hidden}
  .showcase-bar{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border);background:rgba(0,0,0,.25)}
  .dot{width:10px;height:10px;border-radius:99px;background:#3a3a44}
  .dot:nth-child(1){background:#ff5f57}.dot:nth-child(2){background:#febc2e}.dot:nth-child(3){background:#28c840}
  .showcase-title{margin-left:8px;font-size:12.5px;color:var(--faint)}
  .showcase-body{display:grid;grid-template-columns:1.1fr .9fr;min-height:320px}
  .panel{padding:28px 24px}
  .panel-producer{border-left:1px solid var(--border);background:rgba(123,235,212,.03)}
  .panel-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--brass);font-weight:600;margin-bottom:10px}
  .panel h3{font-family:Fraunces,serif;font-weight:500;font-size:22px;margin:0 0 8px}
  .panel p{color:var(--muted);font-size:14.5px;line-height:1.5;margin:0 0 18px}
  .wave{
    display:flex;align-items:flex-end;justify-content:center;
    gap:3px;height:56px;margin:16px auto 8px;
    max-width:320px;width:100%;
    transform-origin:center bottom;
  }
  .wave i{
    flex:1;min-width:3px;max-width:10px;border-radius:4px;
    background:linear-gradient(180deg,var(--signal),rgba(123,235,212,.22));
    opacity:.9;
    transform-origin:center bottom;
    animation:wavePulse 1.35s ease-in-out infinite;
    will-change:transform,opacity;
  }
  .wave i:nth-child(odd){animation-delay:.12s}
  .wave i:nth-child(3n){animation-delay:.28s}
  .wave i:nth-child(4n){animation-delay:.42s}
  .wave i:nth-child(5n){animation-delay:.08s}
  @keyframes wavePulse{
    0%,100%{transform:scaleY(.42);opacity:.5}
    50%{transform:scaleY(1);opacity:1}
  }

  @media (min-width:900px){
    .wave{
      height:88px;gap:5px;max-width:520px;margin:24px auto 14px;
    }
    .wave i{
      min-width:5px;max-width:14px;border-radius:5px;
      animation-duration:1.5s;
    }
  }
  @media (min-width:1200px){
    .wave{
      height:108px;gap:6px;max-width:640px;margin:28px auto 16px;
    }
    .wave i{min-width:6px;max-width:16px;border-radius:6px}
  }
  .chip{display:inline-flex;font-size:12px;padding:6px 10px;border-radius:999px;background:rgba(123,235,212,.14);color:var(--signal);border:1px solid rgba(123,235,212,.25);margin-right:6px;margin-bottom:6px}
  .task{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;background:var(--surface);border:1px solid var(--border);margin-bottom:10px}
  .task strong{display:block;font-size:13.5px;margin-bottom:2px}.task span{font-size:12.5px;color:var(--muted);line-height:1.4}
  .task-num{width:28px;height:28px;border-radius:8px;background:rgba(231,169,97,.15);color:var(--brass);font-size:12px;font-weight:600;display:grid;place-items:center;flex-shrink:0}
  .showcase-cta{display:flex;width:100%;margin-top:14px;padding:12px 16px;font-size:14px}
  .section{margin-top:88px}
  .section-head{text-align:center;max-width:640px;margin:0 auto 40px}
  .section-head h2{font-family:Fraunces,serif;font-weight:500;font-size:clamp(1.55rem,4vw,2.2rem);margin:0 0 12px}
  .section-head p{color:var(--muted);line-height:1.55;font-size:15px;margin:0}
  .pipeline{
    display:grid;
    grid-template-columns:1fr;
    gap:12px;
    max-width:920px;
    margin:0 auto;
  }
  @media (min-width:720px){
    .pipeline{grid-template-columns:1fr 1fr;gap:14px}
    .pipeline .pipe-row:last-child{grid-column:1 / -1;max-width:460px;margin:0 auto;width:100%}
  }
  .pipe-row{
    display:grid;
    grid-template-columns:44px 1fr;
    gap:0 14px;
    align-items:start;
    padding:20px 18px;
    border-radius:18px;
    border:1px solid var(--border);
    background:rgba(255,255,255,.03);
    transition:border-color .2s ease, background .2s ease, transform .2s ease;
  }
  .pipe-row:hover{
    border-color:rgba(231,169,97,.35);
    background:rgba(231,169,97,.06);
    transform:translateY(-1px);
  }
  .pipe-num{
    width:40px;height:40px;border-radius:12px;
    display:grid;place-items:center;
    font-size:14px;font-weight:700;
    color:var(--brass);
    background:rgba(231,169,97,.14);
    border:1px solid rgba(231,169,97,.28);
  }
  .pipe-body h3{font-size:16px;font-weight:650;margin:2px 0 6px;letter-spacing:-.01em}
  .pipe-body p,.pipe-row p{font-size:14px;color:var(--muted);line-height:1.55;margin:0}
  .section-kicker{
    display:inline-block;
    margin:0 0 10px;
    font-size:12px;font-weight:700;
    letter-spacing:.12em;text-transform:uppercase;
    color:var(--brass);
  }
  .compare{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:800px;margin:0 auto}
  .compare-card{padding:22px;border-radius:18px;border:1px solid var(--border);background:var(--surface)}
  .compare-card.yes{border-color:rgba(123,235,212,.35);background:radial-gradient(ellipse at 50% 0%,rgba(123,235,212,.08),transparent 55%),rgba(255,255,255,.04)}
  .compare-card h3{font-family:Fraunces,serif;font-weight:500;font-size:1.2rem;margin:0 0 12px}
  .compare-card ul{list-style:none;margin:0;padding:0}
  .compare-card li{font-size:14px;padding:8px 0;border-top:1px solid var(--border);color:var(--muted)}
  .compare-card.yes li{color:var(--text)}
  .cost-compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:900px;margin:0 auto}
  .cost-card{padding:28px 24px;border-radius:22px;border:1px solid var(--border);background:var(--surface)}
  .cost-card.studio-app{border-color:rgba(123,235,212,.35);background:radial-gradient(ellipse at 50% 0%,rgba(123,235,212,.1),transparent 55%),rgba(255,255,255,.04)}
  .cost-label{font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;color:var(--muted)}
  .cost-card.studio-app .cost-label{color:var(--signal)}
  .cost-card h3{font-family:Fraunces,serif;font-weight:500;font-size:1.45rem;margin:0 0 8px}
  .cost-card>p{font-size:14px;color:var(--muted);line-height:1.5;margin:0 0 18px}
  .cost-total{font-family:Fraunces,serif;font-size:2.1rem;font-weight:500;margin-bottom:4px}
  .cost-total span{font-family:Inter,sans-serif;font-size:14px;font-weight:500;color:var(--muted)}
  .cost-sub{font-size:13px;color:var(--faint);margin-bottom:16px}
  .cost-list{list-style:none;margin:0;padding:0}
  .cost-list li{font-size:14px;padding:9px 0;border-top:1px solid var(--border);color:var(--text);line-height:1.4;display:flex;justify-content:space-between;gap:12px}
  .cost-list li em{font-style:normal;color:var(--muted);font-size:13px;text-align:right;white-space:nowrap}
  .cost-list li.dim{color:var(--muted)}
  .gap-callout{max-width:900px;margin:20px auto 0;padding:18px 20px;border-radius:16px;border:1px solid rgba(231,169,97,.28);background:rgba(231,169,97,.15);font-size:14.5px;line-height:1.55;color:var(--text)}
  .gap-callout strong{color:var(--brass);font-weight:600}
  .pricing{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:stretch;width:100%;max-width:100%;box-sizing:border-box}
  .price-card{position:relative;padding:18px 14px 16px;border-radius:16px;border:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;min-width:0;overflow:hidden}
  .price-card.featured{border-color:rgba(231,169,97,.45);background:radial-gradient(ellipse at 50% 0%,rgba(231,169,97,.12),transparent 55%),rgba(255,255,255,.05);box-shadow:0 12px 28px -18px rgba(231,169,97,.4)}
  .price-badge{position:absolute;top:10px;right:10px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1A1208;background:linear-gradient(180deg,#F0BC80,var(--brass));padding:3px 8px;border-radius:999px}
  .price-name{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase}
  .price-amount{font-family:Fraunces,serif;font-size:1.65rem;font-weight:500;letter-spacing:-.02em;margin-bottom:2px;line-height:1.15}
  .price-amount span{font-family:Inter,sans-serif;font-size:12px;font-weight:500;color:var(--muted)}
  .price-desc{font-size:12px;color:var(--muted);line-height:1.35;margin:0 0 12px}
  .price-list{list-style:none;margin:0 0 14px;padding:0;flex:1}
  .price-list li{font-size:12px;color:var(--text);padding:5px 0;border-top:1px solid var(--border);display:flex;gap:6px;align-items:flex-start;line-height:1.3}
  .price-list li::before{content:"✓";color:var(--signal);font-weight:600;flex-shrink:0}
  .price-card .primary.block,.price-card .secondary.block{margin-top:auto;padding:10px 12px;font-size:12px;white-space:nowrap}
  .price-note{text-align:center;margin-top:20px;font-size:13px;color:var(--faint)}
  .bottom-cta{margin-top:72px;text-align:center;padding:48px 24px;border-radius:24px;border:1px solid var(--border);background:radial-gradient(ellipse at 50% 0%,rgba(123,235,212,.1),transparent 55%),rgba(255,255,255,.03)}
  .bottom-cta h2{font-family:Fraunces,serif;font-weight:500;font-size:clamp(1.45rem,3.5vw,2rem);margin:0 0 10px}
  .bottom-cta p{color:var(--muted);margin:0 0 20px}
  @media (max-width:1100px){.pricing{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}}@media (max-width:640px){.pricing{grid-template-columns:1fr;max-width:360px;margin:0 auto}.compare,.cost-compare{grid-template-columns:1fr}}
  @media (max-width:720px){.wrap{padding-left:16px;padding-right:16px}.desktop-nav a:not(.primary):not(.ghost){display:none}.hero{padding:28px 0 20px}.section{margin-top:56px}.cta-row{flex-direction:column;align-items:stretch}.cta-row .primary,.cta-row .secondary{width:100%}.showcase-body{grid-template-columns:1fr}.panel-producer{border-left:none;border-top:1px solid var(--border)}footer{flex-direction:column;align-items:flex-start}}
  
  @media (max-width:720px){
    .desktop-nav a:not(.primary):not(.ghost){display:none}
    .header-inner{padding:10px 16px;gap:8px}
    .nav{gap:6px}
    .wrap{padding-left:16px;padding-right:16px}
  }
  @media (max-width:400px){.wrap{padding-left:14px;padding-right:14px}}


  .create-hook{
    max-width:min(560px,100%);margin:28px auto 0;text-align:center;width:100%;box-sizing:border-box;
  }
  .create-hook-lead{
    font-size:15px;line-height:1.55;color:var(--muted);margin:0 0 18px;
  }
  .create-bar{
    display:flex;flex-direction:column;gap:12px;width:100%;max-width:100%;box-sizing:border-box;
    padding:14px 14px 12px;
    border-radius:20px;
    background:rgba(255,255,255,.04);
    border:1px solid var(--border-hi);
    box-shadow:0 16px 40px rgba(0,0,0,.25);
    text-align:left;
  }
  .create-bar input{
    width:100%;box-sizing:border-box;
    background:transparent;border:none;outline:none;
    color:var(--text);font-size:16px;padding:8px 6px;
    font-family:inherit;
  }
  .create-bar input::placeholder{color:var(--faint)}
  .create-bar-actions{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
  }
  .create-bar-hint{
    width:36px;height:36px;border-radius:999px;
    display:grid;place-items:center;
    background:rgba(255,255,255,.06);color:var(--muted);font-size:20px;
  }
  .create-btn{
    border:none;cursor:pointer;font-family:inherit;font-weight:700;
    font-size:14.5px;padding:11px 20px;border-radius:999px;
    color:#1A1208;
    background:linear-gradient(135deg,#F0BC80 0%,#E7A961 40%,#E85D4C 100%);
    box-shadow:0 8px 22px rgba(231,169,97,.28);
    display:inline-flex;align-items:center;gap:8px;
  }
  .create-btn:hover{filter:brightness(1.05)}
  .create-google-row{
    display:flex;flex-direction:column;align-items:center;gap:10px;
    margin-top:16px;
  }
  .google-btn{
    display:inline-flex;align-items:center;justify-content:center;gap:10px;
    width:100%;max-width:320px;
    padding:12px 16px;border-radius:999px;
    border:1px solid var(--border-hi);
    background:rgba(255,255,255,.06);
    color:var(--text);font-weight:600;font-size:14px;
    font-family:inherit;cursor:pointer;
  }
  .google-btn:hover{background:rgba(255,255,255,.1)}
  .google-btn:disabled{opacity:.6;cursor:wait}
  .create-email-link{
    background:none;border:none;color:var(--muted);font-size:13px;
    cursor:pointer;font-family:inherit;text-decoration:underline;
    text-underline-offset:3px;
  }
  .create-error{color:#F07167;font-size:13px;margin-top:10px}

  .reg-modal-backdrop{
    position:fixed;inset:0;z-index:80;
    background:rgba(5,5,8,.72);
    backdrop-filter:blur(8px);
    display:grid;place-items:center;
    padding:20px;
  }
  .reg-modal{
    width:100%;max-width:400px;
    background:#12101A;
    border:1px solid rgba(255,255,255,.1);
    border-radius:20px;
    padding:28px 24px 24px;
    box-shadow:0 24px 64px rgba(0,0,0,.45);
    position:relative;
    text-align:left;
  }
  .reg-modal-close{
    position:absolute;top:12px;right:14px;
    background:none;border:none;color:var(--muted);
    font-size:24px;line-height:1;cursor:pointer;padding:4px 8px;
  }
  .reg-modal-kicker{
    font-size:11px;letter-spacing:.12em;text-transform:uppercase;
    color:var(--brass);margin:0 0 8px;font-weight:600;
  }
  .reg-modal h2{
    font-family:Fraunces,Georgia,serif;font-size:1.45rem;
    margin:0 0 10px;color:var(--text);font-weight:600;
  }
  .reg-modal-body{
    font-size:14.5px;line-height:1.5;color:var(--muted);margin:0 0 20px;
  }
  .reg-modal-body strong{color:var(--text);font-weight:600}
  .reg-modal-google{max-width:none;width:100%;margin:0}
  .reg-modal-or{
    display:flex;align-items:center;gap:12px;margin:16px 0;
    color:var(--faint);font-size:12px;
  }
  .reg-modal-or::before,.reg-modal-or::after{
    content:"";flex:1;height:1px;background:rgba(255,255,255,.1);
  }
  .reg-modal-primary{
    display:block;text-align:center;text-decoration:none;
    padding:13px 16px;border-radius:12px;font-weight:700;font-size:14.5px;
    background:linear-gradient(135deg,#F0BC80,#E7A961);
    color:#1A1208;margin-bottom:10px;
  }
  .reg-modal-secondary{
    display:block;text-align:center;font-size:13px;color:var(--muted);
    text-decoration:none;padding:8px;
  }
  .reg-modal-secondary:hover{color:var(--text)}
  html[data-theme="light"] .reg-modal-backdrop{background:rgba(40,28,12,.45)}
  html[data-theme="light"] .reg-modal{
    background:#FFFBF6;border-color:var(--border);box-shadow:var(--shadow);
  }
  html[data-theme="light"] .reg-modal-or::before,
  html[data-theme="light"] .reg-modal-or::after{background:var(--border)}

  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
  html[data-theme="light"] .create-bar{
    background:#fff;border-color:var(--border);box-shadow:var(--shadow);
  }
  html[data-theme="light"] .create-bar-hint{background:var(--brass-soft);color:var(--brass)}
  html[data-theme="light"] .google-btn{
    background:#fff;border-color:var(--border);color:var(--text);
  }
  @media (min-width:900px){
    .create-hook{max-width:640px;margin:36px auto 12px}
    .create-hook-lead{font-size:16px}
    .create-bar{padding:16px 16px 14px;border-radius:22px}
    .create-bar input{font-size:17px}
  }

  @media (min-width:1100px){
    .wrap{max-width:1240px;padding:0 40px 96px}
    .header-inner{max-width:1240px;padding:12px 40px}
    .hero{padding:72px 0 48px;max-width:880px}
    .hero h1{font-size:clamp(2.6rem,4vw,3.4rem);letter-spacing:-0.03em}
    .hero-sub{font-size:1.2rem;max-width:620px}
    .hero-actions{gap:14px;margin-top:28px}
    .grid-3{grid-template-columns:repeat(3,1fr);gap:22px}
    .grid-2{grid-template-columns:repeat(2,1fr);gap:22px}
    .price-grid{grid-template-columns:repeat(3,1fr);gap:22px;max-width:1100px;margin-left:auto;margin-right:auto}
    .section{padding:56px 0}
    .section-title{font-size:clamp(1.6rem,2.2vw,2rem)}
    .card{padding:28px 26px;border-radius:18px}
    .nav-inner{max-width:1240px;padding:0 40px}
  }
  @media (min-width:1400px){
    .wrap{max-width:1320px}
    .header-inner{max-width:1320px}
    .nav-inner{max-width:1320px}
  }

  /* —— Listen rail (Suno-style) —— */
  .listen-section{
    margin:56px auto 8px;
    max-width:100%;
    padding:8px 0 12px;
  }
  .listen-head{text-align:center;max-width:640px;margin:0 auto 28px;padding:0 8px}
  .listen-title{
    font-family:var(--serif,Georgia,serif);
    font-size:clamp(1.75rem,4vw,2.4rem);
    font-weight:500;
    letter-spacing:-0.02em;
    line-height:1.15;
    color:var(--text);
    margin:0 0 12px;
  }
  .listen-sub{
    margin:0;
    font-size:15px;
    line-height:1.55;
    color:var(--muted);
  }
  .listen-rail-wrap{position:relative;margin:0 -8px}
  .listen-rail{
    display:flex;
    gap:16px;
    overflow-x:auto;
    scroll-snap-type:x mandatory;
    padding:8px 40px 20px;
    -webkit-overflow-scrolling:touch;
    scrollbar-width:none;
  }
  .listen-rail::-webkit-scrollbar{display:none}
  .listen-arrow{
    position:absolute;
    top:42%;
    transform:translateY(-50%);
    z-index:2;
    width:36px;height:36px;
    border-radius:999px;
    border:1px solid var(--border);
    background:rgba(12,10,16,.85);
    color:var(--text);
    font-size:22px;
    line-height:1;
    cursor:pointer;
    display:grid;place-items:center;
    backdrop-filter:blur(8px);
  }
  .listen-arrow-left{left:4px}
  .listen-arrow-right{right:4px}
  @media (max-width:640px){
    .listen-arrow{display:none}
    .listen-rail{padding-left:16px;padding-right:16px}
  }
  .listen-card{
    flex:0 0 220px;
    scroll-snap-align:start;
    max-width:240px;
  }
  .listen-cover{
    position:relative;
    width:100%;
    aspect-ratio:1;
    border-radius:14px;
    border:none;
    padding:0;
    cursor:pointer;
    overflow:hidden;
    display:block;
    box-shadow:0 16px 40px -20px rgba(0,0,0,.7);
  }
  .listen-card.is-playing .listen-cover{
    box-shadow:0 0 0 2px var(--brass),0 16px 40px -16px rgba(231,169,97,.45);
  }
  .listen-cover-img{
    width:100%;height:100%;object-fit:cover;display:block;
  }
  .listen-cover-glyph{
    position:absolute;inset:0;
    display:grid;place-items:center;
    font-size:48px;
    opacity:.35;
    color:#fff;
    pointer-events:none;
  }
  .listen-play{
    position:absolute;
    top:12px;left:12px;
    width:40px;height:40px;
    border-radius:999px;
    background:rgba(0,0,0,.55);
    color:#fff;
    display:grid;place-items:center;
    font-size:14px;
    font-weight:700;
    backdrop-filter:blur(6px);
    border:1px solid rgba(255,255,255,.15);
  }
  .listen-play.on{
    background:linear-gradient(180deg,#F0BC80,var(--brass,#e7a961));
    color:#1A1208;
    border-color:transparent;
  }
  .listen-badge{
    position:absolute;
    bottom:10px;left:10px;
    padding:4px 10px;
    border-radius:999px;
    background:rgba(0,0,0,.55);
    color:#fff;
    font-size:11px;
    font-weight:650;
    backdrop-filter:blur(6px);
  }
  .listen-meta{margin-top:10px;padding:0 2px}
  .listen-track-title{
    font-size:14px;font-weight:650;color:var(--text);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  }
  .listen-track-artist{
    margin-top:4px;
    font-size:12.5px;color:var(--muted);
    display:flex;align-items:center;gap:6px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  }
  .listen-avatar{
    flex-shrink:0;
    width:18px;height:18px;border-radius:999px;
    background:rgba(231,169,97,.2);
    color:var(--brass);
    font-size:9px;font-weight:800;
    display:grid;place-items:center;
  }
  .listen-cta-row{text-align:center;margin-top:8px}
  .listen-cta{
    display:inline-flex;justify-content:center;
    padding:12px 28px;border-radius:999px;
    font-size:14.5px;font-weight:650;
  }
  .listen-footnote{margin:10px 0 0;font-size:12.5px;color:var(--faint)}
  html[data-theme="light"] .listen-arrow{
    background:rgba(255,255,255,.92);
  }
  html[data-theme="light"] .listen-play{
    background:rgba(255,255,255,.85);
    color:#1A1208;
  }

  /* —— Product demo (desktop workspace screenshots) —— */
  .product-demo{
    margin:36px auto 12px;
    width:100%;
    max-width:100%;
    padding:0;
    box-sizing:border-box;
  }
  .product-demo-card{
    border-radius:20px;
    border:1px solid var(--border);
    background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));
    box-shadow:0 32px 64px -40px rgba(0,0,0,.75);
    padding:22px 16px 20px;
    text-align:left;
    width:100%;
    box-sizing:border-box;
  }
  .product-demo-title{
    margin:0 0 10px;
    font-family:var(--serif,Georgia,serif);
    font-size:clamp(1.35rem,3vw,1.85rem);
    font-weight:500;
    letter-spacing:-0.02em;
    line-height:1.2;
    color:var(--text);
  }
  .product-demo-body{
    margin:0 0 16px;
    font-size:14.5px;
    line-height:1.55;
    color:var(--muted);
    max-width:56ch;
  }
  .product-demo-frame{
    border-radius:14px;
    overflow:hidden;
    border:1px solid var(--border);
    background:#0a0a0c;
    width:100%;
    margin:0;
    /* No forced aspect-ratio — keep natural image height */
  }
  .product-demo-img{
    width:100%;
    height:auto;
    max-width:100%;
    display:block;
    object-fit:contain;
    object-position:center top;
    vertical-align:top;
  }
  .product-demo-dots{
    display:flex;
    justify-content:center;
    gap:8px;
    margin:14px 0 4px;
    pointer-events:none;
  }
  .product-demo-dot{
    width:7px;height:7px;border-radius:999px;
    background:rgba(255,255,255,.22);
    display:inline-block;
  }
  .product-demo-dot.on{background:var(--brass,#e7a961);width:18px}
  .product-demo-cta{margin-top:14px;text-align:center}
  .product-demo-cta .primary{
    display:inline-flex;justify-content:center;
    padding:12px 28px;border-radius:999px;
    font-size:14.5px;font-weight:650;
  }
  html[data-theme="light"] .product-demo-card{
    background:linear-gradient(180deg,#fff,rgba(255,255,255,.92));
    box-shadow:0 24px 48px -28px rgba(0,0,0,.18);
  }
  html[data-theme="light"] .product-demo-dot{background:rgba(0,0,0,.18)}
  @media (min-width:720px){
    .product-demo{
      margin-top:48px;
      position:relative;
      left:50%;
      transform:translateX(-50%);
      width:min(100vw - 48px, 1100px);
      max-width:1100px;
    }
    .product-demo-card{padding:28px 28px 24px;border-radius:24px}
    .product-demo-frame{border-radius:16px}
  }
  @media (min-width:1100px){
    .product-demo{
      width:min(100vw - 64px, 1280px);
      max-width:1280px;
    }
    .product-demo-card{padding:32px 40px 28px}
    .product-demo-body{font-size:15.5px;max-width:64ch}
  }
  @media (min-width:1400px){
    .product-demo{
      width:min(100vw - 80px, 1400px);
      max-width:1400px;
    }
  }


  .motion-sections{
    margin:56px 0 24px;
    padding:0 4px;
  }
  .motion-head{margin-bottom:28px}
  .motion-grid{
    display:grid;
    gap:28px;
    grid-template-columns:1fr;
  }
  .motion-card{
    display:flex;
    flex-direction:column;
    gap:16px;
  }
  .motion-kicker{
    margin:0 0 6px;
    font-size:11px;
    font-weight:700;
    letter-spacing:.12em;
    text-transform:uppercase;
    color:var(--brass,#e7a961);
  }
  .motion-title{
    margin:0 0 8px;
    font-family:Fraunces,serif;
    font-weight:500;
    font-size:clamp(1.25rem,3.5vw,1.65rem);
    color:var(--text,#f4f1ec);
  }
  .motion-body{
    margin:0;
    font-size:14.5px;
    line-height:1.55;
    color:var(--muted,#9b96a3);
    max-width:42ch;
  }
  .motion-frame{
    position:relative;
    width:100%;
    max-width:440px;
    margin:0 auto;
    aspect-ratio:4/5;
    border-radius:24px;
    overflow:hidden;
    background:#050508;
    box-shadow:0 24px 48px -28px rgba(0,0,0,.55);
    border:1px solid rgba(255,255,255,.07);
  }
  .motion-frame.ready .motion-skeleton{opacity:0;pointer-events:none}
  .motion-skeleton{
    position:absolute;inset:0;
    background:linear-gradient(120deg,rgba(255,255,255,.04),rgba(231,169,97,.08),rgba(255,255,255,.04));
    background-size:200% 100%;
    animation:motionShimmer 1.4s ease-in-out infinite;
    transition:opacity .35s ease;
  }
  @keyframes motionShimmer{
    0%{background-position:100% 0}
    100%{background-position:-100% 0}
  }
  .motion-iframe{
    position:absolute;inset:0;
    width:100%;height:100%;
    border:0;
    display:block;
    background:transparent;
  }
  html[data-theme="light"] .motion-title{color:var(--text)}
  html[data-theme="light"] .motion-body{color:var(--muted)}
  html[data-theme="light"] .motion-frame{
    box-shadow:0 20px 40px -24px rgba(0,0,0,.2);
    border-color:rgba(0,0,0,.08);
  }
  @media (min-width:900px){
    .motion-sections{margin:72px 0 32px}
    .motion-grid{
      grid-template-columns:1fr 1fr;
      gap:32px;
      align-items:start;
    }
    .motion-frame{max-width:100%}
  }

  .footer-banner{
    width:100%;
    margin:48px 0 0;
    padding:0;
    line-height:0;
    overflow:hidden;
    background:#0a0a0a;
  }
  .footer-banner-img{
    width:100%;
    height:auto;
    display:block;
    object-fit:cover;
    max-height:min(42vh,420px);
  }
  @media (min-width:900px){
    .footer-banner-img{max-height:min(48vh,520px)}
  }

`;

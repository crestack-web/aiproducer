import Link from "next/link";

/** Unauthenticated start path: sign up, then onboarding. */
const START_HREF = "/auth?mode=signup&next=/onboarding";

export default function WelcomePage() {
  return (
    <>
      <style>{css}</style>
      <div className="ambient" aria-hidden />
      <div className="wrap">
        <header className="header">
          <Link href="/" className="logo">
            <span className="logo-mark">◆</span> Studio
          </Link>
          <nav className="nav desktop-nav">
            <a href="#dashboard">Dashboard</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <Link href="/auth?mode=login&next=/onboarding" className="ghost">
              Log in
            </Link>
            <Link href={START_HREF} className="primary">
              Start creating
            </Link>
          </nav>
        </header>

        <section className="hero">
          <div className="eyebrow">
            <span /> AI Music Producer
          </div>
          <h1>
            Radio-ready songs.
            <br />
            <em>With your real voice.</em>
          </h1>
          <p className="hero-sub">
            Create a beat, follow a clear recording plan, and let Studio assemble, mix, and master —
            so you leave with a <strong>finished, professional-sounding track</strong>, not a rough
            freestyle.
          </p>
          <div className="cta-row">
            <Link href={START_HREF} className="primary lg">
              Create a song
            </Link>
            <a href="#dashboard" className="secondary">
              Preview the dashboard
            </a>
          </div>
          <p className="trust">No music theory · Pay per finished song · Your voice stays the lead</p>
        </section>

        <section className="section" id="dashboard">
          <div className="section-head">
            <h2>Your studio dashboard</h2>
            <p>
              This is where songs start. Pick a genre and mood, generate a beat, then the AI producer
              guides every vocal. Trying it takes you through a short setup first.
            </p>
          </div>

          <div className="dash" aria-label="Studio dashboard preview">
            <aside className="dash-side">
              <div className="dash-side-brand">
                <span className="logo-mark">◆</span> Studio
              </div>
              <p className="dash-side-label">Library</p>
              <div className="dash-nav-item active">Home</div>
              <div className="dash-nav-item">Sessions</div>
              <div className="dash-nav-item">Credits</div>
              <div className="dash-side-foot">
                <span className="dash-avatar">A</span>
                <span>Artist</span>
              </div>
            </aside>

            <div className="dash-main">
              <div className="dash-top">
                <div>
                  <h3 className="dash-greeting">Make music with your voice</h3>
                  <p className="dash-sub">Beat → producer plan → guided recording → mix & master</p>
                </div>
                <span className="dash-badge">Preview</span>
              </div>

              <div className="dash-card">
                <div className="dash-card-title">New song</div>
                <div className="dash-fields">
                  <div className="dash-field">
                    <span>Genre</span>
                    <div className="dash-select">R&B</div>
                  </div>
                  <div className="dash-field">
                    <span>Mood</span>
                    <div className="dash-select">Emotional</div>
                  </div>
                </div>
                <div className="dash-modes">
                  <span className="dash-mode on">AI beat</span>
                  <span className="dash-mode">Upload my beat</span>
                </div>
                <Link href={START_HREF} className="primary dash-cta">
                  Start producer session
                </Link>
                <p className="dash-hint">
                  You'll create an account and finish a quick onboarding, then land in your real
                  dashboard to generate the beat.
                </p>
              </div>

              <div className="dash-recent">
                <div className="dash-card-title">Recent sessions</div>
                <div className="dash-projects">
                  <div className="dash-project">
                    <div className="dash-wave" aria-hidden>
                      <i style={{ height: "40%" }} />
                      <i style={{ height: "70%" }} />
                      <i style={{ height: "55%" }} />
                      <i style={{ height: "90%" }} />
                      <i style={{ height: "45%" }} />
                    </div>
                    <div>
                      <strong>Late Night · R&B</strong>
                      <span>Recording · Chorus lead</span>
                    </div>
                  </div>
                  <div className="dash-project">
                    <div className="dash-wave" aria-hidden>
                      <i style={{ height: "60%" }} />
                      <i style={{ height: "35%" }} />
                      <i style={{ height: "80%" }} />
                      <i style={{ height: "50%" }} />
                      <i style={{ height: "65%" }} />
                    </div>
                    <div>
                      <strong>Afrobeats · Confident</strong>
                      <span>Master ready</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dash-cta-row">
            <Link href={START_HREF} className="primary lg">
              Generate my first song
            </Link>
          </div>
        </section>

        <section className="section" id="how">
          <div className="section-head">
            <h2>From first idea to radio-ready — in 5 steps</h2>
            <p>Studio plans the song, guides every vocal layer, then cleans, balances, and masters.</p>
          </div>
          <div className="pipeline">
            {[
              ["1", "Create the beat", "AI instrumental built for vocals — or upload your own."],
              ["2", "Get a producer plan", "Intro, verse, chorus mapped. Exactly what to record next."],
              ["3", "Record, guided", "One task at a time. Lead, doubles, harmonies, adlibs."],
              ["4", "Assemble & polish", "Takes placed, cleaned, balanced into intentional stacks."],
              ["5", "Master for release", "Radio-ready export without opening a DAW."],
            ].map(([n, title, body]) => (
              <div className="pipe-row" key={n}>
                <div className="pipe-num">{n}</div>
                <div>
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
              <ul>
                <li>Synthetic vocals</li>
                <li>Hard to claim as your performance</li>
                <li>One-shot output, not a session</li>
              </ul>
            </div>
            <div className="compare-card yes">
              <h3>Studio</h3>
              <ul>
                <li>Your real recorded voice</li>
                <li>Guided layers & structure</li>
                <li>Pro mix & master on every credit</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="section-head">
            <h2>Simple pricing</h2>
            <p>No free tier — buy a single session or a monthly credit pack. Every finished song includes mix & master.</p>
          </div>
          <div className="pricing">
            <div className="price-card featured">
              <div className="price-name">Session</div>
              <div className="price-amount">$4.99 <span>/ song</span></div>
              <p>1 song credit · Guided session · RoEx mix & master · WAV + MP3</p>
              <Link href={START_HREF} className="primary block">Buy a session</Link>
            </div>
            <div className="price-card">
              <div className="price-name">Creator</div>
              <div className="price-amount">$29 <span>/ mo</span></div>
              <p>8 song credits · ~$3.60/song · Commercial use</p>
              <Link href={START_HREF} className="secondary block">Start Creator</Link>
            </div>
            <div className="price-card">
              <div className="price-name">Pro</div>
              <div className="price-amount">$79 <span>/ mo</span></div>
              <p>25 song credits · Priority queue · Stem export when available</p>
              <Link href={START_HREF} className="secondary block">Go Pro</Link>
            </div>
          </div>
        </section>

        <section className="bottom-cta">
          <h2>Your next song can be radio-ready today</h2>
          <p>Set up once → open the dashboard → generate and record with your AI producer.</p>
          <Link href={START_HREF} className="primary lg">Generate my first song</Link>
        </section>

        <footer>
          <span>◆ Studio — AI Music Producer</span>
          <span>You bring the voice. We help you make the song.</span>
        </footer>
      </div>
    </>
  );
}

const css = `
  :root{--bg:#050508;--surface:rgba(255,255,255,.045);--border:rgba(255,255,255,.09);--border-hi:rgba(255,255,255,.16);--text:#F4F1EC;--muted:#9B96A3;--faint:#5C5866;--signal:#7BEBD4;--brass:#E7A961}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}
  .ambient{position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% -10%,rgba(123,235,212,.12),transparent 55%),radial-gradient(ellipse at 100% 100%,rgba(231,169,97,.08),transparent 50%)}
  .wrap{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:0 24px 80px;width:100%}
  .header{display:flex;align-items:center;justify-content:space-between;padding:22px 0;gap:12px}
  .logo{display:inline-flex;align-items:center;gap:10px;font-weight:600;color:inherit;text-decoration:none}
  .logo-mark{color:var(--signal)}
  .nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .nav a{color:var(--muted);font-size:14px;font-weight:500;padding:8px 12px;border-radius:999px;text-decoration:none}
  .primary{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#F0BC80,var(--brass));color:#1A1208!important;font-weight:600;font-size:14.5px;padding:10px 18px;border-radius:999px;text-decoration:none;border:none;cursor:pointer}
  .primary.lg{font-size:16px;padding:14px 28px}.primary.block,.secondary.block{width:100%;text-align:center}
  .secondary,.ghost{display:inline-flex;align-items:center;justify-content:center;background:var(--surface);border:1px solid var(--border-hi);color:var(--text)!important;font-weight:500;font-size:14.5px;padding:12px 20px;border-radius:999px;text-decoration:none}
  .ghost{padding:8px 16px;font-size:14px}
  .hero{text-align:center;padding:48px 0 32px;max-width:780px;margin:0 auto}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin-bottom:18px}
  .eyebrow span{width:6px;height:6px;border-radius:99px;background:var(--signal);box-shadow:0 0 12px var(--signal)}
  h1{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:clamp(2.1rem,6vw,3.5rem);line-height:1.08;letter-spacing:-.02em;margin:0 0 16px}
  h1 em{font-style:normal;background:linear-gradient(120deg,var(--signal),#a8f0e0 40%,var(--brass));-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero-sub{font-size:clamp(1rem,2.2vw,1.15rem);line-height:1.55;color:var(--muted);max-width:560px;margin:0 auto 28px}
  .hero-sub strong{color:var(--text);font-weight:600}
  .cta-row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:20px}
  .trust{font-size:13px;color:var(--faint);margin:0}
  .section{margin-top:72px}
  .section-head{text-align:center;max-width:600px;margin:0 auto 32px}
  .section-head h2{font-family:Fraunces,serif;font-weight:500;font-size:clamp(1.55rem,4vw,2.2rem);margin:0 0 12px}
  .section-head p{color:var(--muted);line-height:1.55;font-size:15px;margin:0}
  .dash{display:grid;grid-template-columns:200px 1fr;border-radius:22px;border:1px solid var(--border);overflow:hidden;background:rgba(0,0,0,.35);box-shadow:0 40px 80px -40px rgba(0,0,0,.85);max-width:960px;margin:0 auto}
  .dash-side{padding:20px 14px;border-right:1px solid var(--border);background:rgba(255,255,255,.02);display:flex;flex-direction:column;gap:4px;min-width:0}
  .dash-side-brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin-bottom:18px;padding:0 8px}
  .dash-side-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);padding:0 8px;margin:0 0 6px}
  .dash-nav-item{padding:10px 12px;border-radius:10px;font-size:13.5px;color:var(--muted)}
  .dash-nav-item.active{background:rgba(123,235,212,.1);color:var(--signal);font-weight:600}
  .dash-side-foot{margin-top:auto;padding:12px 8px 4px;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted);border-top:1px solid var(--border);padding-top:14px}
  .dash-avatar{width:28px;height:28px;border-radius:8px;background:rgba(231,169,97,.2);color:var(--brass);display:grid;place-items:center;font-size:12px;font-weight:700}
  .dash-main{padding:22px 22px 26px;min-width:0}
  .dash-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:18px}
  .dash-greeting{font-family:Fraunces,serif;font-weight:500;font-size:1.35rem;margin:0 0 4px}
  .dash-sub{margin:0;font-size:13.5px;color:var(--muted)}
  .dash-badge{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--brass);border:1px solid rgba(231,169,97,.35);background:rgba(231,169,97,.12);padding:5px 10px;border-radius:999px;flex-shrink:0}
  .dash-card{padding:18px;border-radius:16px;border:1px solid var(--border);background:var(--surface);margin-bottom:16px}
  .dash-card-title{font-size:14px;font-weight:600;margin-bottom:14px}
  .dash-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
  .dash-field span{display:block;font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:500}
  .dash-select{padding:11px 12px;border-radius:10px;border:1px solid var(--border);background:rgba(0,0,0,.25);font-size:14px;color:var(--text)}
  .dash-modes{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
  .dash-mode{padding:8px 12px;border-radius:999px;font-size:13px;color:var(--muted);border:1px solid var(--border)}
  .dash-mode.on{color:var(--signal);border-color:rgba(123,235,212,.35);background:rgba(123,235,212,.1);font-weight:600}
  .dash-cta{width:100%;padding:13px 18px;font-size:15px}
  .dash-hint{margin:12px 0 0;font-size:12.5px;color:var(--faint);line-height:1.45}
  .dash-recent .dash-card-title{margin-bottom:10px}
  .dash-projects{display:flex;flex-direction:column;gap:8px}
  .dash-project{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.03)}
  .dash-project strong{display:block;font-size:13.5px;margin-bottom:2px}
  .dash-project span{font-size:12px;color:var(--muted)}
  .dash-wave{display:flex;align-items:flex-end;gap:2px;height:28px;width:36px;flex-shrink:0}
  .dash-wave i{flex:1;border-radius:2px;background:linear-gradient(180deg,var(--signal),rgba(123,235,212,.25));opacity:.85}
  .dash-cta-row{display:flex;justify-content:center;margin-top:24px}
  .pipeline{border-radius:20px;border:1px solid var(--border);overflow:hidden;background:rgba(255,255,255,.02);max-width:720px;margin:0 auto}
  .pipe-row{display:grid;grid-template-columns:48px 1fr;gap:0 14px;padding:18px 20px;border-bottom:1px solid var(--border)}
  .pipe-row:last-child{border-bottom:none}
  .pipe-num{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-size:13px;font-weight:700;color:var(--brass);background:rgba(231,169,97,.15);border:1px solid rgba(231,169,97,.25)}
  .pipe-row h3{font-size:15.5px;font-weight:600;margin:0 0 4px}.pipe-row p{font-size:14px;color:var(--muted);line-height:1.5;margin:0}
  .compare{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:800px;margin:0 auto}
  .compare-card{padding:22px;border-radius:18px;border:1px solid var(--border);background:var(--surface)}
  .compare-card.yes{border-color:rgba(123,235,212,.35);background:radial-gradient(ellipse at 50% 0%,rgba(123,235,212,.08),transparent 55%),rgba(255,255,255,.04)}
  .compare-card h3{font-family:Fraunces,serif;font-weight:500;font-size:1.2rem;margin:0 0 12px}
  .compare-card ul{list-style:none;margin:0;padding:0}
  .compare-card li{font-size:14px;padding:8px 0;border-top:1px solid var(--border);color:var(--muted)}
  .compare-card.yes li{color:var(--text)}
  .pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .price-card{padding:24px 20px;border-radius:20px;border:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;gap:10px}
  .price-card.featured{border-color:rgba(231,169,97,.45);background:radial-gradient(ellipse at 50% 0%,rgba(231,169,97,.12),transparent 55%),rgba(255,255,255,.05)}
  .price-name{font-size:14px;font-weight:600;color:var(--muted)}
  .price-amount{font-family:Fraunces,serif;font-size:2.1rem;font-weight:500}
  .price-amount span{font-family:Inter,sans-serif;font-size:14px;color:var(--muted);font-weight:500}
  .price-card>p{font-size:14px;color:var(--muted);line-height:1.45;margin:0 0 8px;flex:1}
  .bottom-cta{margin-top:72px;text-align:center;padding:48px 24px;border-radius:24px;border:1px solid var(--border);background:radial-gradient(ellipse at 50% 0%,rgba(123,235,212,.1),transparent 55%),rgba(255,255,255,.03)}
  .bottom-cta h2{font-family:Fraunces,serif;font-weight:500;font-size:clamp(1.45rem,3.5vw,2rem);margin:0 0 10px}
  .bottom-cta p{color:var(--muted);margin:0 0 20px}
  footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;color:var(--faint);font-size:13px}
  @media (max-width:900px){.pricing{grid-template-columns:1fr;max-width:400px;margin:0 auto}.compare{grid-template-columns:1fr}.dash{grid-template-columns:1fr}.dash-side{display:none}}
  @media (max-width:720px){.wrap{padding-left:16px;padding-right:16px}.desktop-nav a:not(.primary):not(.ghost){display:none}.hero{padding:28px 0 20px}.section{margin-top:56px}.cta-row{flex-direction:column;align-items:stretch}.cta-row .primary,.cta-row .secondary{width:100%}.dash-fields{grid-template-columns:1fr}.dash-main{padding:16px}footer{flex-direction:column;align-items:flex-start}}
  @media (max-width:400px){.wrap{padding-left:14px;padding-right:14px}}
`;

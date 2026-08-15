import Link from "next/link";

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
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <Link href="/auth?mode=login&next=/onboarding" className="ghost">Log in</Link>
            <Link href={START_HREF} className="primary">Start creating</Link>
          </nav>
        </header>

        <section className="hero">
          <div className="eyebrow"><span /> AI Music Producer</div>
          <h1>Radio-ready songs.<br /><em>With your real voice.</em></h1>
          <p className="hero-sub">
            Create a beat, follow a clear recording plan, and let Studio assemble, mix, and master —
            so you leave with a <strong>finished, professional-sounding track</strong>, not a rough freestyle.
          </p>
          <div className="cta-row">
            <Link href={START_HREF} className="primary lg">Create a song</Link>
            <a href="#how" className="secondary">See the 5 steps</a>
          </div>
          <p className="trust">No music theory · Pay per finished song · Your voice stays the lead</p>
        </section>

        <div className="showcase" aria-label="Product preview">
          <div className="showcase-bar">
            <span className="dot" /><span className="dot" /><span className="dot" />
            <span className="showcase-title">Producer Session · Late Night · R&B</span>
          </div>
          <div className="showcase-body">
            <div className="panel">
              <div className="panel-label">◆ Your beat</div>
              <h3>Warm keys. Deep bass.</h3>
              <p>AI builds the instrumental. You focus on performance.</p>
              <div className="wave" aria-hidden>
                <i style={{ height: "35%" }} /><i style={{ height: "55%" }} /><i style={{ height: "80%" }} />
                <i style={{ height: "45%" }} /><i style={{ height: "90%" }} /><i style={{ height: "60%" }} />
                <i style={{ height: "40%" }} /><i style={{ height: "75%" }} /><i style={{ height: "95%" }} />
                <i style={{ height: "50%" }} /><i style={{ height: "30%" }} /><i style={{ height: "70%" }} />
                <i style={{ height: "85%" }} /><i style={{ height: "45%" }} /><i style={{ height: "65%" }} />
                <i style={{ height: "40%" }} /><i style={{ height: "55%" }} /><i style={{ height: "25%" }} />
              </div>
              <div>
                <span className="chip">94 BPM</span>
                <span className="chip">A minor</span>
                <span className="chip">Emotional</span>
              </div>
            </div>
            <div className="panel panel-producer">
              <div className="panel-label">◆ AI Producer</div>
              <h3>What to record next</h3>
              <p>Plain-language cues. One section at a time.</p>
              <div className="task">
                <div className="task-num">01</div>
                <div>
                  <strong>Chorus · Lead</strong>
                  <span>Give me your strongest melody here. Keep it open and confident.</span>
                </div>
              </div>
              <div className="task">
                <div className="task-num">02</div>
                <div>
                  <strong>Chorus · Harmony</strong>
                  <span>Sing softly underneath your main vocal.</span>
                </div>
              </div>
              <Link href={START_HREF} className="primary showcase-cta">Start this session</Link>
            </div>
          </div>
        </div>

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
                <div><h3>{title}</h3><p>{body}</p></div>
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
          <p>Beat → plan → guided vocals → mix & master.</p>
          <Link href={START_HREF} className="primary lg">Create your first song</Link>
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
  .primary{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#F0BC80,var(--brass));color:#1A1208!important;font-weight:600;font-size:14.5px;padding:10px 18px;border-radius:999px;text-decoration:none}
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
  .wave{display:flex;align-items:flex-end;gap:3px;height:56px;margin:16px 0 8px}
  .wave i{flex:1;border-radius:3px;background:linear-gradient(180deg,var(--signal),rgba(123,235,212,.25));opacity:.85;animation:pulse 1.4s ease-in-out infinite}
  .wave i:nth-child(odd){animation-delay:.15s}.wave i:nth-child(3n){animation-delay:.35s}
  @keyframes pulse{0%,100%{transform:scaleY(.55);opacity:.55}50%{transform:scaleY(1);opacity:1}}
  .chip{display:inline-flex;font-size:12px;padding:6px 10px;border-radius:999px;background:rgba(123,235,212,.14);color:var(--signal);border:1px solid rgba(123,235,212,.25);margin-right:6px;margin-bottom:6px}
  .task{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;background:var(--surface);border:1px solid var(--border);margin-bottom:10px}
  .task strong{display:block;font-size:13.5px;margin-bottom:2px}.task span{font-size:12.5px;color:var(--muted);line-height:1.4}
  .task-num{width:28px;height:28px;border-radius:8px;background:rgba(231,169,97,.15);color:var(--brass);font-size:12px;font-weight:600;display:grid;place-items:center;flex-shrink:0}
  .showcase-cta{display:flex;width:100%;margin-top:14px;padding:12px 16px;font-size:14px}
  .section{margin-top:72px}
  .section-head{text-align:center;max-width:600px;margin:0 auto 32px}
  .section-head h2{font-family:Fraunces,serif;font-weight:500;font-size:clamp(1.55rem,4vw,2.2rem);margin:0 0 12px}
  .section-head p{color:var(--muted);line-height:1.55;font-size:15px;margin:0}
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
  @media (max-width:900px){.pricing{grid-template-columns:1fr;max-width:400px;margin:0 auto}.compare{grid-template-columns:1fr}}
  @media (max-width:720px){.wrap{padding-left:16px;padding-right:16px}.desktop-nav a:not(.primary):not(.ghost){display:none}.hero{padding:28px 0 20px}.section{margin-top:56px}.cta-row{flex-direction:column;align-items:stretch}.cta-row .primary,.cta-row .secondary{width:100%}.showcase-body{grid-template-columns:1fr}.panel-producer{border-left:none;border-top:1px solid var(--border)}footer{flex-direction:column;align-items:flex-start}}
  @media (max-width:400px){.wrap{padding-left:14px;padding-right:14px}}
`;

import Link from "next/link";

export default function WelcomePage() {
  return (
    <>
      <style>{css}</style>
      <div className="ambient" aria-hidden />
      <div className="wrap">
        <header className="header">
          <Link href="/" className="logo"><span className="logo-mark">◆</span> Studio</Link>
          <nav className="nav desktop-nav">
            <a href="#how">How it works</a>
            <a href="#difference">Difference</a>
            <a href="#pricing">Pricing</a>
            <Link href="/auth?mode=login" className="ghost">Log in</Link>
            <Link href="/auth?mode=signup" className="primary">Start creating</Link>
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
            <Link href="/auth?mode=signup" className="primary lg">Create a song — free</Link>
            <a href="#how" className="secondary">See the 5 steps</a>
          </div>
          <p className="trust">No music theory · No DAW skills · Your voice stays the lead</p>
        </section>

        <section className="section" id="how">
          <div className="section-head">
            <h2>From first idea to radio-ready — in 5 steps</h2>
            <p>Studio plans the song, guides every vocal layer, then cleans, balances, and masters.</p>
          </div>
          <div className="pipeline">
            <div className="pipe-row"><div className="pipe-num">1</div><div><h3>Create the beat</h3><p>AI instrumental built for vocals — or upload your own.</p></div></div>
            <div className="pipe-row"><div className="pipe-num">2</div><div><h3>Get a producer plan</h3><p>Intro, verse, chorus mapped. Exactly what to record next.</p></div></div>
            <div className="pipe-row"><div className="pipe-num">3</div><div><h3>Record, guided</h3><p>One task at a time. Lead, doubles, harmonies, adlibs.</p></div></div>
            <div className="pipe-row"><div className="pipe-num">4</div><div><h3>Assemble & polish</h3><p>Takes placed, cleaned, balanced into intentional stacks.</p></div></div>
            <div className="pipe-row"><div className="pipe-num">5</div><div><h3>Master for release</h3><p>Radio-ready export without opening a DAW.</p></div></div>
          </div>
        </section>

        <section className="section" id="difference">
          <div className="section-head">
            <h2>Not another AI voice generator</h2>
            <p>Full-song AI apps can sound impressive — but they don’t sound like you.</p>
          </div>
          <div className="compare">
            <div className="compare-card"><h3>Typical AI song apps</h3><ul><li>Synthetic vocals</li><li>Hard to claim as your performance</li><li>One-shot output, not a session</li></ul></div>
            <div className="compare-card yes"><h3>Studio</h3><ul><li>Your real recorded voice</li><li>Guided layers & structure</li><li>Pro mix & master on paid plans</li></ul></div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="section-head">
            <h2>Simple pricing</h2>
            <p>One free song to try the full flow. Paid plans cover professional mix & master.</p>
          </div>
          <div className="pricing">
            <div className="price-card"><div className="price-name">Free</div><div className="price-amount">$0</div><p>1 finished song · AI plan · Guided recording · MP3</p><Link href="/auth?mode=signup" className="secondary block">Try one song</Link></div>
            <div className="price-card featured"><div className="price-name">Creator</div><div className="price-amount">$29 <span>/ mo</span></div><p>8 songs · RoEx master · WAV + MP3 · Commercial use</p><Link href="/auth?mode=signup" className="primary block">Start Creator</Link></div>
            <div className="price-card"><div className="price-name">Pro</div><div className="price-amount">$79 <span>/ mo</span></div><p>25 songs · Priority queue · Stem export when available</p><Link href="/auth?mode=signup" className="secondary block">Go Pro</Link></div>
          </div>
        </section>

        <section className="bottom-cta">
          <h2>Your next song can be radio-ready today</h2>
          <p>Beat → plan → guided vocals → mix & master.</p>
          <Link href="/auth?mode=signup" className="primary lg">Create your first song</Link>
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
  @media (max-width:720px){.wrap{padding-left:16px;padding-right:16px}.desktop-nav a:not(.primary):not(.ghost){display:none}.hero{padding:28px 0 20px}.section{margin-top:56px}.cta-row{flex-direction:column;align-items:stretch}.cta-row .primary,.cta-row .secondary{width:100%}footer{flex-direction:column;align-items:flex-start}}
  @media (max-width:400px){.wrap{padding-left:14px;padding-right:14px}}
`;

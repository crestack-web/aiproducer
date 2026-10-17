import Link from "next/link";
import { RotatingHeadline } from "@/components/rotating-headline";
import { WelcomeCreateHook } from "@/components/welcome-create-hook";
import { WelcomeMusicRail } from "@/components/welcome-music-rail";
import { WelcomeProductDemo } from "@/components/welcome-product-demo";
import { WelcomeAnalytics } from "@/components/product-analytics";
import "./welcome-page.css";

const START_HREF = "/auth?mode=signup&next=/onboarding";
const FOOTER_BANNER_SRC = "/welcome/footer-banner.jpg";

export default function WelcomePage() {
  return (
    <>
      <WelcomeAnalytics />
      <div className="ambient" aria-hidden />
      <div className="beta-banner" role="status">
        <span className="beta-pill">Beta</span>
        <span className="beta-copy">
          AP Studio is in beta — features may change, and we'd love your feedback while we ship.
        </span>
      </div>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="logo">
            <img src="/logo.svg" alt="AP Studio" width={28} height={28} className="logo-img" />
            AP Studio
          </Link>
          <nav className="nav desktop-nav">
            <a href="#workspace">Workspace</a>
            <a href="#listen">Listen</a>
            <a href="#how">How it works</a>
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
        <WelcomeMusicRail />

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

        <section className="bottom-cta">
          <h2>Your next song can be radio-ready today</h2>
          <p>Beat → plan → guided vocals → mix & master.</p>
          <Link href={START_HREF} className="primary lg">Create your first song</Link>
        </section>
      </div>

      <section className="footer-banner" aria-label="AP Studio">
        <img
          src={FOOTER_BANNER_SRC}
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
              <img src="/logo.svg" alt="AP Studio" width={32} height={32} className="logo-img" />
              <span>AP Studio</span>
            </Link>
            <span className="footer-tag">Your voice. Produced.</span>
          </div>
          <nav className="footer-legal" aria-label="Legal">
            <Link href="/privacy" className="footer-legal-link">Privacy Policy</Link>
            <Link href="/terms" className="footer-legal-link">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

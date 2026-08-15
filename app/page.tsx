import Link from "next/link";

export default function WelcomePage() {
  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <header style={s.header}>
          <div style={s.logo}>◆ Studio</div>
          <nav style={s.nav}>
            <Link href="/auth?mode=login" style={s.ghost}>Log in</Link>
            <Link href="/auth?mode=signup" style={s.primary}>Start creating</Link>
          </nav>
        </header>
        <section style={s.hero}>
          <div style={s.eyebrow}>AI Music Producer</div>
          <h1 style={s.h1}>
            Radio-ready songs.<br />
            <span style={s.grad}>With your real voice.</span>
          </h1>
          <p style={s.sub}>
            Create a beat, follow a clear recording plan, and let Studio assemble, mix, and master
            so you leave with a finished track — not a rough freestyle.
          </p>
          <div style={s.cta}>
            <Link href="/auth?mode=signup" style={{ ...s.primary, ...s.lg }}>Create a song — free</Link>
            <Link href="#how" style={s.secondary}>See how it works</Link>
          </div>
          <p style={s.trust}>No music theory · 1 free song · Your voice stays the lead</p>
        </section>
        <section id="how" style={s.section}>
          <h2 style={s.h2}>From idea to radio-ready</h2>
          <ol style={s.steps}>
            <li><strong>Create the beat</strong> — mood + genre → instrumental</li>
            <li><strong>Get a producer plan</strong> — sections + what to record</li>
            <li><strong>Record guided</strong> — lead, doubles, harmonies, adlibs</li>
            <li><strong>Assemble &amp; polish</strong> — timing, balance, cleanup</li>
            <li><strong>Master for release</strong> — radio-ready export (RoEx on paid)</li>
          </ol>
        </section>
        <section style={s.section}>
          <h2 style={s.h2}>Pricing</h2>
          <div style={s.pricing}>
            <div style={s.card}><div style={s.name}>Free</div><div style={s.amt}>$0</div><p style={s.desc}>1 finished song total</p></div>
            <div style={{ ...s.card, ...s.feat }}><div style={s.name}>Creator</div><div style={s.amt}>$29<span style={s.per}>/mo</span></div><p style={s.desc}>8 songs · RoEx mix &amp; master</p></div>
            <div style={s.card}><div style={s.name}>Pro</div><div style={s.amt}>$79<span style={s.per}>/mo</span></div><p style={s.desc}>25 songs · priority queue</p></div>
          </div>
        </section>
        <section style={s.bottom}>
          <Link href="/auth?mode=signup" style={{ ...s.primary, ...s.lg }}>Create your first song</Link>
        </section>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#050508", color: "#F4F1EC", fontFamily: "Inter, system-ui, sans-serif" },
  wrap: { maxWidth: 960, margin: "0 auto", padding: "0 24px 80px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0" },
  logo: { fontWeight: 600, color: "#7BEBD4" },
  nav: { display: "flex", gap: 10, alignItems: "center" },
  ghost: { color: "#F4F1EC", textDecoration: "none", border: "1px solid rgba(255,255,255,0.16)", padding: "8px 16px", borderRadius: 999, fontSize: 14, fontWeight: 500 },
  primary: { display: "inline-flex", background: "linear-gradient(180deg, #F0BC80, #E7A961)", color: "#1A1208", textDecoration: "none", fontWeight: 600, fontSize: 14.5, padding: "10px 18px", borderRadius: 999 },
  lg: { fontSize: 16, padding: "14px 28px" },
  secondary: { display: "inline-flex", border: "1px solid rgba(255,255,255,0.16)", color: "#F4F1EC", textDecoration: "none", fontWeight: 500, padding: "13px 22px", borderRadius: 999, background: "rgba(255,255,255,0.04)" },
  hero: { textAlign: "center", padding: "56px 0 24px", maxWidth: 720, margin: "0 auto" },
  eyebrow: { fontSize: 12, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#E7A961", marginBottom: 16 },
  h1: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "clamp(2.2rem, 5vw, 3.2rem)", lineHeight: 1.1, margin: "0 0 16px" },
  grad: { background: "linear-gradient(120deg, #7BEBD4, #a8f0e0 40%, #E7A961)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" },
  sub: { color: "#9B96A3", fontSize: 17, lineHeight: 1.55, marginBottom: 28 },
  cta: { display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 16 },
  trust: { fontSize: 13, color: "#5C5866" },
  section: { marginTop: 72 },
  h2: { fontFamily: "Fraunces, Georgia, serif", fontWeight: 500, fontSize: "1.8rem", marginBottom: 20, textAlign: "center" },
  steps: { maxWidth: 560, margin: "0 auto", color: "#9B96A3", lineHeight: 1.7, paddingLeft: 20 },
  pricing: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 },
  card: { padding: 20, borderRadius: 18, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)" },
  feat: { borderColor: "rgba(231,169,97,0.45)", background: "rgba(231,169,97,0.08)" },
  name: { fontSize: 13, color: "#9B96A3", fontWeight: 600, marginBottom: 6 },
  amt: { fontFamily: "Fraunces, serif", fontSize: "2rem", fontWeight: 500 },
  per: { fontFamily: "Inter, sans-serif", fontSize: 14, color: "#9B96A3", fontWeight: 500 },
  desc: { color: "#9B96A3", fontSize: 13.5, marginTop: 8 },
  bottom: { marginTop: 72, textAlign: "center" },
};

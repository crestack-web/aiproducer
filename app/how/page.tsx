import type { Metadata } from "next";
import Link from "next/link";
import { STUDIO_LOGO_URL, STUDIO_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `How it works — ${STUDIO_NAME}`,
  description:
    "From first idea to a radio-ready song with your real voice. Beat, plan, record, polish, master — explained simply.",
};

const START_HREF = "/auth?mode=signup&next=/onboarding";

export default function HowItWorksPage() {
  return (
    <>
      <style>{css}</style>
      <div className="notes-page">
        <header className="notes-header">
          <Link href="/" className="notes-logo">
            <img src={STUDIO_LOGO_URL} alt="" width={28} height={28} />
            <span>{STUDIO_NAME}</span>
          </Link>
          <span className="notes-label">studio notes</span>
        </header>

        <article className="notes-article">
          <div className="notes-hero">
            <p className="notes-by">by {STUDIO_NAME}</p>
            <p className="notes-edition">HOW IT WORKS</p>
            <h1>your voice. produced.</h1>
            <p className="notes-date">A clear path from idea to finished song</p>
          </div>

          <div className="notes-body">
            <p className="notes-lead">hey.</p>
            <p>
              most &ldquo;AI music&rdquo; apps generate a full track for you — including a synthetic
              voice that isn&apos;t yours. Studio does the opposite. you bring the voice. we bring the
              producer brain: the beat, the structure, the guided takes, the mix, and the master.
            </p>
            <p>
              no music theory required. no blank DAW session. just a clear next step, every time.
            </p>
          </div>

          <hr className="notes-rule" />

          <section className="notes-section">
            <p className="notes-kicker">HIGHLIGHTS</p>
            <h2>the whole loop, in plain English</h2>
            <p>
              five moves. that&apos;s the product. everything else is detail so each move feels
              obvious when you&apos;re in it.
            </p>
          </section>

          <section className="notes-section">
            <h2>1 · drop the beat</h2>
            <p>
              start with an AI instrumental built for vocals — or upload the beat already living in
              your notes app. either way, you&apos;re not staring at empty tracks wondering where the
              drums go.
            </p>
            <figure className="notes-figure">
              <img
                src="/welcome/studio-desktop.jpg"
                alt="AP Studio beat and session workspace"
                width={1200}
                height={750}
                loading="lazy"
              />
            </figure>
            <p className="notes-caption">
              pick a direction, generate or upload, and lock the instrumental before you sing a note.
            </p>
          </section>

          <section className="notes-section">
            <h2>2 · get the game plan</h2>
            <p>
              studio maps intro, verse, chorus, and the rest. you always know what to record next —
              not a wall of tracks, just the next task.
            </p>
            <p>
              think of it as a producer sitting next to you: &ldquo;double the hook. then a quiet
              harmony on the last line.&rdquo;
            </p>
          </section>

          <section className="notes-section">
            <h2>3 · record, one layer at a time</h2>
            <p>
              lead. doubles. harmonies. adlibs. each one is a guided take. you stay in flow; studio
              keeps the stack intentional so you don&apos;t bury the vocal under ten random passes.
            </p>
            <figure className="notes-figure">
              <img
                src="/welcome/timeline-arrangement.jpg"
                alt="Guided vocal arrangement timeline"
                width={1200}
                height={750}
                loading="lazy"
              />
            </figure>
            <p className="notes-caption">
              one job at a time. your voice stays the lead; the layers support it.
            </p>
          </section>

          <section className="notes-section">
            <h2>4 · stack &amp; shine</h2>
            <p>
              best takes get placed, cleaned, and balanced. not over-polished into plastic — just
              enough so the performance sits like a real session, not a phone memo.
            </p>
            <figure className="notes-figure">
              <img
                src="/welcome/console-workspace.jpg"
                alt="AP Studio console mix workspace"
                width={1200}
                height={750}
                loading="lazy"
              />
            </figure>
            <p className="notes-caption">
              console view when you want the faders. booth flow when you just want the next take.
            </p>
          </section>

          <section className="notes-section">
            <h2>5 · master &amp; ship</h2>
            <p>
              radio-ready export without opening a traditional DAW. loudness, balance, and polish
              aimed at streaming — so the song you finish is the song you can send.
            </p>
            <figure className="notes-figure">
              <img
                src="/welcome/console-desktop.jpg"
                alt="Finished mix and master in AP Studio"
                width={1200}
                height={750}
                loading="lazy"
              />
            </figure>
          </section>

          <hr className="notes-rule" />

          <section className="notes-section">
            <h2>what this is not</h2>
            <p>
              it&apos;s not a one-tap fake singer. it&apos;s not &ldquo;type a prompt, get a full
              song that sounds like nobody.&rdquo; your recorded voice stays the performance. studio
              is the room, the plan, and the mix engineer.
            </p>
          </section>

          <section className="notes-cta">
            <h2>ready when you are</h2>
            <p>beat → plan → guided vocals → mix &amp; master.</p>
            <Link href={START_HREF} className="notes-btn">
              start creating
            </Link>
            <Link href="/" className="notes-back">
              ← back home
            </Link>
          </section>
        </article>
      </div>
    </>
  );
}

const css = `
  .notes-page{
    min-height:100vh;
    background:#F4F1EC;
    color:#1A1714;
    font-family:Inter,system-ui,-apple-system,sans-serif;
  }
  .notes-header{
    position:sticky;top:0;z-index:10;
    display:flex;align-items:center;justify-content:space-between;
    padding:14px 20px;
    background:rgba(244,241,236,.92);
    backdrop-filter:blur(12px);
    border-bottom:1px solid rgba(26,23,20,.08);
  }
  .notes-logo{
    display:flex;align-items:center;gap:10px;
    text-decoration:none;color:#1A1714;font-weight:700;font-size:15px;
  }
  .notes-logo img{border-radius:8px}
  .notes-label{
    font-size:13px;color:#6B6560;font-weight:500;
  }
  .notes-article{
    max-width:640px;
    margin:0 auto;
    padding:48px 22px 96px;
  }
  .notes-hero{
    text-align:center;
    padding:24px 0 40px;
  }
  .notes-by{
    margin:0 0 28px;
    font-size:14px;color:#8A847C;
  }
  .notes-edition{
    margin:0 0 12px;
    font-size:12px;font-weight:600;
    letter-spacing:.16em;text-transform:uppercase;
    color:#8A847C;
  }
  .notes-hero h1{
    margin:0 0 14px;
    font-family:Fraunces,Georgia,serif;
    font-weight:600;
    font-size:clamp(2.4rem,8vw,3.4rem);
    line-height:1.05;
    letter-spacing:-.03em;
    color:#111;
  }
  .notes-date{
    margin:0;
    font-size:14px;color:#8A847C;
  }
  .notes-body,.notes-section{
    margin-top:28px;
  }
  .notes-lead{
    font-size:1.15rem;font-weight:500;color:#1A1714;
  }
  .notes-body p,.notes-section p{
    font-size:1.05rem;
    line-height:1.65;
    color:#3F3A36;
    margin:0 0 1.1em;
  }
  .notes-section h2{
    margin:0 0 14px;
    font-family:Fraunces,Georgia,serif;
    font-weight:600;
    font-size:clamp(1.55rem,4.5vw,1.95rem);
    line-height:1.2;
    letter-spacing:-.02em;
    color:#111;
  }
  .notes-kicker{
    margin:0 0 10px;
    font-size:11px;font-weight:700;
    letter-spacing:.14em;text-transform:uppercase;
    color:#8A847C;
  }
  .notes-rule{
    border:none;
    border-top:1px solid rgba(26,23,20,.1);
    margin:40px 0;
  }
  .notes-figure{
    margin:22px 0 10px;
    border-radius:16px;
    overflow:hidden;
    background:#e8e4dc;
    border:1px solid rgba(26,23,20,.08);
    box-shadow:0 18px 40px -24px rgba(0,0,0,.25);
  }
  .notes-figure img{
    display:block;width:100%;height:auto;
  }
  .notes-caption{
    font-size:0.92rem !important;
    color:#6B6560 !important;
    line-height:1.5 !important;
  }
  .notes-cta{
    margin-top:48px;
    text-align:center;
    padding:36px 20px;
    border-radius:20px;
    background:#fff;
    border:1px solid rgba(26,23,20,.08);
  }
  .notes-cta h2{margin-bottom:8px}
  .notes-cta p{margin-bottom:20px}
  .notes-btn{
    display:inline-flex;align-items:center;justify-content:center;
    padding:12px 26px;border-radius:999px;
    background:linear-gradient(135deg,#E8A04A,#C47820);
    color:#1A1208;font-weight:650;font-size:15px;
    text-decoration:none;
  }
  .notes-back{
    display:block;margin-top:16px;
    font-size:14px;color:#6B6560;text-decoration:none;
  }
  .notes-back:hover{color:#1A1714}
  @media (min-width:720px){
    .notes-article{padding:64px 24px 120px}
    .notes-header{padding:16px 28px}
  }
`;

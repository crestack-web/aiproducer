"use client";

/**
 * Welcome page motion demos — Mix + Console dashboard animations.
 * Self-contained HTML stages served from /welcome/*.html
 */

import React, { useEffect, useRef, useState } from "react";

type MotionCardProps = {
  src: string;
  title: string;
  body: string;
  kicker: string;
  id: string;
};

function MotionCard({ src, title, body, kicker, id }: MotionCardProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    // Load immediately if already visible (e.g. fast scroll / large screens)
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200 && rect.bottom > -100) {
      setInView(true);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px 0px", threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <article className="motion-card" id={id}>
      <div className="motion-copy">
        <p className="motion-kicker">{kicker}</p>
        <h3 className="motion-title">{title}</h3>
        <p className="motion-body">{body}</p>
      </div>
      <div ref={frameRef} className={`motion-frame${loaded ? " ready" : ""}`}>
        {!loaded && <div className="motion-skeleton" aria-hidden />}
        {inView ? (
          <iframe
            src={src}
            title={title}
            className="motion-iframe"
            onLoad={() => setLoaded(true)}
            // Scripts required for the self-contained animation.
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </div>
    </article>
  );
}

export function WelcomeMotionSections() {
  return (
    <section className="motion-sections" aria-label="How Studio produces your song">
      <div className="section-head motion-head">
        <p className="section-kicker">See it move</p>
        <h2>From take to mixed song</h2>
        <p>
          Watch AP arrange every layer, clean the vocal, and mix the final bounce —
          then direct the console like a real session.
        </p>
      </div>

      <div className="motion-grid">
        <MotionCard
          id="motion-mix"
          src="/welcome/mix-motion.html"
          kicker="Produce"
          title="Arrange · clean · mix"
          body="AP drops tracks on the grid, scrubs noise from the lead, balances levels, and bounces the master — while you watch the timeline come alive."
        />
        <MotionCard
          id="motion-console"
          src="/welcome/dashboard-motion.html"
          kicker="Console"
          title="Your session dashboard"
          body="Level, mute, and solo every part. Kick off produce, shape track FX, and tell AP what to change — all on one dark timeline."
        />
      </div>
    </section>
  );
}

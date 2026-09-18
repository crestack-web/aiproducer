"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";

const START_HREF = "/auth?mode=signup&next=/onboarding";

type Slide = {
  id: string;
  title: string;
  body: string;
  imageSrc: string;
  imageAlt: string;
};

const SLIDES: Slide[] = [
  {
    id: "console",
    title: "Your complete creative workspace",
    body:
      "AP Studio Console is a web-based production desk that combines guided recording, timeline layers, and AI-assisted direction — so you build real songs with your voice, not synthetic vocals.",
    imageSrc: "/welcome/console-workspace.jpg",
    imageAlt: "AP Studio Console — tracks, Produce, and AI direction",
  },
  {
    id: "timeline",
    title: "Arrange every vocal layer",
    body:
      "See intro, verse, and chorus on the timeline. Place leads, doubles, harmonies, and adlibs exactly where they belong — then Produce a finished song without opening a traditional DAW.",
    imageSrc: "/welcome/timeline-arrangement.jpg",
    imageAlt: "AP Studio timeline — lead, double, harmony, and adlib regions",
  },
];

/**
 * Suno-style product demo card on the welcome page.
 */
export function WelcomeProductDemo() {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[Math.min(index, SLIDES.length - 1)];

  const go = useCallback((dir: -1 | 1) => {
    setIndex((i) => (i + dir + SLIDES.length) % SLIDES.length);
  }, []);

  return (
    <section className="product-demo" id="workspace" aria-label="Product demo">
      <div className="product-demo-card">
        <h2 className="product-demo-title">{slide.title}</h2>
        <p className="product-demo-body">{slide.body}</p>
        <div className="product-demo-frame-wrap">
          {SLIDES.length > 1 && (
            <button
              type="button"
              className="product-demo-nav product-demo-nav-prev"
              aria-label="Previous slide"
              onClick={() => go(-1)}
            >
              ‹
            </button>
          )}
          <div className="product-demo-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.imageSrc}
              alt={slide.imageAlt}
              className="product-demo-img"
              loading="lazy"
            />
          </div>
          {SLIDES.length > 1 && (
            <button
              type="button"
              className="product-demo-nav product-demo-nav-next"
              aria-label="Next slide"
              onClick={() => go(1)}
            >
              ›
            </button>
          )}
        </div>
        {SLIDES.length > 1 && (
          <div className="product-demo-dots" role="tablist" aria-label="Demo slides">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={`product-demo-dot${i === index ? " on" : ""}`}
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1}: ${s.title}`}
              />
            ))}
          </div>
        )}
        <div className="product-demo-cta">
          <Link href={START_HREF} className="primary">
            Open Studio
          </Link>
        </div>
      </div>
    </section>
  );
}

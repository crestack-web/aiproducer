"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FALLBACK_SHOWCASE_TRACKS,
  type ShowcaseTrack,
} from "@/lib/welcome-showcase-tracks";

const START_HREF = "/auth?mode=signup&next=/onboarding";

/**
 * Suno-style horizontal listening rail for the welcome page.
 * Single shared Audio element; one track plays at a time.
 */
export function WelcomeMusicRail() {
  const [tracks, setTracks] = useState<ShowcaseTrack[]>(FALLBACK_SHOWCASE_TRACKS);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/showcase", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled && Array.isArray(j.tracks) && j.tracks.length) {
          setTracks(j.tracks as ShowcaseTrack[]);
        }
      } catch {
        /* keep fallbacks */
      }
    })();
    return () => {
      cancelled = true;
      try {
        audioRef.current?.pause();
      } catch {
        /* */
      }
    };
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "metadata";
      a.addEventListener("ended", () => setPlayingId(null));
      a.addEventListener("error", () => {
        setPlayingId(null);
        setLoadingId(null);
      });
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const toggle = useCallback(
    async (track: ShowcaseTrack) => {
      const a = ensureAudio();
      try {
        if (playingId === track.id && !a.paused) {
          a.pause();
          setPlayingId(null);
          return;
        }
        setLoadingId(track.id);
        if (a.src !== track.audioUrl) {
          a.src = track.audioUrl;
          a.currentTime = 0;
        }
        await a.play();
        setPlayingId(track.id);
      } catch (e) {
        console.warn("[welcome-rail] play failed", e);
        setPlayingId(null);
      } finally {
        setLoadingId(null);
      }
    },
    [ensureAudio, playingId]
  );

  function scrollBy(dir: -1 | 1) {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(340, el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="listen-section" id="listen" aria-label="Listen to Studio">
      <div className="listen-head">
        <h2 className="listen-title">Mind-blowing session quality</h2>
        <p className="listen-sub">
          Hear AP-generated beats and finished songs — your voice stays the lead when you produce.
        </p>
      </div>

      <div className="listen-rail-wrap">
        <button
          type="button"
          className="listen-arrow listen-arrow-left"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
        >
          ‹
        </button>
        <div className="listen-rail" ref={railRef}>
          {tracks.map((t) => {
            const isPlaying = playingId === t.id;
            const isLoading = loadingId === t.id;
            return (
              <article key={t.id} className={`listen-card${isPlaying ? " is-playing" : ""}`}>
                <button
                  type="button"
                  className="listen-cover"
                  onClick={() => void toggle(t)}
                  aria-label={isPlaying ? `Pause ${t.title}` : `Play ${t.title}`}
                  style={{
                    background: t.imageUrl
                      ? undefined
                      : `linear-gradient(145deg, ${t.cover[0]} 0%, ${t.cover[1]} 100%)`,
                  }}
                >
                  {t.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.imageUrl} alt="" className="listen-cover-img" />
                  ) : (
                    <span className="listen-cover-glyph" aria-hidden>
                      {t.kind === "song" ? "♪" : "♩"}
                    </span>
                  )}
                  <span className={`listen-play${isPlaying ? " on" : ""}`}>
                    {isLoading ? "…" : isPlaying ? "❚❚" : "▶"}
                  </span>
                  {t.playsLabel ? (
                    <span className="listen-badge">
                      {isPlaying ? "Playing" : t.playsLabel}
                    </span>
                  ) : null}
                </button>
                <div className="listen-meta">
                  <div className="listen-track-title" title={t.title}>
                    {t.title}
                  </div>
                  <div className="listen-track-artist">
                    <span className="listen-avatar" aria-hidden>
                      {t.kind === "song" ? "🎤" : "AP"}
                    </span>
                    {t.artist}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <button
          type="button"
          className="listen-arrow listen-arrow-right"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
        >
          ›
        </button>
      </div>

      <div className="listen-cta-row">
        <Link href={START_HREF} className="primary listen-cta">
          Create your beat
        </Link>
        <p className="listen-footnote">Free AP beats · Your voice on the final song</p>
      </div>
    </section>
  );
}

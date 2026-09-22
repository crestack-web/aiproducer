/**
 * Try It Option A: single-pass Eleven Music composition plan
 * (one Chorus/Verse section with vocals baked in — no TTS layer).
 */
import {
  TRY_IT_PREVIEW_BEAT_SEC,
  TRY_IT_PREVIEW_MAX_SEC,
  TRY_IT_PREVIEW_MIN_SEC,
} from "./config";

const BASES = [
  (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/$/, ""),
  "https://api.us.elevenlabs.io",
].filter((v, i, a) => a.indexOf(v) === i);

function apiKey(): string {
  const k =
    process.env.ELEVENLABS_API_KEY?.trim() ||
    process.env.ELEVEN_API_KEY?.trim() ||
    process.env.XI_API_KEY?.trim();
  if (!k) throw new Error("ELEVENLABS_API_KEY is not configured");
  return k.replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
}

/** Prefer v2 for section vocals; env override for cost tests. */
export function tryItMusicModel(): string {
  return (
    process.env.TRY_IT_MUSIC_MODEL?.trim() ||
    process.env.ELEVENLABS_MUSIC_MODEL?.trim() ||
    "music_v2"
  );
}

function lyricLines(raw: string): string[] {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  if (!cleaned) {
    return ["This is my sound", "Riding on the beat tonight", "Feel the night", "Feel the heat"];
  }
  // Prefer explicit line breaks; else chunk into short lines
  const byBreak = cleaned.split(/[\n|/]+/).map((s) => s.trim()).filter(Boolean);
  if (byBreak.length >= 2) return byBreak.slice(0, 6).map((l) => l.slice(0, 80));
  const words = cleaned.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 42) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.slice(0, 6);
}

function genreStyles(genre: string, tempo: number): string[] {
  const g = (genre || "afrobeats").toLowerCase();
  const base = [
    g,
    `${tempo} BPM`,
    "polished production",
    "radio-ready mix",
    "clear lead vocal in the mix",
    "tight drums",
    "modern arrangement",
  ];
  if (/afro|amapiano|highlife/.test(g)) {
    base.push("groovy percussion", "warm bass", "melodic hooks", "danceable pocket");
  } else if (/trap|hip|drill/.test(g)) {
    base.push("808s", "crisp hi-hats", "confident vocal delivery");
  } else if (/r&b|rnb|soul/.test(g)) {
    base.push("smooth drums", "lush chords", "expressive lead vocal");
  } else if (/pop/.test(g)) {
    base.push("catchy hook", "bright synths", "anthemic chorus");
  }
  return base;
}

/**
 * Build a single-section composition plan (Chorus by default).
 * Music model sings lyrics in time with the arrangement — one mixed file.
 */
export function buildTryItSectionPlan(opts: {
  genre?: string;
  tempo?: number;
  lyrics?: string;
  section?: "chorus" | "verse";
  durationSec?: number;
}): {
  plan: {
    chunks: Array<{
      text: string;
      duration_ms: number;
      positive_styles: string[];
      negative_styles: string[];
      context_adherence: string;
    }>;
  };
  durationSec: number;
  sectionLabel: string;
  modelId: string;
} {
  const tempo = opts.tempo && opts.tempo >= 70 && opts.tempo <= 180 ? opts.tempo : 102;
  let durationSec = opts.durationSec ?? TRY_IT_PREVIEW_BEAT_SEC;
  durationSec = Math.min(
    TRY_IT_PREVIEW_MAX_SEC,
    Math.max(TRY_IT_PREVIEW_MIN_SEC, Math.round(durationSec))
  );
  const section = opts.section || "chorus";
  const sectionTag = section === "verse" ? "[Verse]" : "[Chorus]";
  const lines = lyricLines(opts.lyrics || "");
  const text = `${sectionTag}\n${lines.join("\n")}`;
  const styles = [
    ...genreStyles(opts.genre || "afrobeats", tempo),
    section === "chorus"
      ? "powerful anthemic chorus vocals"
      : "clear melodic verse vocals",
    "lead singer",
    "vocals locked to the beat",
    "full mix not a cappella",
  ];
  const plan = {
    chunks: [
      {
        text,
        duration_ms: durationSec * 1000,
        positive_styles: styles,
        negative_styles: [
          "instrumental only",
          "no vocals",
          "spoken word",
          "podcast",
          "a cappella only",
          "speech over beat",
        ],
        context_adherence: "high",
      },
    ],
  };
  return {
    plan,
    durationSec,
    sectionLabel: section === "verse" ? "Verse" : "Chorus",
    modelId: tryItMusicModel(),
  };
}

export async function composeTryItSection(opts: {
  genre?: string;
  tempo?: number;
  lyrics?: string;
  section?: "chorus" | "verse";
  durationSec?: number;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  durationSec: number;
  modelId: string;
  sectionLabel: string;
  songId: string | null;
}> {
  const { plan, durationSec, sectionLabel, modelId } = buildTryItSectionPlan(opts);
  const body = {
    model_id: modelId,
    composition_plan: plan,
    // Do NOT set force_instrumental — vocals must be in the generation
  };

  let lastErr = "Music compose failed";
  for (const base of BASES) {
    const url = `${base}/v1/music?output_format=${encodeURIComponent(
      process.env.ELEVENLABS_MUSIC_OUTPUT || "mp3_44100_128"
    )}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey(),
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) {
        lastErr = "Music returned empty audio";
        continue;
      }
      const songId = res.headers.get("song-id") || res.headers.get("Song-Id");
      return {
        buffer,
        contentType: res.headers.get("content-type") || "audio/mpeg",
        durationSec,
        modelId,
        sectionLabel,
        songId,
      };
    }
    const errBody = (await res.text()).slice(0, 400);
    lastErr = `Music compose (${res.status}): ${errBody}`;
    // try next region on auth/region issues
    if (res.status === 401 || res.status === 404) continue;
    if (res.status === 422 || res.status === 400) {
      // model may not support plan shape — retry with prompt-only fallback
      break;
    }
  }

  // Fallback: prompt-only with explicit sung chorus (still single pass, with vocals)
  const lines = lyricLines(opts.lyrics || "");
  const prompt = [
    `Generate a single ${opts.section || "chorus"} section only, about ${durationSec} seconds.`,
    `Genre: ${opts.genre || "afrobeats"}. Tempo around ${opts.tempo || 102} BPM.`,
    "Full production mix with lead vocals singing these lyrics in time with the beat:",
    lines.join(" / "),
    "Must include sung vocals mixed with instruments. Not instrumental. Not spoken narration.",
    "Radio-ready short hook, polished.",
  ].join(" ");

  for (const base of BASES) {
    const url = `${base}/v1/music?output_format=mp3_44100_128`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        model_id: modelId,
        prompt: prompt.slice(0, 4000),
        music_length_ms: durationSec * 1000,
        force_instrumental: false,
      }),
    });
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) continue;
      return {
        buffer,
        contentType: "audio/mpeg",
        durationSec,
        modelId,
        sectionLabel: opts.section === "verse" ? "Verse" : "Chorus",
        songId: res.headers.get("song-id"),
      };
    }
    lastErr = `Music prompt fallback (${res.status}): ${(await res.text()).slice(0, 300)}`;
  }

  throw new Error(lastErr);
}

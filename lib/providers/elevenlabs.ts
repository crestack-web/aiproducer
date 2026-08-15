const BASE = "https://api.elevenlabs.io";

function apiKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not configured");
  return k;
}

export type BeatGenInput = {
  genre?: string;
  mood?: string;
  tempo?: number;
  prompt?: string;
  lengthMs?: number;
};

export type BeatGenResult = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  provider: "elevenlabs_music" | "elevenlabs_sfx";
  model: string;
  prompt: string;
  durationMs: number;
};

function buildPrompt(input: BeatGenInput): string {
  if (input.prompt?.trim()) return input.prompt.trim();
  const genre = input.genre || "R&B";
  const mood = input.mood || "Emotional";
  const tempo = input.tempo || 90;
  return [
    `${mood} modern ${genre} instrumental beat`,
    "polished production, clean mix",
    "drums, bass, and keys only",
    "no vocals, no singing, instrumental only",
    `${tempo} BPM`,
    "suitable as a vocal bed / radio-ready instrumental",
  ].join(", ");
}

async function composeMusic(prompt: string, lengthMs: number): Promise<BeatGenResult> {
  const res = await fetch(`${BASE}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      prompt,
      music_length_ms: Math.min(Math.max(lengthMs, 3000), 600000),
      model_id: process.env.ELEVENLABS_MUSIC_MODEL || "music_v1",
      force_instrumental: true,
    }),
  });

  if (res.status === 402) {
    const err = new Error("ELEVEN_MUSIC_PAID_REQUIRED") as Error & { status: number };
    err.status = 402;
    throw err;
  }
  if (!res.ok) throw new Error(`ElevenLabs music failed: ${res.status} ${(await res.text()).slice(0, 400)}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("ElevenLabs music returned empty/short audio");

  return {
    buffer: buf,
    contentType: "audio/mpeg",
    extension: "mp3",
    provider: "elevenlabs_music",
    model: process.env.ELEVENLABS_MUSIC_MODEL || "music_v1",
    prompt,
    durationMs: lengthMs,
  };
}

async function composeSfx(prompt: string, lengthMs: number): Promise<BeatGenResult> {
  const seconds = Math.min(Math.max(lengthMs / 1000, 0.5), 30);
  const sfxPrompt = `${prompt}. seamless loopable instrumental music bed, rhythmic, no speech, no voice`;

  const res = await fetch(`${BASE}/v1/sound-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: sfxPrompt,
      duration_seconds: seconds,
      prompt_influence: 0.4,
      loop: true,
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs sound-generation failed: ${res.status} ${(await res.text()).slice(0, 400)}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) throw new Error("ElevenLabs SFX returned empty/short audio");

  return {
    buffer: buf,
    contentType: "audio/mpeg",
    extension: "mp3",
    provider: "elevenlabs_sfx",
    model: "sound-generation",
    prompt: sfxPrompt,
    durationMs: Math.round(seconds * 1000),
  };
}

export async function generateInstrumentalBeat(input: BeatGenInput): Promise<BeatGenResult> {
  const prompt = buildPrompt(input);
  const lengthMs = input.lengthMs ?? 45000;
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not configured");

  try {
    return await composeMusic(prompt, lengthMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isPaidGate =
      msg.includes("ELEVEN_MUSIC_PAID_REQUIRED") ||
      msg.includes("paid_plan_required") ||
      msg.includes("402");
    if (!isPaidGate) throw e;
    const sfxLen = Math.min(lengthMs, 28000);
    console.warn("[elevenlabs] Music API needs paid plan — falling back to sound-generation", sfxLen);
    return await composeSfx(prompt, sfxLen);
  }
}

export function hasElevenLabsKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

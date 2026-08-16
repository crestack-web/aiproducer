/** ElevenLabs text-to-speech for producer melody / section guides. */

const BASE = "https://api.elevenlabs.io";

export function hasElevenLabsTts(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function apiKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not configured");
  return k;
}

/** Default conversational voice; override with ELEVENLABS_VOICE_ID. */
function voiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
}

export async function synthesizeSpeech(
  text: string,
  opts?: { stability?: number; similarity?: number }
): Promise<{ buffer: Buffer; contentType: string }> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 900);
  if (!clean) throw new Error("Empty guide text");

  const res = await fetch(`${BASE}/v1/text-to-speech/${voiceId()}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: clean,
      model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2",
      voice_settings: {
        stability: opts?.stability ?? 0.45,
        similarity_boost: opts?.similarity ?? 0.75,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 200) throw new Error("ElevenLabs TTS returned empty audio");
  return { buffer, contentType: "audio/mpeg" };
}

/** Build a short spoken producer guide from a recording task. */
export function buildMelodyGuideScript(input: {
  title?: string | null;
  instruction?: string | null;
  reason?: string | null;
  sectionLabel?: string | null;
  type?: string | null;
  genre?: string | null;
  mood?: string | null;
}): string {
  const section = input.sectionLabel || "this section";
  const title = input.title || humanType(input.type);
  const instruction =
    input.instruction?.trim() ||
    "Sing the main melody clearly and naturally over the beat.";
  const reason = input.reason?.trim();
  const vibe = [input.mood, input.genre].filter(Boolean).join(" ");

  const parts = [
    `Melody guide for ${section}.`,
    title ? `This is your ${title}.` : null,
    instruction,
    reason ? reason : null,
    vibe ? `Keep the ${vibe} feel.` : null,
    "Listen, then try it in your own voice.",
  ].filter(Boolean);

  return parts.join(" ");
}

function humanType(type?: string | null): string {
  const t = (type || "").toLowerCase();
  if (t.includes("harmony")) return "harmony part";
  if (t.includes("adlib")) return "ad-libs";
  if (t.includes("double")) return "double";
  if (t.includes("hum")) return "hum";
  return "lead vocal";
}

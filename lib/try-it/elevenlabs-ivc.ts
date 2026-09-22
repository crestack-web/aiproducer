/**
 * ElevenLabs Instant Voice Cloning (IVC) + low-cost TTS for Try It only.
 * Do not import from Record / produce pipelines.
 */

import { TRY_IT_TTS_MODEL, TRY_IT_TTS_MODEL_FALLBACKS } from "./config";

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

async function elFetch(path: string, init: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (const base of BASES) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "xi-api-key": apiKey(),
        ...(init.headers || {}),
      },
    });
    last = res;
    if (res.status !== 401 && res.status !== 404) return res;
  }
  return last!;
}

/** Instant Voice Clone from one or more sample buffers. */
export async function createInstantVoiceClone(opts: {
  name: string;
  samples: { buffer: Buffer; filename: string; contentType: string }[];
  removeBackgroundNoise?: boolean;
}): Promise<{ voiceId: string }> {
  const form = new FormData();
  form.append("name", opts.name.slice(0, 100));
  form.append(
    "description",
    "AP Studio Try It trial clone — temporary, not a permanent artist profile"
  );
  form.append(
    "remove_background_noise",
    opts.removeBackgroundNoise === false ? "false" : "true"
  );
  for (const s of opts.samples) {
    const blob = new Blob([new Uint8Array(s.buffer)], { type: s.contentType || "audio/mpeg" });
    form.append("files", blob, s.filename);
  }

  const res = await elFetch("/v1/voices/add", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    throw new Error(`IVC failed (${res.status}): ${body}`);
  }
  const j = (await res.json()) as { voice_id?: string };
  if (!j.voice_id) throw new Error("IVC returned no voice_id");
  return { voiceId: j.voice_id };
}

export async function deleteTrialVoice(voiceId: string): Promise<void> {
  try {
    await elFetch(`/v1/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
  } catch {
    /* best-effort */
  }
}

/**
 * Draft TTS with Flash/Turbo tier only (cost-controlled).
 * Caps text length so spoken output stays near the 15–20s demo window.
 */
export async function synthesizeWithVoice(
  voiceId: string,
  text: string
): Promise<{ buffer: Buffer; contentType: string; modelUsed: string }> {
  // ~18s of speech ≈ short hook; hard truncate regardless of client input
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 220);
  if (!clean) throw new Error("Empty lyrics");

  const models = [TRY_IT_TTS_MODEL, ...TRY_IT_TTS_MODEL_FALLBACKS].filter(
    (v, i, a) => v && a.indexOf(v) === i
  );

  let lastErr = "TTS failed";
  for (const modelId of models) {
    const res = await elFetch(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: clean,
          model_id: modelId,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
      }
    );
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 200) {
        lastErr = "TTS returned empty audio";
        continue;
      }
      return { buffer, contentType: "audio/mpeg", modelUsed: modelId };
    }
    lastErr = `TTS failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
    // model not available → try next flash/turbo fallback
    if (res.status === 400 || res.status === 422 || res.status === 404) continue;
    throw new Error(lastErr);
  }
  throw new Error(lastErr);
}

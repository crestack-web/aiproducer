/**
 * ElevenLabs Instant Voice Cloning (IVC) + TTS for Try It only.
 * Do not import from Record / produce pipelines.
 */

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

/** TTS with cloned voice — draft preview vocal (not full singing model). */
export async function synthesizeWithVoice(
  voiceId: string,
  text: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 800);
  if (!clean) throw new Error("Empty lyrics");

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
        model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.85,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 200) throw new Error("TTS returned empty audio");
  return { buffer, contentType: "audio/mpeg" };
}

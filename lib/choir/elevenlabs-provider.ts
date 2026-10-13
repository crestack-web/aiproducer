/**
 * ElevenLabs choir provider — Speech-to-Speech (voice conversion) only.
 *
 * Official endpoint (verified):
 *   POST https://api.elevenlabs.io/v1/speech-to-speech/{voice_id}
 *   multipart: audio file
 *   model_id: eleven_multilingual_sts_v2 | eleven_english_sts_v2
 *   Docs: https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
 *
 * STS preserves timing/emotion of the input as closely as the model allows.
 * It does NOT document musical interval / pitch-shift controls — harmony
 * intervals are handled by the hybrid pipeline (Kits pitchShift or explicit
 * offline arrangement), not invented EL parameters.
 */

import type {
  ChoirGenerateRequest,
  ChoirGenerateResult,
  ChoirProvider,
  GeneratedChoirPart,
} from "./types";
import { resolveSectionSpecs } from "./voice-presets";

const BASE =
  process.env.ELEVENLABS_API_BASE?.replace(/\/$/, "") || "https://api.elevenlabs.io";

function apiKey(): string | null {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  return k || null;
}

/** Default public library voices — override with ELEVENLABS_CHOIR_VOICE_* */
const FALLBACK_VOICES = {
  soprano: process.env.ELEVENLABS_CHOIR_VOICE_SOPRANO?.trim() || "EXAVITQu4vr4xnSDxMaL", // Bella-ish default placeholder — owner should set real IDs
  alto: process.env.ELEVENLABS_CHOIR_VOICE_ALTO?.trim() || "21m00Tcm4TlvDq8ikWAM", // Rachel
  tenor: process.env.ELEVENLABS_CHOIR_VOICE_TENOR?.trim() || "VR6AewLTigWG4xSOukaG", // Arnold
  bass: process.env.ELEVENLABS_CHOIR_VOICE_BASS?.trim() || "pNInz6obpgDQGcFmaJgB", // Adam
  support: process.env.ELEVENLABS_CHOIR_VOICE_SUPPORT?.trim() || "AZnzlk1XvdvUeBnXmlld", // Domi
};

function voiceForRole(role: string, index: number): string {
  const r = role.toLowerCase();
  if (r.includes("soprano")) return FALLBACK_VOICES.soprano;
  if (r.includes("alto")) return FALLBACK_VOICES.alto;
  if (r.includes("tenor")) return FALLBACK_VOICES.tenor;
  if (r.includes("bass")) return FALLBACK_VOICES.bass;
  const cycle = [
    FALLBACK_VOICES.soprano,
    FALLBACK_VOICES.alto,
    FALLBACK_VOICES.tenor,
    FALLBACK_VOICES.bass,
    FALLBACK_VOICES.support,
  ];
  return cycle[index % cycle.length];
}

function stsModel(): string {
  return (
    process.env.ELEVENLABS_STS_MODEL?.trim() ||
    "eleven_multilingual_sts_v2"
  );
}

async function speechToSpeech(opts: {
  key: string;
  voiceId: string;
  audio: Buffer;
  fileName: string;
}): Promise<Buffer> {
  const form = new FormData();
  const bytes = new Uint8Array(opts.audio);
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), opts.fileName || "lead.wav");
  form.append("model_id", stsModel());

  const url = `${BASE}/v1/speech-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": opts.key,
        Accept: "audio/mpeg",
      },
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("ElevenLabs speech-to-speech timed out");
    }
    throw e;
  }
  clearTimeout(timer);

  if (res.status === 401) {
    throw new Error("ElevenLabs rejected the API key (401)");
  }
  if (res.status === 429) {
    throw new Error("ElevenLabs rate limit exceeded — try again shortly");
  }
  if (res.status === 402) {
    throw new Error("ElevenLabs quota or payment required for speech-to-speech");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs speech-to-speech failed (${res.status}): ${body.slice(0, 220)}`
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) {
    throw new Error("ElevenLabs returned empty or tiny audio");
  }
  return buf;
}

export class ElevenLabsChoirProvider implements ChoirProvider {
  readonly id = "elevenlabs";
  readonly displayName = "ElevenLabs Speech-to-Speech";

  isConfigured(): boolean {
    return Boolean(apiKey());
  }

  /**
   * Converts the lead into multiple distinct voices (same melody by default).
   * pitchShift on specs is ignored here — interval harmonies are applied by
   * the hybrid orchestrator using Kits or offline arrangement.
   */
  async generate(req: ChoirGenerateRequest): Promise<ChoirGenerateResult> {
    const key = apiKey();
    if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");

    const specs = resolveSectionSpecs({
      arrangement: req.arrangement,
      balance: req.balance,
      harmonyIntensity: req.harmonyIntensity,
      style: req.style,
    });

    const warnings: string[] = [];
    if (
      !process.env.ELEVENLABS_CHOIR_VOICE_SOPRANO &&
      !process.env.ELEVENLABS_CHOIR_VOICE_ALTO &&
      !process.env.ELEVENLABS_CHOIR_VOICE_TENOR &&
      !process.env.ELEVENLABS_CHOIR_VOICE_BASS
    ) {
      warnings.push(
        "Using default ElevenLabs voice IDs. Set ELEVENLABS_CHOIR_VOICE_SOPRANO/ALTO/TENOR/BASS for distinct choir timbres."
      );
    }

    const fileName = req.sourceFileName || "lead.wav";
    const parts: GeneratedChoirPart[] = [];
    let index = 0;

    // Sequential to respect rate limits
    for (const spec of specs) {
      const voiceId = voiceForRole(spec.role, index++);
      try {
        const audio = await speechToSpeech({
          key,
          voiceId,
          audio: req.sourceAudio,
          fileName,
        });
        parts.push({
          role: spec.role,
          label: `${spec.label} · EL`,
          audio,
          contentType: "audio/mpeg",
          gainDb: spec.gainDb,
          pan: spec.pan,
          voiceModelId: voiceId,
        });
        // Small delay between jobs
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`${spec.label}: ${msg}`);
        // Continue other parts
      }
    }

    if (!parts.length) {
      throw new Error(
        warnings[0] || "ElevenLabs produced no choir parts"
      );
    }

    warnings.push(
      "ElevenLabs STS converts voice timbre; musical intervals (if any) are applied by the hybrid harmony stage when configured."
    );

    return {
      provider: this.id,
      isAiGenerated: true,
      parts,
      warnings,
    };
  }

  /** Single-part conversion — used by hybrid harmony for one voice ID */
  async convertOne(
    sourceAudio: Buffer,
    voiceId: string,
    fileName = "lead.wav"
  ): Promise<Buffer> {
    const key = apiKey();
    if (!key) throw new Error("ELEVENLABS_API_KEY is not configured");
    return speechToSpeech({ key, voiceId, audio: sourceAudio, fileName });
  }
}

export function createElevenLabsChoirProvider(): ElevenLabsChoirProvider {
  return new ElevenLabsChoirProvider();
}

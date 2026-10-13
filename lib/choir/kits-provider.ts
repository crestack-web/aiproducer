/**
 * Kits AI choir provider — verified public API only.
 *
 * Docs: https://docs.kits.ai
 *   POST /api/kits/v1/voice-conversions  (multipart)
 *   GET  /api/kits/v1/voice-conversions/:id
 *
 * Supports voiceModelId, pitchShift (−24..24), conversionStrength, modelVolumeMix.
 * Harmony Generator / Choir Studio on the Kits website are NOT exposed as
 * separate API endpoints in the public docs — multi-voice choir is built by
 * multiple conversion jobs with distinct models + optional pitchShift.
 */

import type {
  ChoirGenerateRequest,
  ChoirGenerateResult,
  ChoirProvider,
  GeneratedChoirPart,
} from "./types";
import { resolveSectionSpecs } from "./voice-presets";

const BASE = "https://arpeggi.io/api/kits/v1";

function apiKey(): string | null {
  return process.env.KITS_API_KEY?.trim() || process.env.KITS_AI_API_KEY?.trim() || null;
}

type KitsJob = {
  id: number;
  status: "running" | "success" | "error" | "cancelled" | string;
  outputFileUrl?: string | null;
  lossyOutputFileUrl?: string | null;
  voiceModelId?: number | string | null;
};

async function createConversion(opts: {
  key: string;
  voiceModelId: number;
  soundFile: Buffer;
  fileName: string;
  pitchShift: number;
}): Promise<KitsJob> {
  const form = new FormData();
  form.append("voiceModelId", String(opts.voiceModelId));
  const bytes = new Uint8Array(opts.soundFile);
  form.append(
    "soundFile",
    new Blob([bytes], { type: "audio/wav" }),
    opts.fileName || "lead.wav"
  );
  if (opts.pitchShift !== 0) {
    form.append("pitchShift", String(Math.max(-24, Math.min(24, opts.pitchShift))));
  }
  // Keep conversion moderate so phrasing stays close to the lead
  form.append("conversionStrength", "0.65");
  form.append("modelVolumeMix", "0.45");

  const res = await fetch(`${BASE}/voice-conversions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.key}` },
    body: form,
  });
  const text = await res.text();
  let json: KitsJob | { message?: string; error?: string } = {} as KitsJob;
  try {
    json = JSON.parse(text) as KitsJob;
  } catch {
    /* */
  }
  if (!res.ok) {
    const msg =
      (json as { message?: string }).message ||
      (json as { error?: string }).error ||
      text.slice(0, 200) ||
      `Kits conversion failed (${res.status})`;
    throw new Error(msg);
  }
  return json as KitsJob;
}

async function pollJob(key: string, id: number, timeoutMs = 180_000): Promise<KitsJob> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE}/voice-conversions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const job = (await res.json()) as KitsJob;
    if (job.status === "success") return job;
    if (job.status === "error" || job.status === "cancelled") {
      throw new Error(`Kits job ${id} ${job.status}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`Kits job ${id} timed out`);
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download Kits output (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export class KitsChoirProvider implements ChoirProvider {
  readonly id = "kits";
  readonly displayName = "Kits AI";

  isConfigured(): boolean {
    return Boolean(apiKey());
  }

  async generate(req: ChoirGenerateRequest): Promise<ChoirGenerateResult> {
    const key = apiKey();
    if (!key) {
      throw new Error("KITS_API_KEY is not configured");
    }

    const specs = resolveSectionSpecs({
      arrangement: req.arrangement,
      balance: req.balance,
      harmonyIntensity: req.harmonyIntensity,
      style: req.style,
    });

    const warnings: string[] = [];
    if (
      !process.env.KITS_VOICE_SOPRANO &&
      !process.env.KITS_VOICE_ALTO &&
      !process.env.KITS_VOICE_TENOR &&
      !process.env.KITS_VOICE_BASS
    ) {
      warnings.push(
        "Using default Kits voice model IDs. Set KITS_VOICE_SOPRANO/ALTO/TENOR/BASS to distinct royalty-free model IDs for a more realistic choir."
      );
    }

    const fileName = req.sourceFileName || "lead.wav";
    const parts: GeneratedChoirPart[] = [];

    // Sequential jobs to respect rate limits; parallel later if account allows
    for (const spec of specs) {
      const job = await createConversion({
        key,
        voiceModelId: spec.defaultModelId,
        soundFile: req.sourceAudio,
        fileName,
        pitchShift: spec.pitchShift,
      });
      const done = await pollJob(key, job.id);
      const url = done.outputFileUrl || done.lossyOutputFileUrl;
      if (!url) {
        warnings.push(`No output URL for ${spec.label} (job ${job.id})`);
        continue;
      }
      const audio = await downloadUrl(url);
      const ct = url.includes(".mp3") ? "audio/mpeg" : "audio/wav";
      parts.push({
        role: spec.role,
        label: spec.label,
        audio,
        contentType: ct,
        gainDb: spec.gainDb,
        pan: spec.pan,
        providerJobId: done.id,
        voiceModelId: spec.defaultModelId,
      });
    }

    if (!parts.length) {
      throw new Error("Kits returned no choir parts");
    }

    return {
      provider: this.id,
      isAiGenerated: true,
      parts,
      warnings,
    };
  }
}

export function createKitsChoirProvider(): KitsChoirProvider {
  return new KitsChoirProvider();
}

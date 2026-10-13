/**
 * Local DSP stack — NOT an AI singing model.
 * Kept as fallback when no AI provider credentials are configured.
 * Uses generateStack (timing + micro-detune + spectral tint of the same take).
 */

import { generateStack } from "@/lib/ap-engine/fullness";
import { normalizeToInternalPcm } from "@/lib/ap-engine/ingestion/normalize";
import { encodeWavStereoFromMono } from "@/lib/audio/wav";
import type {
  ChoirGenerateRequest,
  ChoirGenerateResult,
  ChoirProvider,
} from "./types";

function arrangementToMode(
  a: ChoirGenerateRequest["arrangement"]
): "double" | "choir_light" | "choir_full" {
  if (a === "light") return "double";
  if (a === "medium") return "choir_light";
  return "choir_full";
}

export class LocalStackChoirProvider implements ChoirProvider {
  readonly id = "local_stack";
  readonly displayName = "Local stack (DSP)";

  isConfigured(): boolean {
    return true;
  }

  async generate(req: ChoirGenerateRequest): Promise<ChoirGenerateResult> {
    const lead = await normalizeToInternalPcm(req.sourceAudio, "lead-choir-src");
    const voices = generateStack({
      lead: lead.pcm,
      mode: arrangementToMode(req.arrangement),
      startMs: 0,
    });

    const parts = voices.map((v) => {
      const mono = new Float32Array(v.pcm.left.length);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = ((v.pcm.left[i] || 0) + (v.pcm.right[i] || 0)) * 0.5;
      }
      const wav = encodeWavStereoFromMono(mono, v.pcm.sampleRate || 44100);
      return {
        role: (v.role === "double" ? "double" : "alto") as const,
        label: v.label,
        audio: wav,
        contentType: "audio/wav",
        gainDb: v.gainDb,
        pan: v.pan,
      };
    });

    return {
      provider: this.id,
      isAiGenerated: false,
      parts,
      warnings: [
        "AI choir provider is not configured. Used local DSP stack (same take with timing/spectral variation). Set KITS_API_KEY for multi-voice AI conversion.",
      ],
    };
  }
}

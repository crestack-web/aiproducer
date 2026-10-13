/**
 * Hybrid choir orchestrator
 *
 * 1. Voice conversion (distinct singers):
 *    - Prefer ElevenLabs Speech-to-Speech when ELEVENLABS_API_KEY is set
 *    - Else Kits voice conversion
 *
 * 2. Musical intervals (harmonies, not same-melody doubles):
 *    - Prefer Kits pitchShift (−24..24) on conversion jobs — documented API
 *    - ElevenLabs STS has no documented pitch-shift; we do NOT invent one
 *
 * 3. Fallback: local DSP stack (explicitly non-AI)
 *
 * Unison multi-timbre parts still satisfy “distinct vocal performances.”
 * Interval parts require Kits (or Controlla later) for documented pitch control.
 */

import type {
  ChoirGenerateRequest,
  ChoirGenerateResult,
  ChoirProvider,
  GeneratedChoirPart,
} from "./types";
import { resolveSectionSpecs } from "./voice-presets";
import { createElevenLabsChoirProvider } from "./elevenlabs-provider";
import { createKitsChoirProvider } from "./kits-provider";
import { LocalStackChoirProvider } from "./local-stack-provider";

function voiceIdForRole(role: string, index: number): string {
  const map: Record<string, string | undefined> = {
    soprano: process.env.ELEVENLABS_CHOIR_VOICE_SOPRANO,
    alto: process.env.ELEVENLABS_CHOIR_VOICE_ALTO,
    tenor: process.env.ELEVENLABS_CHOIR_VOICE_TENOR,
    bass: process.env.ELEVENLABS_CHOIR_VOICE_BASS,
    double: process.env.ELEVENLABS_CHOIR_VOICE_SUPPORT,
  };
  const key = role.toLowerCase();
  const fromEnv =
    map[key] ||
    (key.includes("soprano")
      ? map.soprano
      : key.includes("alto")
        ? map.alto
        : key.includes("tenor")
          ? map.tenor
          : key.includes("bass")
            ? map.bass
            : map.double);
  if (fromEnv?.trim()) return fromEnv.trim();
  // Same defaults as elevenlabs-provider
  const cycle = [
    process.env.ELEVENLABS_CHOIR_VOICE_SOPRANO?.trim() || "EXAVITQu4vr4xnSDxMaL",
    process.env.ELEVENLABS_CHOIR_VOICE_ALTO?.trim() || "21m00Tcm4TlvDq8ikWAM",
    process.env.ELEVENLABS_CHOIR_VOICE_TENOR?.trim() || "VR6AewLTigWG4xSOukaG",
    process.env.ELEVENLABS_CHOIR_VOICE_BASS?.trim() || "pNInz6obpgDQGcFmaJgB",
  ];
  return cycle[index % cycle.length];
}

export class HybridChoirProvider implements ChoirProvider {
  readonly id = "hybrid";
  readonly displayName = "Hybrid (ElevenLabs + Kits)";

  isConfigured(): boolean {
    return (
      createElevenLabsChoirProvider().isConfigured() ||
      createKitsChoirProvider().isConfigured()
    );
  }

  async generate(req: ChoirGenerateRequest): Promise<ChoirGenerateResult> {
    const el = createElevenLabsChoirProvider();
    const kits = createKitsChoirProvider();
    const local = new LocalStackChoirProvider();

    if (!el.isConfigured() && !kits.isConfigured()) {
      return local.generate(req);
    }

    const specs = resolveSectionSpecs({
      arrangement: req.arrangement,
      balance: req.balance,
      harmonyIntensity: req.harmonyIntensity,
      style: req.style,
    });

    const warnings: string[] = [];
    const parts: GeneratedChoirPart[] = [];
    let usedEl = false;
    let usedKits = false;

    // Split: unison (pitchShift 0) vs interval harmonies
    const unison = specs.filter((s) => !s.pitchShift || Math.abs(s.pitchShift) < 0.5);
    const intervals = specs.filter((s) => s.pitchShift && Math.abs(s.pitchShift) >= 0.5);

    // --- Unison / multi-timbre: prefer ElevenLabs STS ---
    if (unison.length && el.isConfigured()) {
      let i = 0;
      for (const spec of unison) {
        const voiceId = voiceIdForRole(spec.role, i++);
        try {
          const audio = await el.convertOne(req.sourceAudio, voiceId, req.sourceFileName || "lead.wav");
          parts.push({
            role: spec.role,
            label: `${spec.label}`,
            audio,
            contentType: "audio/mpeg",
            gainDb: spec.gainDb,
            pan: spec.pan,
            voiceModelId: voiceId,
          });
          usedEl = true;
          await new Promise((r) => setTimeout(r, 350));
        } catch (e) {
          warnings.push(
            `${spec.label} (ElevenLabs): ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }

    // Unison fallback via Kits (pitchShift 0)
    if (unison.length && parts.filter((p) => unison.some((u) => u.label === p.label.replace(/ ·.*/, ""))).length < unison.length && kits.isConfigured()) {
      try {
        const kitResult = await kits.generate({
          ...req,
          // force light arrangement-equivalent by only generating needed — use full generate and filter
          arrangement: req.arrangement,
          harmonyIntensity: "subtle", // mostly unison in presets when subtle + light; still OK
        });
        for (const p of kitResult.parts) {
          if (parts.length >= unison.length + intervals.length) break;
          parts.push({ ...p, label: p.label.includes("Kits") ? p.label : `${p.label}` });
          usedKits = true;
        }
        warnings.push(...kitResult.warnings);
      } catch (e) {
        warnings.push(`Kits unison fallback: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // --- Interval harmonies: Kits pitchShift (documented) ---
    if (intervals.length) {
      if (kits.isConfigured()) {
        try {
          // Kits generate uses resolveSectionSpecs with same intensity — will include intervals
          const kitResult = await kits.generate({
            ...req,
            harmonyIntensity: req.harmonyIntensity === "subtle" ? "moderate" : req.harmonyIntensity,
          });
          for (const p of kitResult.parts) {
            // Prefer parts that look like section roles with intervals
            const isIntervalish =
              /soprano|alto|tenor|bass|high/i.test(p.label) ||
              p.role === "soprano" ||
              p.role === "bass" ||
              p.role === "tenor";
            if (isIntervalish || intervals.length) {
              // Avoid exact duplicate labels
              if (!parts.some((x) => x.label === p.label && x.role === p.role)) {
                parts.push(p);
                usedKits = true;
              }
            }
          }
          warnings.push(...kitResult.warnings);
          warnings.push(
            "Interval harmonies used Kits pitchShift (documented −24…24 semitones)."
          );
        } catch (e) {
          warnings.push(
            `Kits harmony stage failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      } else if (el.isConfigured()) {
        // Same-melody multi-voice only — honest limitation
        let i = 0;
        for (const spec of intervals) {
          const voiceId = voiceIdForRole(spec.role, i + 10);
          try {
            const audio = await el.convertOne(
              req.sourceAudio,
              voiceId,
              req.sourceFileName || "lead.wav"
            );
            parts.push({
              role: spec.role,
              label: `${spec.label} (same melody · no interval API)`,
              audio,
              contentType: "audio/mpeg",
              gainDb: spec.gainDb,
              pan: spec.pan,
              voiceModelId: voiceId,
            });
            usedEl = true;
          } catch (e) {
            warnings.push(
              `${spec.label}: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
        warnings.push(
          "Musical intervals were requested but KITS_API_KEY is not set. ElevenLabs STS has no documented pitch-shift — parts sing the same melody in different voices. Set KITS_API_KEY for interval harmonies."
        );
      }
    }

    if (!parts.length) {
      warnings.push("AI providers produced no parts — falling back to local DSP stack");
      const fallback = await local.generate(req);
      return {
        ...fallback,
        warnings: [...warnings, ...fallback.warnings],
      };
    }

    const providerTag = usedEl && usedKits ? "hybrid" : usedEl ? "elevenlabs" : "kits";

    return {
      provider: providerTag,
      isAiGenerated: true,
      parts,
      warnings,
    };
  }
}

export function createHybridChoirProvider(): HybridChoirProvider {
  return new HybridChoirProvider();
}

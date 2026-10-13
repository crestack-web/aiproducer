import type { ChoirProvider } from "./types";
import { createHybridChoirProvider } from "./hybrid-provider";
import { createElevenLabsChoirProvider } from "./elevenlabs-provider";
import { createKitsChoirProvider } from "./kits-provider";
import { LocalStackChoirProvider } from "./local-stack-provider";

export type {
  ChoirStyle,
  ChoirArrangement,
  ChoirBalance,
  HarmonyIntensity,
  ChoirGenerateRequest,
  ChoirGenerateResult,
  GeneratedChoirPart,
  ChoirProvider,
} from "./types";

export { resolveSectionSpecs } from "./voice-presets";
export { createElevenLabsChoirProvider } from "./elevenlabs-provider";
export { createKitsChoirProvider } from "./kits-provider";
export { createHybridChoirProvider } from "./hybrid-provider";

/**
 * Provider selection (verified capabilities only):
 * 1. Hybrid when either ElevenLabs or Kits is configured
 *    - EL STS → distinct singers (same melody)
 *    - Kits pitchShift → interval harmonies when KITS_API_KEY set
 * 2. Local DSP stack otherwise (explicit non-AI)
 */
export function resolveChoirProvider(): ChoirProvider {
  const hybrid = createHybridChoirProvider();
  if (hybrid.isConfigured()) return hybrid;
  return new LocalStackChoirProvider();
}

export function listChoirProviders(): {
  id: string;
  configured: boolean;
  name: string;
  role: string;
}[] {
  const el = createElevenLabsChoirProvider();
  const kits = createKitsChoirProvider();
  return [
    {
      id: "elevenlabs",
      name: el.displayName,
      configured: el.isConfigured(),
      role: "Voice conversion (Speech-to-Speech) — distinct singers",
    },
    {
      id: "kits",
      name: kits.displayName,
      configured: kits.isConfigured(),
      role: "Voice conversion + documented pitchShift for intervals",
    },
    {
      id: "hybrid",
      name: "Hybrid (EL + Kits)",
      configured: el.isConfigured() || kits.isConfigured(),
      role: "EL for multi-timbre; Kits for musical intervals when both available",
    },
    {
      id: "controlla",
      name: "Controlla Voice (Choir Studio)",
      configured: Boolean(process.env.CONTROLLA_API_KEY?.trim()),
      role: "Quality reference — no public self-serve API yet",
    },
    {
      id: "local_stack",
      name: "Local DSP stack",
      configured: true,
      role: "Fallback only — same-take timing/spectral variation",
    },
  ];
}

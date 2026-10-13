import type { ChoirProvider } from "./types";
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

/**
 * Prefer Kits AI when KITS_API_KEY is set.
 * Controlla Choir Studio is the quality reference but has no public self-serve
 * API (Professional plan / apply-for-access only) — wire when credentials exist.
 */
export function resolveChoirProvider(): ChoirProvider {
  const kits = createKitsChoirProvider();
  if (kits.isConfigured()) return kits;
  return new LocalStackChoirProvider();
}

export function listChoirProviders(): { id: string; configured: boolean; name: string }[] {
  const kits = createKitsChoirProvider();
  return [
    { id: kits.id, name: kits.displayName, configured: kits.isConfigured() },
    {
      id: "controlla",
      name: "Controlla Voice (Choir Studio)",
      configured: Boolean(process.env.CONTROLLA_API_KEY?.trim()),
    },
    { id: "local_stack", name: "Local DSP stack", configured: true },
  ];
}

/**
 * Shared vocal cleanup contract (versioned).
 *
 * Browser: lib/audio/preview-clean.ts (Export + Console play preprocess)
 * Server:  lib/audio/console-fx-offline.ts + lib/ap-engine/dsp.ts (Produce)
 *
 * Order (both environments should follow when amounts > 0):
 *   1. high-pass (rumble)
 *   2. noiseReduce (spectral)
 *   3. de-click (mouth clicks) — browser full; server via denoise/HF path where available
 *   4. deEss
 *   5. phraseCleanup (gap close)
 *   6. gate (gap residual)
 *
 * Parameter meanings (0–1 unless noted):
 *   noiseReduce — strength of stationary noise reduction
 *   gate        — gap silence strength (higher = more closed)
 *   deEss       — HF sibilance / air attenuation
 *   phraseCleanup — close long inter-phrase gaps
 *
 * Produce must not stack lightCleanVocal when artist cleanup amounts are already high.
 */
export const CLEANUP_POLICY_VERSION = 1 as const;

export type CleanupPolicy = {
  version: typeof CLEANUP_POLICY_VERSION;
  noiseReduce: number;
  gate: number;
  deEss: number;
  phraseCleanup: number;
};

export function cleanupPolicyFromFx(fx: Record<string, number> | null | undefined): CleanupPolicy {
  const f = fx || {};
  return {
    version: CLEANUP_POLICY_VERSION,
    noiseReduce: Number(f.noiseReduce) || 0,
    gate: Number(f.gate) || 0,
    deEss: Number(f.deEss) || 0,
    phraseCleanup: Number(f.phraseCleanup) || 0,
  };
}

export function hasArtistCleanup(fx: Record<string, number> | null | undefined): boolean {
  const p = cleanupPolicyFromFx(fx);
  return p.noiseReduce > 0.2 || p.gate > 0.2 || p.phraseCleanup > 0.2 || p.deEss > 0.25;
}

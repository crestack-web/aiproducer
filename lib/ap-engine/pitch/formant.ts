export type FormantStrategy = "none" | "preserve_ola" | "future_lpc";

export function selectFormantStrategy(maxCorrectionCents: number): FormantStrategy {
  if (maxCorrectionCents <= 120) return "preserve_ola";
  return "preserve_ola";
}

export function applyFormantPreserve(
  mono: Float32Array,
  _sampleRate: number,
  _strategy: FormantStrategy
): Float32Array {
  // V1: OLA path already keeps ratios modest (±18%); full LPC reserved for later.
  return mono;
}

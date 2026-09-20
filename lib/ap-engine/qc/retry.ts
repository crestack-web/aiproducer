import type { ProductionDecision, QcResult } from "../types";
import { adjustDecisionForRetry } from "../production/decision-engine";

/**
 * Retry once when QC soft-warns about level (quiet/loud/peak) even if soft-passed,
 * or when a fatal issue remains.
 */
export function shouldRetry(qc: QcResult, retryCount: number, maxRetries = 1): boolean {
  if (retryCount >= maxRetries) return false;
  if (!qc.passed) return true;
  const levelWarn = qc.warnings.some(
    (w) =>
      w.includes("quiet") ||
      w.includes("low_level") ||
      w.includes("high_rms") ||
      w.includes("clip") ||
      w.includes("VOCAL") ||
      w.includes("PEAK") ||
      w.includes("CLIPPING")
  );
  return levelWarn;
}

export function decisionAfterQc(decision: ProductionDecision, qc: QcResult): ProductionDecision {
  return adjustDecisionForRetry(decision, qc.issues);
}

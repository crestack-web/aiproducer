import type { ProductionDecision, QcResult } from "../types";
import { adjustDecisionForRetry } from "../production/decision-engine";

export function shouldRetry(qc: QcResult, retryCount: number): boolean {
  return !qc.passed && retryCount < 1;
}

export function decisionAfterQc(decision: ProductionDecision, qc: QcResult): ProductionDecision {
  return adjustDecisionForRetry(decision, qc.issues);
}

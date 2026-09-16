/**
 * Canonical production readiness — client-safe rules shared with Booth `canProduce`.
 * Server DB checks live in check-project-produce-ready.ts (must not import next/headers into client graphs).
 */

import { canProduce, type PlanTaskRow } from "@/lib/plan";

export type ProduceReadinessCode =
  | "ok"
  | "no_active_plan"
  | "missing_recording"
  | "takes_not_on_plan"
  | "not_found";

export type ProduceReadiness = {
  canProduce: boolean;
  code: ProduceReadinessCode;
  /** User-facing, no DB/provider jargon */
  reason: string;
};

/** Client-safe: same rules as Booth `canProduce`. */
export function produceReadinessFromTasks(tasks: PlanTaskRow[]): ProduceReadiness {
  const gate = canProduce(tasks);
  if (gate.ok) {
    return { canProduce: true, code: "ok", reason: "" };
  }
  const reason = gate.reason || "Record at least one selected part before producing.";
  let code: ProduceReadinessCode = "missing_recording";
  if (/select at least one part/i.test(reason)) code = "no_active_plan";
  return { canProduce: false, code, reason };
}

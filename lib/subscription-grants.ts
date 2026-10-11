/**
 * Hard-assigned subscription tiers by email (owner / internal / comps).
 * Plan ids match lib/plans.ts: creator = Artist, band = Band, pro = Record Label.
 */
import type { PlanId } from "@/lib/plans";
import { PLANS } from "@/lib/plans";

const BUILTIN_EMAIL_PLANS: Record<string, Exclude<PlanId, "session">> = {
  "crestack@gmail.com": "pro", // Record Label
};

function envEmailPlans(): Record<string, Exclude<PlanId, "session">> {
  const out: Record<string, Exclude<PlanId, "session">> = {};
  // Format: email:plan,email:plan  e.g. AP_GRANTED_PLANS=user@x.com:pro
  const raw = (process.env.AP_GRANTED_PLANS || "").trim();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [email, plan] = part.split(":").map((s) => s.trim().toLowerCase());
    if (!email || !plan) continue;
    if (plan === "creator" || plan === "band" || plan === "pro") {
      out[email] = plan;
    }
  }
  return out;
}

/** Returns granted plan id for an email, if any. */
export function grantedPlanForEmail(email?: string | null): Exclude<PlanId, "session"> | null {
  if (!email) return null;
  const key = String(email).trim().toLowerCase();
  if (!key) return null;
  return envEmailPlans()[key] || BUILTIN_EMAIL_PLANS[key] || null;
}

/** Human label for UI (Artist / Band / Record Label). */
export function planDisplayName(planId: string | null | undefined): string {
  if (!planId) return "Free";
  const id = String(planId).toLowerCase();
  const def = PLANS.find((p) => p.id === id);
  if (def) return def.name;
  if (id === "free") return "Free";
  return planId;
}

/**
 * Resolve effective subscription plan for a user.
 * Priority: email grant → profile metadata → null (free).
 */
export function resolveSubscriptionPlan(opts: {
  email?: string | null;
  metadata?: Record<string, unknown> | null;
  subscriptionPlanColumn?: string | null;
}): Exclude<PlanId, "session"> | null {
  const granted = grantedPlanForEmail(opts.email);
  if (granted) return granted;

  const col = opts.subscriptionPlanColumn ? String(opts.subscriptionPlanColumn).toLowerCase() : "";
  if (col === "creator" || col === "band" || col === "pro") return col;

  const meta = opts.metadata || {};
  const fromMeta = String(meta.subscription_plan || meta.plan || "").toLowerCase();
  if (fromMeta === "creator" || fromMeta === "band" || fromMeta === "pro") {
    const expires = meta.subscription_expires_at
      ? Date.parse(String(meta.subscription_expires_at))
      : null;
    if (!expires || Number.isNaN(expires) || expires > Date.now()) return fromMeta;
  }
  return null;
}

export function isPaidSubscriptionPlan(plan: string | null | undefined): boolean {
  const p = String(plan || "").toLowerCase();
  return p === "creator" || p === "band" || p === "pro";
}

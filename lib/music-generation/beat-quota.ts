/**
 * Beat generation usage gating.
 *
 * Step 0 findings:
 * - Commercial plans live in lib/plans.ts (session / creator / pro); Paystack checkout
 *   unlocks *downloads* via project.metadata.download_unlocked / subscription_plan.
 * - No dedicated subscription entitlements table or beat-credit ledger yet.
 * - Prior music-gen limits were only daily env caps (MAX_GENERATIONS_PER_USER_PER_DAY).
 *
 * This module is the first beat-specific gate on top of that:
 * - Free: 1 successful COMPLETED generation, then +1 per project that was finished & downloaded
 *   (project.metadata.beat_unlock_granted after a real download).
 * - Paid (creator/pro on any project.metadata.subscription_plan or profile if present):
 *   BEAT_GEN_PAID_PER_MONTH (default 15) completed gens per calendar month.
 * - Failed generations do not count.
 * - Non-beat features are never blocked here.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { MusicGenerationError } from "./types";

const PAID_MONTHLY_DEFAULT = 15;

export type BeatQuotaSnapshot = {
  allowed: boolean;
  isPaid: boolean;
  usedSuccessful: number;
  freeBaseAllowance: number;
  downloadUnlocks: number;
  freeLimit: number;
  paidMonthlyLimit: number;
  usedThisMonth: number;
  limit: number;
  remaining: number;
  message?: string;
  /** Hint for UI CTAs */
  upgradePath?: "plan" | "finish_download";
};

function monthlyCap(): number {
  const n = Number(process.env.BEAT_GEN_PAID_PER_MONTH || PAID_MONTHLY_DEFAULT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : PAID_MONTHLY_DEFAULT;
}

export async function isPaidBeatSubscriber(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  // Optional profile fields if present in some environments
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const p = profile as Record<string, unknown> | null;
    if (p) {
      const plan = String(p.subscription_plan || p.plan || "").toLowerCase();
      if (plan === "creator" || plan === "pro") return true;
      const meta = p.metadata;
      if (meta && typeof meta === "object") {
        const mp = String((meta as Record<string, unknown>).subscription_plan || "").toLowerCase();
        if (mp === "creator" || mp === "pro") return true;
      }
    }
  } catch {
    /* profiles shape varies */
  }

  const { data } = await supabase
    .from("projects")
    .select("metadata")
    .eq("user_id", userId)
    .limit(50);
  for (const row of data || []) {
    const m = (row as { metadata?: Record<string, unknown> }).metadata || {};
    const plan = String(m.subscription_plan || "").toLowerCase();
    if (plan === "creator" || plan === "pro") return true;
  }
  return false;
}

async function countCompletedGens(userId: string, sinceIso?: string): Promise<number> {
  const supabase = createServiceClient();
  let q = supabase
    .from("music_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "COMPLETED");
  if (sinceIso) q = q.gte("created_at", sinceIso);
  const { count, error } = await q;
  if (error) {
    console.warn("[beat-quota] count failed", error.message);
    return 0;
  }
  return count || 0;
}

async function countDownloadUnlocks(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, metadata")
    .eq("user_id", userId)
    .limit(200);
  if (error) {
    console.warn("[beat-quota] unlocks read failed", error.message);
    return 0;
  }
  let n = 0;
  for (const row of data || []) {
    const m = (row as { metadata?: Record<string, unknown> }).metadata || {};
    if (m.beat_unlock_granted === true) n += 1;
  }
  return n;
}

export async function getBeatGenQuota(userId: string): Promise<BeatQuotaSnapshot> {
  const isPaid = await isPaidBeatSubscriber(userId);
  const usedSuccessful = await countCompletedGens(userId);
  const downloadUnlocks = await countDownloadUnlocks(userId);
  const freeBaseAllowance = 1;
  const freeLimit = freeBaseAllowance + downloadUnlocks;
  const paidMonthlyLimit = monthlyCap();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usedThisMonth = await countCompletedGens(userId, monthStart.toISOString());

  if (isPaid) {
    const remaining = Math.max(0, paidMonthlyLimit - usedThisMonth);
    return {
      allowed: remaining > 0,
      isPaid: true,
      usedSuccessful,
      freeBaseAllowance,
      downloadUnlocks,
      freeLimit,
      paidMonthlyLimit,
      usedThisMonth,
      limit: paidMonthlyLimit,
      remaining,
      message:
        remaining > 0
          ? undefined
          : `You've used your ${paidMonthlyLimit} beat generations this month. Limits reset next month.`,
      upgradePath: remaining > 0 ? undefined : "plan",
    };
  }

  const remaining = Math.max(0, freeLimit - usedSuccessful);
  return {
    allowed: remaining > 0,
    isPaid: false,
    usedSuccessful,
    freeBaseAllowance,
    downloadUnlocks,
    freeLimit,
    paidMonthlyLimit,
    usedThisMonth,
    limit: freeLimit,
    remaining,
    message:
      remaining > 0
        ? undefined
        : "You've used your free beat generation. Subscribe to a monthly plan for more, or finish and download a song to unlock another.",
    upgradePath: remaining > 0 ? undefined : "finish_download",
  };
}

export async function assertBeatGenAllowed(userId: string): Promise<BeatQuotaSnapshot> {
  const snap = await getBeatGenQuota(userId);
  if (!snap.allowed) {
    throw new MusicGenerationError(
      "LIMIT_EXCEEDED",
      snap.message || "Beat generation limit reached"
    );
  }
  return snap;
}

/** After a successful master/mix download, grant +1 free beat generation (once per project). */
export async function recordSongDownloadForBeatUnlock(
  userId: string,
  projectId: string
): Promise<void> {
  const supabase = createServiceClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, metadata")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) return;
  const meta = {
    ...(((project as { metadata?: Record<string, unknown> }).metadata || {}) as Record<
      string,
      unknown
    >),
  };
  if (meta.beat_unlock_granted === true) return;
  meta.beat_unlock_granted = true;
  meta.beat_unlock_granted_at = new Date().toISOString();
  await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
}

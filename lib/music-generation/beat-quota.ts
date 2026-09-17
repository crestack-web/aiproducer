/**
 * Beat generation usage gating (duration-aware).
 *
 * Free: 3 successful COMPLETED generations, each request must be ≤ FREE_MAX_DURATION_SEC (default 30).
 * Longer selections are blocked for free users (no pay-per-overage flow).
 * After 3, unlock via Creator/Pro OR finish+download (beat_unlock_granted on project).
 *
 * Paid (creator/pro): monthly budget in total seconds (BEAT_GEN_PAID_SECONDS_PER_MONTH, default 450 = 15×30s).
 * Variable-length gens consume duration, not a flat count.
 *
 * Only COMPLETED jobs count. Failures do not consume quota.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { MusicGenerationError } from "./types";

/** Free covered generations (successful only). */
export const FREE_BEAT_GEN_COUNT = Number(process.env.BEAT_GEN_FREE_COUNT || 3);

/** Max seconds covered per free generation (matches shorter full default). */
export const FREE_MAX_DURATION_SEC = Number(process.env.BEAT_GEN_FREE_MAX_SEC || 30);

/** Default full beat length when user does not pick (seconds). */
export const DEFAULT_FULL_BEAT_SEC = Number(process.env.MUSIC_FULL_DURATION_SEC || 30);

/**
 * Estimated USD per second of ElevenLabs Music.
 * Override with ELEVENLABS_MUSIC_COST_PER_SEC_USD once dashboard metering is known.
 * Default ≈ $0.35/min fully loaded Creator-tier derivation ($0.00583/s).
 */
export function estimatedMusicCostUsdPerSec(): number {
  const n = Number(process.env.ELEVENLABS_MUSIC_COST_PER_SEC_USD || 0.00583);
  return Number.isFinite(n) && n >= 0 ? n : 0.00583;
}

export function estimateBeatCostUsd(durationSec: number): number {
  const sec = Math.max(0, durationSec);
  return Math.round(sec * estimatedMusicCostUsdPerSec() * 10000) / 10000;
}

/** Monthly paid beat allowance in seconds (env-overridable). */
function getPaidSecondsBudget(): number {
  // Prefer explicit seconds budget; fall back to count × free cap for backwards compat
  const sec = Number(process.env.BEAT_GEN_PAID_SECONDS_PER_MONTH || "");
  if (Number.isFinite(sec) && sec > 0) return Math.floor(sec);
  const count = Number(process.env.BEAT_GEN_PAID_PER_MONTH || 15);
  return Math.max(60, Math.floor((Number.isFinite(count) ? count : 15) * FREE_MAX_DURATION_SEC));
}

export type BeatQuotaSnapshot = {
  allowed: boolean;
  isPaid: boolean;
  usedSuccessful: number;
  freeBaseAllowance: number;
  downloadUnlocks: number;
  freeLimit: number;
  /** Seconds used this calendar month (paid path) */
  usedSecondsThisMonth: number;
  paidSecondsBudget: number;
  freeMaxDurationSec: number;
  remaining: number;
  remainingSeconds?: number;
  message?: string;
  upgradePath?: "plan" | "finish_download" | "shorten_duration";
  /** For UI cost preview */
  costPerSecUsd: number;
};

export async function isPaidBeatSubscriber(userId: string): Promise<boolean> {
  const supabase = createServiceClient();
  try {
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
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

  const { data } = await supabase.from("projects").select("metadata").eq("user_id", userId).limit(50);
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

/** Sum duration_sec of COMPLETED jobs this month (paid budget). */
async function sumCompletedSecondsThisMonth(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("music_generation_jobs")
    .select("duration_sec, input_data")
    .eq("user_id", userId)
    .eq("status", "COMPLETED")
    .gte("created_at", monthStart.toISOString())
    .limit(500);
  if (error) {
    console.warn("[beat-quota] seconds sum failed", error.message);
    return 0;
  }
  let total = 0;
  for (const row of data || []) {
    const r = row as { duration_sec?: number | null; input_data?: { plan?: { durationSec?: number } } };
    const sec =
      (typeof r.duration_sec === "number" && r.duration_sec > 0
        ? r.duration_sec
        : r.input_data?.plan?.durationSec) || FREE_MAX_DURATION_SEC;
    total += Number(sec) || 0;
  }
  return total;
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
  const freeBaseAllowance = FREE_BEAT_GEN_COUNT;
  const freeLimit = freeBaseAllowance + downloadUnlocks;
  const paidSecondsBudget = getPaidSecondsBudget();
  const usedSecondsThisMonth = await sumCompletedSecondsThisMonth(userId);
  const costPerSecUsd = estimatedMusicCostUsdPerSec();

  if (isPaid) {
    const remainingSeconds = Math.max(0, paidSecondsBudget - usedSecondsThisMonth);
    return {
      allowed: remainingSeconds > 0,
      isPaid: true,
      usedSuccessful,
      freeBaseAllowance,
      downloadUnlocks,
      freeLimit,
      usedSecondsThisMonth,
      paidSecondsBudget,
      freeMaxDurationSec: FREE_MAX_DURATION_SEC,
      remaining: remainingSeconds > 0 ? Math.ceil(remainingSeconds / FREE_MAX_DURATION_SEC) : 0,
      remainingSeconds,
      message:
        remainingSeconds > 0
          ? undefined
          : `You've used your ${paidSecondsBudget}s of beat generation this month. Limits reset next month.`,
      upgradePath: remainingSeconds > 0 ? undefined : "plan",
      costPerSecUsd,
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
    usedSecondsThisMonth,
    paidSecondsBudget,
    freeMaxDurationSec: FREE_MAX_DURATION_SEC,
    remaining,
    message:
      remaining > 0
        ? undefined
        : "You've used your free beat generations. Subscribe to a monthly plan for more, or finish and download a song to unlock another.",
    upgradePath: remaining > 0 ? undefined : "finish_download",
    costPerSecUsd,
  };
}

/**
 * Assert user may start a generation of the requested duration.
 * Free users: must have remaining count AND durationSec ≤ FREE_MAX_DURATION_SEC.
 * Paid users: duration must fit remaining seconds budget.
 */
export async function assertBeatGenAllowed(
  userId: string,
  durationSec?: number
): Promise<BeatQuotaSnapshot> {
  const snap = await getBeatGenQuota(userId);
  const want = Math.max(3, Math.min(300, Math.round(durationSec || DEFAULT_FULL_BEAT_SEC)));

  if (!snap.isPaid) {
    if (want > snap.freeMaxDurationSec) {
      throw new MusicGenerationError(
        "LIMIT_EXCEEDED",
        `Free beats are limited to ${snap.freeMaxDurationSec}s. Shorten the length or upgrade for longer beats.`,
        { details: { code: "FREE_DURATION_CAP", freeMaxDurationSec: snap.freeMaxDurationSec, requestedSec: want } }
      );
    }
    if (!snap.allowed) {
      throw new MusicGenerationError("LIMIT_EXCEEDED", snap.message || "Beat generation limit reached", {
        details: { code: "FREE_COUNT_EXCEEDED", remaining: 0 },
      });
    }
    return snap;
  }

  if (!snap.allowed || (snap.remainingSeconds ?? 0) < 3) {
    throw new MusicGenerationError("LIMIT_EXCEEDED", snap.message || "Monthly beat budget exhausted");
  }
  if ((snap.remainingSeconds ?? 0) < want) {
    throw new MusicGenerationError(
      "LIMIT_EXCEEDED",
      `This beat needs ${want}s but you only have ${snap.remainingSeconds}s left this month. Shorten it or wait for reset.`,
      { details: { code: "PAID_SECONDS_EXCEEDED", remainingSeconds: snap.remainingSeconds, requestedSec: want } }
    );
  }
  return snap;
}

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
    ...(((project as { metadata?: Record<string, unknown> }).metadata || {}) as Record<string, unknown>),
  };
  if (meta.beat_unlock_granted === true) return;
  meta.beat_unlock_granted = true;
  meta.beat_unlock_granted_at = new Date().toISOString();
  await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
}

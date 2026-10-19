import { grantedPlanForEmail } from "@/lib/subscription-grants";
import { createServiceClient } from "@/lib/supabase/server";

export const FREE_BEAT_GEN_COUNT = Number(process.env.BEAT_GEN_FREE_COUNT || 1) || 1;
export const FREE_MAX_DURATION_SEC = Number(process.env.BEAT_GEN_FREE_MAX_SEC || 90) || 90;
export const FREE_DURATION_OPTIONS_SEC = [60, 90].filter((s) => s <= FREE_MAX_DURATION_SEC);
export const MAX_BEAT_GENS_PER_SONG = Number(process.env.MAX_BEAT_GENS_PER_SONG || 3) || 3;
export const DEFAULT_FULL_BEAT_SEC = Number(process.env.MUSIC_FULL_DURATION_SEC || 60) || 60;

export function elevenLabsMusicUsdPerMin(): number {
  const n = Number(process.env.ELEVENLABS_MUSIC_USD_PER_MIN);
  return Number.isFinite(n) && n > 0 ? n : 0.15;
}
export function estimateBeatCostUsd(durationSec: number): number {
  const sec = Math.max(0, Number(durationSec) || 0);
  if (sec <= 0) return 0;
  const minutes = Math.max(1, Math.ceil(sec / 60));
  return Math.round(minutes * elevenLabsMusicUsdPerMin() * 1000) / 1000;
}
export function estimatedMusicCostUsdPerSec(): number {
  return elevenLabsMusicUsdPerMin() / 60;
}

export type BeatQuotaSnapshot = {
  allowed: boolean;
  isPaid: boolean;
  usedSuccessful: number;
  freeBaseAllowance: number;
  downloadUnlocks: number;
  freeLimit: number;
  usedSecondsThisMonth: number;
  paidSecondsBudget: number;
  freeMaxDurationSec: number;
  remaining: number;
  remainingSeconds?: number;
  message?: string;
  upgradePath?: "plan" | "finish_download" | "shorten_duration" | "finish_produce";
  costPerSecUsd: number;
  sequentialBlocked?: boolean;
  freeSlotsLeft?: number;
  billableGeneration?: boolean;
  finishedFreeProjects?: number;
};

export async function getSubscriberPlanName(userId: string): Promise<string> {
  if (!userId) return "";
  const supabase = createServiceClient();
  try {
    // Email grants (e.g. crestack → Record Label / pro)
    try {
      const { data } = await supabase.auth.admin.getUserById(userId);
      const email = data?.user?.email ? String(data.user.email).toLowerCase() : "";
      const granted = grantedPlanForEmail(email);
      if (granted) return granted;
    } catch {
      /* ignore */
    }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    const p = profile as Record<string, unknown> | null;
    if (!p) return "";
    const emailFromProfile =
      typeof p.email === "string" ? String(p.email).toLowerCase() : "";
    const granted2 = grantedPlanForEmail(emailFromProfile);
    if (granted2) return granted2;
    const plan = String(p.subscription_plan || p.plan || "").toLowerCase();
    if (plan === "creator" || plan === "band" || plan === "pro") return plan;
    const meta = (p.metadata || {}) as Record<string, unknown>;
    const mp = String(meta.subscription_plan || meta.plan || "").toLowerCase();
    if (mp === "creator" || mp === "band" || mp === "pro") return mp;
  } catch {
    /* ignore */
  }
  return "";
}

export async function isPaidBeatSubscriber(userId: string): Promise<boolean> {
  const plan = await getSubscriberPlanName(userId);
  return plan === "creator" || plan === "band" || plan === "pro";
}

async function countSuccessfulGens(userId: string): Promise<number> {
  if (!userId) return 0;
  const supabase = createServiceClient();
  try {
    const { count, error } = await supabase
      .from("music_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "COMPLETED")
      .not("audio_path", "is", null);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function countSuccessfulBeatGensForProject(projectId: string): Promise<number> {
  if (!projectId) return 0;
  const supabase = createServiceClient();
  try {
    const { count, error } = await supabase
      .from("music_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "COMPLETED")
      .not("audio_path", "is", null);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export async function getBeatGenQuota(userId: string): Promise<BeatQuotaSnapshot> {
  const freeBaseAllowance = FREE_BEAT_GEN_COUNT;
  const freeMaxDurationSec = FREE_MAX_DURATION_SEC;
  const costPerSecUsd = estimatedMusicCostUsdPerSec();
  if (!userId) {
    return {
      allowed: true,
      isPaid: false,
      usedSuccessful: 0,
      freeBaseAllowance,
      downloadUnlocks: 0,
      freeLimit: freeBaseAllowance,
      usedSecondsThisMonth: 0,
      paidSecondsBudget: 0,
      freeMaxDurationSec,
      remaining: freeBaseAllowance,
      costPerSecUsd,
    };
  }
  const planName = await getSubscriberPlanName(userId);
  const isPaid = planName === "creator" || planName === "band" || planName === "pro";
  const usedSuccessful = await countSuccessfulGens(userId);
  const freeLimit = freeBaseAllowance;
  if (isPaid) {
    return {
      allowed: true,
      isPaid: true,
      usedSuccessful,
      freeBaseAllowance,
      downloadUnlocks: 0,
      freeLimit,
      usedSecondsThisMonth: 0,
      paidSecondsBudget: 30 * 180,
      freeMaxDurationSec,
      remaining: 30,
      remainingSeconds: 30 * 180,
      costPerSecUsd,
    };
  }
  const remaining = Math.max(0, freeLimit - usedSuccessful);
  return {
    allowed: remaining > 0,
    isPaid: false,
    usedSuccessful,
    freeBaseAllowance,
    downloadUnlocks: 0,
    freeLimit,
    usedSecondsThisMonth: 0,
    paidSecondsBudget: 0,
    freeMaxDurationSec,
    remaining,
    freeSlotsLeft: remaining,
    sequentialBlocked: false,
    billableGeneration: remaining <= 0,
    message:
      remaining > 0
        ? undefined
        : "You've used your free beat. Finish a song and pay to download, subscribe, or generate a paid beat.",
    upgradePath: remaining > 0 ? undefined : "finish_download",
    costPerSecUsd,
  };
}

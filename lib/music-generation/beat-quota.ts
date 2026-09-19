/**
 * Beat generation usage gating (duration-aware).
 *
 * Free: 3 successful COMPLETED generations with real audio, each ≤ FREE_MAX_DURATION_SEC (default 180 = 3 min).
 * Longer selections are blocked for free users (no pay-per-overage).
 * After free quota, unlock via Creator/Pro OR finish+download (beat_unlock_granted).
 *
 * Paid: monthly budget in total seconds (default 450).
 *
 * CRITICAL: only COMPLETED jobs that produced audio count. Failed / cancelled / empty
 * attempts must never burn free quota (that was blocking new users).
 */

import { createServiceClient } from "@/lib/supabase/server";
import { MusicGenerationError } from "./types";

function envInt(name: string, fallback: number, min?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  if (min !== undefined && v < min) return fallback;
  return v;
}

/** Free covered generations (successful only). Product default: 3. */
export const FREE_BEAT_GEN_COUNT = envInt("BEAT_GEN_FREE_COUNT", 3, 1);

/** Max seconds covered per free generation. */
export const FREE_MAX_DURATION_SEC = envInt("BEAT_GEN_FREE_MAX_SEC", 180, 5);

/** Default full beat length when user does not pick (seconds). */
export const DEFAULT_FULL_BEAT_SEC = envInt("MUSIC_FULL_DURATION_SEC", 60, 5);

/**
 * Product pricing: $1.00 for a 2-minute (120s) beat.
 * Longer/shorter scale linearly. Override with BEAT_PAID_USD_PER_120S or per-sec env.
 */
export function estimatedMusicCostUsdPerSec(): number {
  const per120 = Number(process.env.BEAT_PAID_USD_PER_120S || 1);
  const fromAnchor =
    Number.isFinite(per120) && per120 > 0 ? per120 / 120 : 1 / 120;
  const n = Number(process.env.ELEVENLABS_MUSIC_COST_PER_SEC_USD || process.env.BEAT_COST_PER_SEC_USD || "");
  if (Number.isFinite(n) && n > 0) return n;
  return fromAnchor;
}

export function estimateBeatCostUsd(durationSec: number): number {
  const sec = Math.max(5, Math.min(240, Math.round(durationSec || 60)));
  // Round to cents; minimum $0.25 so short previews still show a clear price
  const raw = sec * estimatedMusicCostUsdPerSec();
  return Math.max(0.25, Math.round(raw * 100) / 100);
}

/**
 * Monthly beat-generation seconds by subscription plan.
 * Override with BEAT_GEN_CREATOR_SECONDS / BEAT_GEN_PRO_SECONDS / BEAT_GEN_PAID_SECONDS_PER_MONTH.
 */
function getPaidSecondsBudgetForPlan(plan: string): number {
  const global = envInt("BEAT_GEN_PAID_SECONDS_PER_MONTH", 0, 0);
  if (global > 0) return global;
  const p = plan.toLowerCase();
  if (p === "pro") {
    return envInt("BEAT_GEN_PRO_SECONDS", 30 * 180, 60); // ~30 × 3 min
  }
  if (p === "creator") {
    return envInt("BEAT_GEN_CREATOR_SECONDS", 10 * 180, 60); // ~10 × 3 min
  }
  // Unknown paid plan — modest default
  const count = envInt("BEAT_GEN_PAID_PER_MONTH", 15, 1);
  return Math.max(60, count * FREE_MAX_DURATION_SEC);
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
  /** Next free slot requires prior free project to be recorded + produced */
  sequentialBlocked?: boolean;
  /** Free slots left in the 3 (before sequential gate) */
  freeSlotsLeft?: number;
  /** After free exhausted, generation is allowed but billable on song download */
  billableGeneration?: boolean;
  finishedFreeProjects?: number;
};

export async function getSubscriberPlanName(userId: string): Promise<string> {
  if (!userId) return "";
  const supabase = createServiceClient();
  try {
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    const p = profile as Record<string, unknown> | null;
    if (!p) return "";
    const plan = String(p.subscription_plan || p.plan || "").toLowerCase();
    if (plan === "creator" || plan === "pro") return plan;
    const meta = p.metadata;
    if (meta && typeof meta === "object") {
      const mp = String(
        (meta as Record<string, unknown>).plan ||
          (meta as Record<string, unknown>).subscription_plan ||
          ""
      ).toLowerCase();
      if (mp === "creator" || mp === "pro") return mp;
    }
    const status = String(p.subscription_status || "").toLowerCase();
    if ((status === "active" || status === "trialing") && plan && plan !== "free" && plan !== "session") {
      return plan;
    }
  } catch {
    /* ignore */
  }
  return "";
}

export async function isPaidBeatSubscriber(userId: string): Promise<boolean> {
  const plan = await getSubscriberPlanName(userId);
  return plan === "creator" || plan === "pro";
}


/**
 * Count only true successes: COMPLETED + has audio (beat was actually produced).
 * Failed / stuck / cancelled jobs do NOT count against free or paid quotas.
 */
async function countSuccessfulGens(userId: string, sinceIso?: string): Promise<number> {
  if (!userId) return 0;
  const supabase = createServiceClient();
  try {
    let q = supabase
      .from("music_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "COMPLETED")
      .not("audio_path", "is", null);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { count, error } = await q;
    if (error) {
      console.warn("[beat-quota] count failed (fail-open)", error.message);
      return 0;
    }
    return count || 0;
  } catch (e) {
    console.warn("[beat-quota] count exception (fail-open)", e);
    return 0;
  }
}

async function sumSuccessfulSecondsThisMonth(userId: string): Promise<number> {
  if (!userId) return 0;
  const supabase = createServiceClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  try {
    const { data, error } = await supabase
      .from("music_generation_jobs")
      .select("duration_sec, audio_path, input_data")
      .eq("user_id", userId)
      .eq("status", "COMPLETED")
      .not("audio_path", "is", null)
      .gte("created_at", monthStart.toISOString())
      .limit(500);
    if (error) {
      console.warn("[beat-quota] seconds sum failed (fail-open)", error.message);
      return 0;
    }
    let total = 0;
    for (const row of data || []) {
      const r = row as {
        duration_sec?: number | null;
        input_data?: { plan?: { durationSec?: number }; duration_sec?: number };
      };
      const sec =
        (typeof r.duration_sec === "number" && r.duration_sec > 0
          ? r.duration_sec
          : r.input_data?.duration_sec || r.input_data?.plan?.durationSec) || 0;
      total += Number(sec) || 0;
    }
    return total;
  } catch (e) {
    console.warn("[beat-quota] seconds exception (fail-open)", e);
    return 0;
  }
}

async function countDownloadUnlocks(userId: string): Promise<number> {
  if (!userId) return 0;
  const supabase = createServiceClient();
  try {
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
  } catch {
    return 0;
  }
}


type FreeProjectCounts = {
  /** Free-slot projects still open (no paid download unlock) */
  openFree: number;
  /** Free-slot projects unlocked via paid download */
  unlockedFree: number;
  /** open + unlocked */
  lifetimeFree: number;
  /** True when we could not read projects — caller should fail closed */
  readFailed: boolean;
};

/**
 * Free AI beat projects from project metadata (authoritative for sequential gate).
 * A free slot is "finished" only after paid download unlock — not after Produce alone.
 */
async function countFreeBeatProjects(userId: string): Promise<FreeProjectCounts> {
  const empty: FreeProjectCounts = {
    openFree: 0,
    unlockedFree: 0,
    lifetimeFree: 0,
    readFailed: false,
  };
  const supabase = createServiceClient();
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, status, metadata")
      .eq("user_id", userId)
      .limit(400);
    if (error) {
      console.warn("[beat-quota] free projects read failed", error.message);
      return { ...empty, readFailed: true };
    }
    let openFree = 0;
    let unlockedFree = 0;
    for (const row of data || []) {
      const m = (row as { metadata?: Record<string, unknown> }).metadata || {};
      const isFree =
        m.free_beat_generation === true ||
        m.free_beat_slot === true ||
        // Legacy free gens: AI beat project not marked billable
        (m.beat_generation_billable !== true &&
          (m.beat_source === "ai" || m.has_ai_beat === true || m.generated_beat === true));
      // Prefer explicit free flags; also treat projects with a completed free job path
      const markedFree = m.free_beat_generation === true || m.free_beat_slot === true;
      if (!markedFree && !isFree) continue;
      // Only count explicitly marked free slots for hard quota (avoid false positives)
      if (!markedFree) continue;
      const unlocked = m.beat_unlock_granted === true || m.download_unlocked === true;
      if (unlocked) unlockedFree += 1;
      else openFree += 1;
    }
    return {
      openFree,
      unlockedFree,
      lifetimeFree: openFree + unlockedFree,
      readFailed: false,
    };
  } catch (e) {
    console.warn("[beat-quota] free projects exception", e);
    return { ...empty, readFailed: true };
  }
}

/** True if a beat generation job is already running for this user. */
async function hasInFlightBeatGeneration(userId: string): Promise<boolean> {
  if (!userId) return false;
  const supabase = createServiceClient();
  try {
    // Must match statuses written by lib/music-generation/service.ts
    const { count, error } = await supabase
      .from("music_generation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", [
        "CREATED",
        "SUBMITTING",
        "GENERATING",
        "DOWNLOADING",
        "PROCESSING",
      ]);
    if (error) {
      console.warn("[beat-quota] in-flight check", error.message);
      // Fail closed: block parallel spam if we cannot verify
      return true;
    }
    return (count || 0) > 0;
  } catch {
    return true;
  }
}

export async function getBeatGenQuota(userId: string): Promise<BeatQuotaSnapshot> {
  const freeBaseAllowance = FREE_BEAT_GEN_COUNT;
  const freeMaxDurationSec = FREE_MAX_DURATION_SEC;
  const costPerSecUsd = estimatedMusicCostUsdPerSec();
  // paid budget resolved after we know plan (see below)
  let paidSecondsBudget = 0;

  // Fail-open defaults if userId missing
  if (!userId) {
    return {
      allowed: true,
      isPaid: false,
      usedSuccessful: 0,
      freeBaseAllowance,
      downloadUnlocks: 0,
      freeLimit: freeBaseAllowance,
      usedSecondsThisMonth: 0,
      paidSecondsBudget,
      freeMaxDurationSec,
      remaining: freeBaseAllowance,
      costPerSecUsd,
    };
  }

  const planName = await getSubscriberPlanName(userId);
  const isPaid = planName === "creator" || planName === "pro";
  paidSecondsBudget = isPaid ? getPaidSecondsBudgetForPlan(planName) : 0;
  const usedSuccessful = await countSuccessfulGens(userId);
  const downloadUnlocks = await countDownloadUnlocks(userId);
  const usedSecondsThisMonth = await sumSuccessfulSecondsThisMonth(userId);
  // freeLimit for paid branch display; free branch recomputes with project counts
  const freeLimit = freeBaseAllowance + downloadUnlocks;

  if (isPaid) {
    const remainingSeconds = Math.max(0, paidSecondsBudget - usedSecondsThisMonth);
    const planLabel = planName === "pro" ? "Pro" : "Creator";
    return {
      allowed: remainingSeconds >= 5,
      isPaid: true,
      usedSuccessful,
      freeBaseAllowance,
      downloadUnlocks,
      freeLimit,
      usedSecondsThisMonth,
      paidSecondsBudget,
      freeMaxDurationSec,
      remaining: remainingSeconds > 0 ? Math.ceil(remainingSeconds / freeMaxDurationSec) : 0,
      remainingSeconds,
      message:
        remainingSeconds >= 5
          ? undefined
          : `You've used your ${planLabel} beat budget (${paidSecondsBudget}s/month). Limits reset next month.`,
      upgradePath: remainingSeconds >= 5 ? undefined : "plan",
      costPerSecUsd,
    };
  }

  const freeProjects = await countFreeBeatProjects(userId);
  // Jobs + projects: use the higher of successful jobs vs free project rows
  // (jobs can lag metadata; metadata is set on COMPLETED)
  const freeUsed = Math.max(usedSuccessful, freeProjects.lifetimeFree);
  // freeLimit already = freeBaseAllowance + downloadUnlocks (set above)
  const freeSlotsLeft = Math.max(0, freeBaseAllowance - freeUsed);
  const slotsLeftWithUnlocks = Math.max(0, freeLimit - freeUsed);

  // Hard sequential rule: any unfinished free beat blocks the next free gen.
  // Prefer project metadata; also use job count vs unlocks when metadata was missing on older projects.
  const sequentialBlocked =
    freeProjects.openFree > 0 ||
    (usedSuccessful > freeProjects.unlockedFree && freeProjects.unlockedFree < freeBaseAllowance);

  if (freeProjects.readFailed) {
    return {
      allowed: false,
      isPaid: false,
      usedSuccessful,
      freeBaseAllowance,
      downloadUnlocks,
      freeLimit,
      usedSecondsThisMonth,
      paidSecondsBudget,
      freeMaxDurationSec,
      remaining: 0,
      freeSlotsLeft: 0,
      sequentialBlocked: true,
      finishedFreeProjects: freeProjects.unlockedFree,
      billableGeneration: false,
      message:
        "Could not verify your free beat limit. Please try again in a moment.",
      upgradePath: "finish_download",
      costPerSecUsd,
    };
  }

  if (sequentialBlocked) {
    return {
      allowed: false,
      isPaid: false,
      usedSuccessful: freeUsed,
      freeBaseAllowance,
      downloadUnlocks,
      freeLimit,
      usedSecondsThisMonth,
      paidSecondsBudget,
      freeMaxDurationSec,
      remaining: slotsLeftWithUnlocks,
      freeSlotsLeft: slotsLeftWithUnlocks,
      sequentialBlocked: true,
      finishedFreeProjects: freeProjects.unlockedFree,
      billableGeneration: false,
      message:
        "Your next free beat unlocks after you download a produced song. Or generate a paid beat now — $1 for 2 minutes (scales with length).",
      upgradePath: "finish_download",
      costPerSecUsd,
    };
  }

  // Still have free slots and no open free beat
  if (slotsLeftWithUnlocks > 0) {
    return {
      allowed: true,
      isPaid: false,
      usedSuccessful: freeUsed,
      freeBaseAllowance,
      downloadUnlocks,
      freeLimit,
      usedSecondsThisMonth,
      paidSecondsBudget,
      freeMaxDurationSec,
      remaining: slotsLeftWithUnlocks,
      freeSlotsLeft: slotsLeftWithUnlocks,
      sequentialBlocked: false,
      finishedFreeProjects: freeProjects.unlockedFree,
      billableGeneration: false,
      costPerSecUsd,
    };
  }

  // Free allowance exhausted — do NOT auto-generate. Require explicit billable or subscription.
  return {
    allowed: false,
    isPaid: false,
    usedSuccessful: freeUsed,
    freeBaseAllowance,
    downloadUnlocks,
    freeLimit,
    usedSecondsThisMonth,
    paidSecondsBudget,
    freeMaxDurationSec,
    remaining: 0,
    freeSlotsLeft: 0,
    sequentialBlocked: false,
    finishedFreeProjects: freeProjects.unlockedFree,
    billableGeneration: true,
    message:
      "You've used your 3 free beats. Subscribe to Creator/Pro, or generate a paid beat — $1 for 2 minutes (scales with length).",
    upgradePath: "finish_download",
    costPerSecUsd,
  };
}

export async function assertBeatGenAllowed(
  userId: string,
  durationSec?: number,
  opts?: { forceBillable?: boolean }
): Promise<BeatQuotaSnapshot> {
  if (await hasInFlightBeatGeneration(userId)) {
    throw new MusicGenerationError(
      "LIMIT_EXCEEDED",
      "A beat is already generating. Wait for it to finish before starting another — one at a time.",
      {
        details: {
          code: "BEAT_GEN_IN_FLIGHT",
          canBillable: false,
          canSubscribe: false,
        },
      }
    );
  }
  const snap = await getBeatGenQuota(userId);
  const want = Math.max(5, Math.min(240, Math.round(durationSec || DEFAULT_FULL_BEAT_SEC)));
  const forceBillable = Boolean(opts?.forceBillable);

  console.info(
    "[beat-quota] check",
    JSON.stringify({
      userId: userId?.slice(0, 8),
      want,
      allowed: snap.allowed,
      isPaid: snap.isPaid,
      usedSuccessful: snap.usedSuccessful,
      freeLimit: snap.freeLimit,
      remaining: snap.remaining,
      remainingSeconds: snap.remainingSeconds,
    })
  );

  if (!snap.isPaid) {
    // Free length cap always applies unless user explicitly accepts a billable longer beat
    if (want > snap.freeMaxDurationSec && !forceBillable && !snap.billableGeneration) {
      throw new MusicGenerationError(
        "LIMIT_EXCEEDED",
        `Free beats are limited to ${snap.freeMaxDurationSec}s (${Math.round(snap.freeMaxDurationSec / 60)} min). Shorten the length or upgrade for longer beats.`,
        {
          details: {
            code: "FREE_DURATION_CAP",
            freeMaxDurationSec: snap.freeMaxDurationSec,
            requestedSec: want,
            usedSuccessful: snap.usedSuccessful,
            freeLimit: snap.freeLimit,
          },
        }
      );
    }
    // Sequential free gate: must finish current free beat (record → produce → paid download)
    // before the next free slot. forceBillable still allowed only when free slots are exhausted
    // (billableGeneration) — not to skip an unfinished free beat.
    if (snap.sequentialBlocked && !snap.isPaid && !forceBillable) {
      throw new MusicGenerationError(
        "LIMIT_EXCEEDED",
        snap.message ||
          "Your next free beat unlocks after you download a produced song. Or generate a paid beat now — price depends on length ($1 for 2 minutes).",
        {
          details: {
            code: "SEQUENTIAL_FREE_BLOCKED",
            remaining: snap.remaining,
            usedSuccessful: snap.usedSuccessful,
            freeLimit: snap.freeLimit,
            finishedFreeProjects: snap.finishedFreeProjects,
            estimatedCostUsd: estimateBeatCostUsd(want),
            canBillable: true,
            canSubscribe: true,
            durationSec: want,
          },
        }
      );
    }
    // Exhausted free OR denied — allow explicit forceBillable paid path
    if (
      !forceBillable &&
      !snap.allowed
    ) {
      throw new MusicGenerationError(
        "LIMIT_EXCEEDED",
        snap.message ||
          "Free beat limit reached. Subscribe or continue with a paid beat (cost added at download).",
        {
          details: {
            code: "FREE_COUNT_EXCEEDED",
            remaining: snap.remaining,
            usedSuccessful: snap.usedSuccessful,
            freeLimit: snap.freeLimit,
            finishedFreeProjects: snap.finishedFreeProjects,
            estimatedCostUsd: estimateBeatCostUsd(want),
            canBillable: true,
            canSubscribe: true,
          },
        }
      );
    }
    if (forceBillable) {
      return {
        ...snap,
        allowed: true,
        billableGeneration: true,
        sequentialBlocked: false,
        message:
          "This beat is billable — cost is added to your song download after you Produce.",
      };
    }
    return snap;
  }

  if (!snap.allowed || (snap.remainingSeconds ?? 0) < 5) {
    throw new MusicGenerationError("LIMIT_EXCEEDED", snap.message || "Monthly beat budget exhausted", {
      details: { code: "PAID_SECONDS_EXCEEDED", remainingSeconds: snap.remainingSeconds },
    });
  }
  if ((snap.remainingSeconds ?? 0) < want) {
    throw new MusicGenerationError(
      "LIMIT_EXCEEDED",
      `This beat needs ${want}s but you only have ${snap.remainingSeconds}s left this month. Shorten it or wait for reset.`,
      {
        details: {
          code: "PAID_SECONDS_EXCEEDED",
          remainingSeconds: snap.remainingSeconds,
          requestedSec: want,
        },
      }
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

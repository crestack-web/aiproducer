import { createServiceClient } from "@/lib/supabase/server";
import { MusicGenerationError } from "./types";
import { hasInFlightBeatGeneration } from "./in-flight-beat";
import {
  DEFAULT_FULL_BEAT_SEC,
  FREE_DURATION_OPTIONS_SEC,
  FREE_MAX_DURATION_SEC,
  MAX_BEAT_GENS_PER_SONG,
  countSuccessfulBeatGensForProject,
  estimateBeatCostUsd,
  getBeatGenQuota,
  type BeatQuotaSnapshot,
} from "./beat-quota-core";

export async function assertBeatGenAllowed(
  userId: string,
  durationSec?: number,
  opts?: { forceBillable?: boolean; projectId?: string }
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

  const projectId = opts?.projectId ? String(opts.projectId) : "";
  if (projectId) {
    const usedForSong = await countSuccessfulBeatGensForProject(projectId);
    if (usedForSong >= MAX_BEAT_GENS_PER_SONG) {
      throw new MusicGenerationError(
        "LIMIT_EXCEEDED",
        "You've used all " +
          String(MAX_BEAT_GENS_PER_SONG) +
          " beats for this song. You can upload your own beat instead.",
        {
          details: {
            code: "PER_SONG_BEAT_GEN_LIMIT",
            used: usedForSong,
            limit: MAX_BEAT_GENS_PER_SONG,
            projectId,
            upgradePath: "upload_beat",
          },
        }
      );
    }
  }

  if (!snap.isPaid) {
    const freeOpts = FREE_DURATION_OPTIONS_SEC.length
      ? FREE_DURATION_OPTIONS_SEC
      : [60, 90].filter((s) => s <= snap.freeMaxDurationSec);
    if (!forceBillable && want > snap.freeMaxDurationSec) {
      throw new MusicGenerationError(
        "LIMIT_EXCEEDED",
        `Free beats are limited to ${snap.freeMaxDurationSec}s (options: ${freeOpts.join("/ ")}s). Shorten the beat, subscribe, or continue as a paid generation.`,
        {
          details: {
            code: "FREE_DURATION_EXCEEDED",
            freeMaxDurationSec: snap.freeMaxDurationSec,
            requestedSec: want,
            estimatedCostUsd: estimateBeatCostUsd(want),
            canBillable: true,
            canSubscribe: true,
          },
        }
      );
    }
    if (!forceBillable && !snap.allowed) {
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

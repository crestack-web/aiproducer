/**
 * AP Credits catalog — package face value maps 1 credit = $0.01.
 * Song-path spend uses plan per-song economics (cheaper than $4.99 session download).
 */
import { PLANS, SESSION_PRICE_USD, type PlanId } from "@/lib/plans";

/** 1 credit ≡ $0.01 USD of package face value */
export const CREDITS_PER_USD = 100;

/** Unified song-path cost in credits (= Artist ~$2.50/song). Cheaper than session $4.99. */
export const SONG_PATH_CREDITS = 250;

/** Session cash unlock — unchanged */
export const SESSION_DOWNLOAD_USD = SESSION_PRICE_USD;

/** Credits to redeem instead of $4.99 (same entitlement as cash unlock) */
export const SESSION_DOWNLOAD_CREDITS = Math.round(SESSION_PRICE_USD * CREDITS_PER_USD); // 499

export type CreditPackageId = Extract<PlanId, "creator" | "band" | "pro">;

export type CreditPackage = {
  id: CreditPackageId;
  name: string;
  priceUsd: number;
  credits: number;
  /** Songs at SONG_PATH_CREDITS */
  estimatedSongPaths: number;
  badge?: string;
  tagline: string;
  features: string[];
};

function packageFromPlan(id: CreditPackageId): CreditPackage {
  const plan = PLANS.find((p) => p.id === id)!;
  const credits = Math.round(plan.priceUsd * CREDITS_PER_USD);
  return {
    id,
    name: plan.name,
    priceUsd: plan.priceUsd,
    credits,
    estimatedSongPaths: Math.floor(credits / SONG_PATH_CREDITS),
    badge: plan.badge,
    tagline: plan.tagline,
    features: [
      `${credits.toLocaleString()} AP Credits (never expire)`,
      `~${Math.floor(credits / SONG_PATH_CREDITS)} song paths at ${SONG_PATH_CREDITS} credits each`,
      `Song path ~$${(SONG_PATH_CREDITS / CREDITS_PER_USD).toFixed(2)} vs $${SESSION_PRICE_USD.toFixed(2)} one-time download`,
      "WAV + MP3 export when unlocked",
      "Buy once — use whenever you create",
    ],
  };
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  packageFromPlan("creator"),
  packageFromPlan("band"),
  packageFromPlan("pro"),
];

export function creditsForPackage(planId: string): number {
  const id = planId as CreditPackageId;
  const pack = CREDIT_PACKAGES.find((p) => p.id === id);
  if (pack) return pack.credits;
  const plan = PLANS.find((p) => p.id === planId);
  if (plan && plan.id !== "session") return Math.round(plan.priceUsd * CREDITS_PER_USD);
  return 0;
}

export function isCreditPackagePlan(planId: string): boolean {
  return planId === "creator" || planId === "band" || planId === "pro";
}

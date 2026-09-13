/** AP Studio commercial plans — paywall after the produce “aha” moment. */

export type PlanId = "session" | "creator" | "pro";
export type BillingInterval = "month" | "year";

export type PlanDef = {
  id: PlanId;
  name: string;
  tagline: string;
  badge?: string;
  /** One-time (session) or monthly list price in USD */
  priceUsd: number;
  /** Annual total USD when billed yearly (optional) */
  priceUsdYear?: number;
  perSongHint?: string;
  features: string[];
};

export const SESSION_PRICE_USD = 2.99;

export const PLANS: PlanDef[] = [
  {
    id: "session",
    name: "This song",
    tagline: "Unlock download for this track only",
    badge: "Quick unlock",
    priceUsd: SESSION_PRICE_USD,
    features: [
      "Download WAV + MP3 for this song",
      "Keep unlimited takes in the booth",
      "Your voice, produced by AP",
      "One-time — no subscription",
    ],
  },
  {
    id: "creator",
    name: "Creator",
    tagline: "For artists shipping every month",
    badge: "Most popular",
    priceUsd: 29,
    priceUsdYear: 290, // ~2 months free
    perSongHint: "~$3.60 / song at 8 songs",
    features: [
      "8 finished songs / month",
      "WAV + MP3 export",
      "Professional mix & master",
      "Unlimited takes per song",
      "Everything in Session",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Higher volume for EPs & catalogs",
    badge: "Best value",
    priceUsd: 79,
    priceUsdYear: 790,
    perSongHint: "~$3.20 / song at 25 songs",
    features: [
      "25 finished songs / month",
      "Everything in Creator",
      "Priority mastering queue",
      "Stem export when available",
      "Commercial use license",
    ],
  },
];

export function formatUsd(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export function planPriceLabel(
  plan: PlanDef,
  interval: BillingInterval
): { primary: string; secondary?: string } {
  if (plan.id === "session") {
    return { primary: `${formatUsd(plan.priceUsd)}`, secondary: "one-time · this song" };
  }
  if (interval === "year" && plan.priceUsdYear) {
    const perMo = plan.priceUsdYear / 12;
    return {
      primary: `${formatUsd(perMo)}/mo`,
      secondary: `Billed ${formatUsd(plan.priceUsdYear)}/year · save ~20%`,
    };
  }
  return {
    primary: `${formatUsd(plan.priceUsd)}/mo`,
    secondary: "Billed monthly",
  };
}

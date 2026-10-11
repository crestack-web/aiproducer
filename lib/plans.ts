/** AP Studio commercial plans — paywall after the produce “aha” moment. */

export type PlanId = "session" | "creator" | "band" | "pro";
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
  songsPerMonth?: number;
  perSongHint?: string;
  features: string[];
};

/** One-time unlock — subscriptions must beat this per finished song. */
export const SESSION_PRICE_USD = 4.99;

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
    name: "Artist",
    tagline: "Credit pack for independent artists — never expires",
    badge: "Most popular",
    priceUsd: 25,
    priceUsdYear: 250, // ~2 months free
    songsPerMonth: 10,
    perSongHint: "~$2.50 / song",
    features: [
      "2,500 AP Credits (never expire)",
      "~10 song paths at 250 credits (~$2.50 vs $4.99 download)",
      "One-time purchase — buy again only when you need more",
      "WAV + MP3 export when unlocked",
      "Professional mix & master",
      "Unlimited takes per song",
    ],
  },
  {
    id: "band",
    name: "Band",
    tagline: "Credit pack for EPs and multiple releases — never expires",
    badge: "Best value",
    priceUsd: 59,
    priceUsdYear: 590,
    songsPerMonth: 25,
    perSongHint: "~$2.36 / song",
    features: [
      "5,900 AP Credits (never expire)",
      "~23 song paths at 250 credits (better than $4.99 each)",
      "One-time purchase — credits roll until you use them",
      "Everything in Artist pack",
      "Priority mastering queue",
      "Stem export when available",
      "Commercial use license",
    ],
  },
  {
    id: "pro",
    name: "Record Label",
    tagline: "Credit pack for labels and high volume — never expires",
    badge: "Studio scale",
    priceUsd: 129,
    priceUsdYear: 1290,
    songsPerMonth: 50,
    perSongHint: "~$2.58 / song",
    features: [
      "12,900 AP Credits (never expire)",
      "~51 song paths at 250 credits (far below $4.99 each)",
      "One-time purchase — no monthly burn of unused capacity",
      "Everything in Band pack",
      "Priority mastering queue",
      "Stem export when available",
      "Commercial use license",
      "Multi-artist friendly workflow",
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
    const songs = plan.songsPerMonth || 1;
    const perSong = perMo / songs;
    return {
      primary: `${formatUsd(plan.priceUsdYear!)}`,
      secondary: `annual pack · ~${formatUsd(perSong)}/song path · credits never expire`,
    };
  }
  const songs = plan.songsPerMonth || 1;
  const perSong = plan.priceUsd / songs;
  return {
    primary: `${formatUsd(plan.priceUsd)}`,
    secondary: `one-time · ${Math.round(plan.priceUsd * 100).toLocaleString()} credits · ~${formatUsd(perSong)}/song path`,
  };
}

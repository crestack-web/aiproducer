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
    tagline: "For solo artists shipping songs every month",
    badge: "Most popular",
    priceUsd: 25,
    priceUsdYear: 250, // ~2 months free
    songsPerMonth: 10,
    perSongHint: "~$2.50 / song",
    features: [
      "10 finished songs / month",
      "About $2.50 per song (vs $4.99 one-time)",
      "~30 min AP beat generation / month (10 × 3 min)",
      "WAV + MP3 export",
      "Professional mix & master",
      "Unlimited takes per song",
    ],
  },
  {
    id: "band",
    name: "Band",
    tagline: "For groups shipping more music together",
    badge: "Best value",
    priceUsd: 59,
    priceUsdYear: 590,
    songsPerMonth: 25,
    perSongHint: "~$2.36 / song",
    features: [
      "25 finished songs / month",
      "About $2.36 per song (vs $4.99 one-time)",
      "~75 min AP beat generation / month (25 × 3 min)",
      "Everything in Artist",
      "Priority mastering queue",
      "Stem export when available",
      "Commercial use license",
    ],
  },
  {
    id: "pro",
    name: "Record Label",
    tagline: "For labels and high-volume catalogs",
    badge: "Studio scale",
    priceUsd: 129,
    priceUsdYear: 1290,
    songsPerMonth: 50,
    perSongHint: "~$2.58 / song",
    features: [
      "50 finished songs / month",
      "About $2.58 per song (vs $4.99 one-time)",
      "~150 min AP beat generation / month (50 × 3 min)",
      "Everything in Band",
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
      primary: `${formatUsd(perMo)}/mo`,
      secondary: `Billed ${formatUsd(plan.priceUsdYear)}/year · ~${formatUsd(perSong)}/song`,
    };
  }
  const songs = plan.songsPerMonth || 1;
  const perSong = plan.priceUsd / songs;
  return {
    primary: `${formatUsd(plan.priceUsd)}/mo`,
    secondary: `~${formatUsd(perSong)}/song · billed monthly`,
  };
}

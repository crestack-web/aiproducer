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
  songsPerMonth?: number;
  perSongHint?: string;
  features: string[];
};

/** One-time unlock — subscriptions must beat this per finished song. */
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
    tagline: "Lower cost per song when you ship monthly",
    badge: "Most popular",
    priceUsd: 19,
    priceUsdYear: 190, // ~2 months free
    songsPerMonth: 10,
    // $19 / 10 = $1.90 — under $2.99 session
    perSongHint: "~$1.90 / song",
    features: [
      "10 finished songs / month",
      "About $1.90 per song (vs $2.99 one-time)",
      "WAV + MP3 export",
      "Professional mix & master",
      "Unlimited takes per song",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Best per-song rate for EPs & catalogs",
    badge: "Best value",
    priceUsd: 49,
    priceUsdYear: 490,
    songsPerMonth: 30,
    // $49 / 30 ≈ $1.63
    perSongHint: "~$1.63 / song",
    features: [
      "30 finished songs / month",
      "About $1.63 per song (vs $2.99 one-time)",
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

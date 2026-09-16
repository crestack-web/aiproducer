/**
 * Production Direction — user musical intent for the next Produce render.
 * Monitor Console FX are independent; this only feeds the offline producer brain.
 */

export type ProductionDirection = {
  vocal?: {
    leadPresence?: number; // -1..1 relative bias
    intimacy?: number;
    brightness?: number;
    warmth?: number;
    density?: number;
    aggression?: number;
  };
  layers?: {
    doubles?: number;
    harmonies?: number;
    adlibs?: number;
    backgrounds?: number;
  };
  space?: {
    dryness?: number;
    width?: number;
    ambience?: number;
    delay?: number;
    reverb?: number;
  };
  arrangement?: {
    verseEnergy?: number;
    chorusEnergy?: number;
    bridgeEnergy?: number;
    introAtmosphere?: number;
    outroAtmosphere?: number;
  };
  beatIntegration?: {
    vocalForwardness?: number;
    beatRespect?: number;
    masking?: number;
    ducking?: number;
  };
  dynamics?: {
    vocalDynamics?: number;
    punch?: number;
    softness?: number;
  };
  character?: {
    intimate?: number;
    polished?: number;
    raw?: number;
    atmospheric?: number;
    energetic?: number;
  };
  /** Section keys e.g. verse, chorus — relative energy/width/space */
  sections?: Record<
    string,
    { energy?: number; width?: number; space?: number; intimacy?: number }
  >;
  /** Role keys: lead, double, harmony, adlib, background */
  roles?: Record<string, { presence?: number; width?: number; space?: number }>;
  references?: {
    genre?: string;
    mood?: string;
  };
  scope?: {
    sections?: string[];
    roles?: string[];
  };
  confidence?: number;
  sourcePrompt?: string;
  /** Last producer-speak confirmation */
  plainSummary?: string;
  updatedAt?: string;
};

export const EMPTY_DIRECTION: ProductionDirection = {
  confidence: 0,
};

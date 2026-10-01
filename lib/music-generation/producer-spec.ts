/**
 * Producer Brain → structured music specification for external generators.
 * Converts artist direction into an instrumental-ready prompt (vocal pockets, groove, arrangement).
 * Does not call any provider — pure text shaping for Mureka / ElevenLabs / etc.
 */

export type ProducerMusicSpec = {
  genre?: string | null;
  mood?: string | null;
  bpm?: number | null;
  key?: string | null;
  energy?: string | null;
  instrumentation?: string | null;
  structure?: string | null;
  artistDirection?: string | null;
  /** Extra constraints from Producer Brain analysis */
  vocalSpace?: boolean;
  commercial?: boolean;
};

/**
 * Build a Mureka-style instrumental prompt (max ~1024 chars).
 * Biased toward artist-ready instrumentals, not cinematic BGM.
 */
export function buildInstrumentalPrompt(spec: ProducerMusicSpec): string {
  const parts: string[] = [];

  const genre = (spec.genre || "").trim() || "modern pop / R&B";
  const mood = (spec.mood || "").trim();
  const bpm = typeof spec.bpm === "number" && spec.bpm > 0 ? Math.round(spec.bpm) : null;
  const key = (spec.key || "").trim();
  const energy = (spec.energy || "").trim();
  const instruments = (spec.instrumentation || "").trim();
  const structure = (spec.structure || "").trim();
  const direction = (spec.artistDirection || "").trim();

  parts.push(`Artist-ready commercial instrumental for a vocalist to record over.`);
  parts.push(`Genre: ${genre}.`);
  if (mood) parts.push(`Mood: ${mood}.`);
  if (bpm) parts.push(`Tempo: ${bpm} BPM, steady groove, clear downbeats.`);
  if (key) parts.push(`Key: ${key}.`);
  if (energy) parts.push(`Energy: ${energy}.`);

  parts.push(
    `Arrangement: verse/chorus contrast, strong drums and bass, controlled melodic density, leave midrange space for lead vocal, avoid competing lead melodies and dense cinematic strings.`
  );
  if (instruments) parts.push(`Instrumentation focus: ${instruments}.`);
  if (structure) parts.push(`Structure: ${structure}.`);
  if (direction) parts.push(`Artist direction: ${direction}`);
  parts.push(
    `Vocal pockets: keep space for phrasing and breaths; professional radio-ready mix balance without vocals.`
  );

  let out = parts.join(" ").replace(/\s+/g, " ").trim();
  if (out.length > 1000) out = out.slice(0, 997) + "...";
  return out;
}

/**
 * Prompt for generating a complementary instrument layer on top of an existing beat/vocal idea.
 */
export function buildAddInstrumentPrompt(
  instrument: string,
  spec: ProducerMusicSpec
): string {
  const inst = instrument.trim() || "guitar";
  const base = buildInstrumentalPrompt({
    ...spec,
    instrumentation: inst,
    artistDirection: [
      spec.artistDirection,
      `Add a complementary ${inst} part only — leave room for existing vocals and drums.`,
    ]
      .filter(Boolean)
      .join(" "),
  });
  return base;
}

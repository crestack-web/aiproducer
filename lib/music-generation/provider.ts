import type {
  MusicGenerationRequest,
  MusicProviderName,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";

export interface MusicGenerationProvider {
  readonly name: MusicProviderName;
  checkAvailability?(): Promise<void>;
  submitPrediction(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderSubmitResult>;
  pollPrediction(providerPredictionId: string): Promise<ProviderPollResult>;
  downloadOutput(outputUrl: string): Promise<{ buffer: Buffer; contentType: string; extension: string }>;
  generate?(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderGenerateResult>;
  maxDurationSec(kind: "preview" | "full"): number;
}

/** True when the free-text prompt is too vague to generate without more controls. */
export function isVagueBeatPrompt(prompt?: string | null): boolean {
  const p = (prompt || "").trim().toLowerCase();
  if (!p) return true;
  if (p.length < 12) return true;
  const vague = /^(make|create|give|generate|need|want)\s+(me\s+)?(a\s+)?(beat|track|instrumental|song)s?\.?$/i;
  if (vague.test(p)) return true;
  if (/^(beat|instrumental|music|track)$/i.test(p)) return true;
  return false;
}

/** Genre-aware arrangement hints so controls reinforce each other. */
function arrangementHint(genre: string, energy: string): string {
  const g = genre.toLowerCase();
  const e = energy.toLowerCase();
  if (/amapiano|afrobeats|afro/.test(g)) {
    return e.includes("intimate") || e.includes("laid")
      ? "log-drum or soft percussion pocket, warm bass, airy pads, leave room for melodic vocal phrasing"
      : "groovy percussion, rolling bass, bright melodic stabs, danceable but vocal-ready midrange";
  }
  if (/trap|drill|hip/.test(g)) {
    return e.includes("intimate") || e.includes("laid")
      ? "sparse 808s, soft hi-hats, dark pads, space for melodic or spoken delivery"
      : "hard-hitting drums, tuned 808s, crisp hats, assertive but not crowded midrange";
  }
  if (/gospel|worship|soul/.test(g)) {
    return "warm keys, supportive pads, steady pocket, lift into fuller sections without masking vocals";
  }
  if (/r&b|rnb|neo/.test(g)) {
    return "smooth drums, melodic bass, lush chords, intimate pocket for lead vocal";
  }
  if (/highlife|afrobeat(?!s)/.test(g) || g === "highlife") {
    return "live-feeling rhythm section, melodic guitars or horns textures, open space for lead voice";
  }
  if (/edm|dance|house|techno/.test(g)) {
    return "four-on-the-floor or driving pulse, filtered builds, drop energy, keep midrange open for topline";
  }
  if (/lo-fi|lofi|chill/.test(g)) {
    return "dusty drums, soft keys, gentle bass, relaxed pocket for conversational vocals";
  }
  if (/rock|indie|alt/.test(g)) {
    return "live drums feel, guitar or bass foundation, dynamic sections, room for sung topline";
  }
  if (/reggaeton|dancehall|latin/.test(g)) {
    return "dembow or dancehall groove, punchy low end, percussive sparkle, vocal-forward mix space";
  }
  if (/jazz|fusion/.test(g)) {
    return "organic pocket, harmonic color, light swing or straight groove, space for melodic vocal";
  }
  if (/country|folk|acoustic/.test(g)) {
    return "acoustic foundation, organic drums or percussion, warm low end, natural vocal air";
  }
  return "clear groove, supportive harmony, professional arrangement with vocal midrange space";
}

function energyLanguage(energy: string): string {
  const e = energy.toLowerCase();
  if (e.includes("intimate")) return "intimate and close — restrained dynamics, soft attacks";
  if (e.includes("laid")) return "laid-back pocket — unhurried groove, gentle push";
  if (e.includes("driving")) return "driving momentum — steady forward motion, locked rhythm section";
  if (e.includes("explosive")) return "explosive peaks — bigger drums and wider sections while protecting vocal space";
  if (e.includes("dreamy")) return "dreamy and floating — soft edges, ambient wash, gentle pulse";
  if (e.includes("aggressive")) return "aggressive intensity — punchy transients, assertive low end";
  if (e.includes("uplifting")) return "uplifting lift — brighter harmonics, rising energy into the hook";
  if (e.includes("melanchol")) return "melancholic weight — minor color, slower emotional arc";
  return energy ? `energy character: ${energy}` : "";
}

/**
 * Build a specific instrumental prompt that weaves genre, mood, energy,
 * instrumentation, BPM, and style reference into one coherent brief.
 */
export function buildInstrumentalPrompt(input: {
  prompt?: string;
  genre?: string;
  mood?: string;
  bpm?: number;
  key?: string;
  energy?: string;
  structure?: string;
  instrumentation?: string;
  referenceStyle?: string;
}): string {
  const genre = (input.genre || "").trim();
  const mood = (input.mood || "").trim();
  const energy = (input.energy || "").trim();
  const instrumentation = (input.instrumentation || "").trim();
  const referenceStyle = (input.referenceStyle || "").trim();
  const bpm = input.bpm && input.bpm > 0 ? input.bpm : undefined;
  const key = (input.key || "").trim();
  const structure =
    (input.structure || "").trim() ||
    "short intro, verse with space for vocals, fuller chorus, brief bridge or turnaround, outro";

  const parts: string[] = [];

  // Creative core from artist text when specific
  if (input.prompt?.trim() && !isVagueBeatPrompt(input.prompt)) {
    parts.push(input.prompt.trim());
  }

  // Coherent production sentence
  const head: string[] = [];
  if (genre) head.push(`${genre}`);
  if (mood) head.push(`${mood} mood`);
  if (energy) head.push(energyLanguage(energy) || energy);
  if (head.length) {
    parts.push(
      `Create an instrumental ${genre || "contemporary"} production with ${mood || "expressive"} mood` +
        (energy ? `, ${energyLanguage(energy)}` : "")
    );
  } else {
    parts.push("Create a contemporary instrumental production");
  }

  if (bpm) parts.push(`Tempo locked around ${bpm} BPM`);
  if (key) parts.push(`Harmonic center / key feel: ${key}`);

  if (instrumentation) {
    parts.push(`Lead the arrangement with ${instrumentation} as the primary sonic identity`);
  } else {
    parts.push("Use drums, bass, harmony instruments, and atmospheric textures");
  }

  if (genre || energy) {
    parts.push(arrangementHint(genre, energy));
  }

  if (referenceStyle) {
    parts.push(
      `Evoke the feel and production sensibility of ${referenceStyle} — inspired by, not a copy, not a cover, original composition`
    );
  }

  parts.push(structure);
  parts.push("Leave a clear, spacious midrange so a lead vocal can sit on top");
  parts.push("Professional, radio-ready instrumental mix");
  parts.push("Instrumental only. No vocals. No lyrics. No singing. No spoken words.");

  return parts.filter(Boolean).join(". ");
}

/**
 * Mistral as reasoning layer only — never measures audio.
 * Receives structured AudioAnalysis + production coverage state.
 */

import { mistralChat, isMistralConfigured } from "@/lib/providers/mistral";
import type { AudioAnalysis, ProducerRecommendation, ProducerAction } from "@/lib/audio/analysis-types";

export type SectionCoverage = {
  sectionLabel: string;
  sectionType?: string | null;
  startBar?: number | null;
  endBar?: number | null;
  startMs?: number | null;
  endMs?: number | null;
  roles: { role: string; status: "available" | "missing"; taskId?: string | null }[];
};

export type CoachInput = {
  genre?: string | null;
  mood?: string | null;
  analysis: AudioAnalysis;
  sectionLabel?: string | null;
  productionState: SectionCoverage[];
};

const SYSTEM = `You are the AI music producer inside Studio.
You receive STRUCTURED measurements from an audio-analysis engine. You do NOT listen to audio and you must NOT invent measurements.

Your job: recommend the next production action for a singer/rapper.

Rules:
- Never judge the artist's talent or "quality as a singer".
- Never mention DAW terms (EQ, compression, stems, buses, panning).
- Use only the evidence provided (duration match, silence, clipping, coverage of roles).
- Prefer constructive, specific next steps tied to a section when possible.
- Do not ask for unnecessary layers once a section is already covered.
- Return valid JSON only.

Allowed actions:
KEEP, RETAKE, TRIM, ADD_DOUBLE, ADD_HARMONY, ADD_BACKGROUND, ADD_ADLIB, NEEDS_REVIEW`;

const ACTIONS = new Set<ProducerAction>([
  "KEEP",
  "RETAKE",
  "TRIM",
  "ADD_DOUBLE",
  "ADD_HARMONY",
  "ADD_BACKGROUND",
  "ADD_ADLIB",
  "NEEDS_REVIEW",
]);

function heuristicCoach(input: CoachInput): ProducerRecommendation {
  const a = input.analysis;
  const expected = a.timeline.expectedDurationMs;
  const actual = a.timeline.actualDurationMs ?? a.durationMs;

  if (a.quality.clippingDetected === true) {
    return {
      action: "RETAKE",
      message: "This take is clipping. Record again a bit farther from the mic or softer.",
      confidence: 0.8,
    };
  }

  if (
    a.quality.leadingSilenceMs != null &&
    a.quality.leadingSilenceMs > 1200
  ) {
    return {
      action: "TRIM",
      message: "There's a long silence before the vocal. Trim the start, then we can keep moving.",
      confidence: 0.7,
    };
  }

  if (expected != null && actual != null && expected > 0) {
    const delta = actual - expected;
    const rel = Math.abs(delta) / expected;
    if (rel > 0.25 || Math.abs(delta) > 2500) {
      return {
        action: "NEEDS_REVIEW",
        message: `This take is ${delta < 0 ? "shorter" : "longer"} than the section window. Review or retake so it lines up with the beat.`,
        confidence: 0.65,
      };
    }
  }

  // Coverage: suggest missing double/harmony on same section if lead is present
  const label = (input.sectionLabel || "").toUpperCase();
  const section =
    input.productionState.find((s) => s.sectionLabel.toUpperCase() === label) ||
    input.productionState.find((s) =>
      s.roles.some((r) => r.role === "LEAD" && r.status === "available")
    );

  if (section) {
    const missingDouble = section.roles.find((r) => r.role === "DOUBLE" && r.status === "missing");
    const missingHarm = section.roles.find(
      (r) => (r.role === "HARMONY" || r.role === "HARMONY_HIGH") && r.status === "missing"
    );
    if (missingDouble) {
      return {
        action: "ADD_DOUBLE",
        message: `Keep this take. Next, add a double on ${section.sectionLabel} — same melody, tight with the beat.`,
        targetSectionLabel: section.sectionLabel,
        targetRole: "DOUBLE",
        confidence: 0.6,
      };
    }
    if (missingHarm) {
      return {
        action: "ADD_HARMONY",
        message: `Solid. A harmony on ${section.sectionLabel} would thicken this part if you want more color.`,
        targetSectionLabel: section.sectionLabel,
        targetRole: "HARMONY",
        confidence: 0.55,
      };
    }
  }

  return {
    action: "KEEP",
    message: "Take saved. You're good to move to the next open part.",
    confidence: 0.5,
  };
}

export async function recommendNextAction(input: CoachInput): Promise<ProducerRecommendation> {
  const fallback = heuristicCoach(input);
  if (!isMistralConfigured()) return fallback;

  try {
    const raw = await mistralChat(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Genre: ${input.genre || "unknown"}
Mood: ${input.mood || "unknown"}
Current section: ${input.sectionLabel || "unknown"}

AudioAnalysis (measurements only):
${JSON.stringify(input.analysis)}

Production coverage by section:
${JSON.stringify(input.productionState)}

Return JSON:
{ "action": "KEEP|RETAKE|TRIM|ADD_DOUBLE|ADD_HARMONY|ADD_BACKGROUND|ADD_ADLIB|NEEDS_REVIEW", "message": string, "targetSectionLabel": string|null, "targetRole": string|null, "confidence": number }`,
        },
      ],
      { temperature: 0.25, maxTokens: 500, responseFormat: "json_object" }
    );

    const text = raw.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const json = JSON.parse(text.slice(start, end + 1)) as ProducerRecommendation;
    if (!json.action || !ACTIONS.has(json.action as ProducerAction) || !json.message) {
      return fallback;
    }
    return {
      action: json.action as ProducerAction,
      message: String(json.message).slice(0, 400),
      targetSectionLabel: json.targetSectionLabel ?? null,
      targetRole: json.targetRole ?? null,
      confidence: typeof json.confidence === "number" ? json.confidence : null,
    };
  } catch {
    return fallback;
  }
}

/** Build coverage map from recording tasks + selected recordings. */
export function buildProductionState(
  tasks: {
    id: string;
    type: string;
    status: string;
    metadata?: Record<string, unknown> | null;
    start_ms?: number | null;
    end_ms?: number | null;
  }[],
  selectedByTask: Set<string>
): SectionCoverage[] {
  const byLabel = new Map<string, SectionCoverage>();

  for (const t of tasks) {
    const meta = (t.metadata || {}) as Record<string, unknown>;
    const label = String(meta.section_label || t.type || "SECTION");
    const role = String(meta.production_type || t.type || "LEAD").toUpperCase();
    if (!byLabel.has(label)) {
      byLabel.set(label, {
        sectionLabel: label,
        sectionType: (meta.section_type as string) || null,
        startBar: typeof meta.start_bar === "number" ? meta.start_bar : null,
        endBar: typeof meta.end_bar === "number" ? meta.end_bar : null,
        startMs: t.start_ms ?? null,
        endMs: t.end_ms ?? null,
        roles: [],
      });
    }
    const sec = byLabel.get(label)!;
    const done = t.status === "completed" || selectedByTask.has(t.id);
    sec.roles.push({
      role,
      status: done ? "available" : "missing",
      taskId: t.id,
    });
  }

  return Array.from(byLabel.values());
}

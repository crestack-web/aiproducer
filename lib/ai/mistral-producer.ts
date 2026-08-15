/**
 * AI Producer layer powered by Mistral.
 * Takes a deterministic ProductionBlueprint and rewrites instructions
 * in warm, plain-language producer voice — never exposes DAW jargon.
 */

import { mistralChat, isMistralConfigured } from "@/lib/providers/mistral";
import type { ProductionBlueprint, ProductionTask, PlannerInput } from "@/lib/production-planner";

const SYSTEM = `You are the AI music producer inside Studio.
Your job: rewrite recording instructions so a beginner singer/rapper understands exactly what to perform.
Rules:
- Never mention tracks, stems, EQ, compression, buses, panning, or DAW terms.
- Speak like a supportive producer in the room: short, warm, specific.
- Keep each instruction to 1–2 sentences.
- Preserve task types and order; only improve title, instruction, and reason.
- Match genre and mood when given.
- Return valid JSON only.`;

/**
 * Enhance a planned blueprint with Mistral. Falls back to original on any failure.
 */
export async function enhanceBlueprintWithMistral(
  plan: ProductionBlueprint,
  input: PlannerInput
): Promise<ProductionBlueprint> {
  if (!isMistralConfigured()) return plan;
  if (!plan.tasks.length) return plan;

  const payload = {
    genre: input.genre || "R&B",
    mood: input.mood || "Emotional",
    tasks: plan.tasks.map((t) => ({
      type: t.type,
      title: t.title,
      instruction: t.instruction,
      reason: t.reason,
      section_label: t.section_label,
      section_type: t.section_type,
      required: t.required,
      priority: t.priority,
      section_order: t.section_order,
      start_ms: t.start_ms,
      end_ms: t.end_ms,
    })),
  };

  try {
    const raw = await mistralChat(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Rewrite these producer recording tasks for a ${payload.genre} song, mood: ${payload.mood}.
Return JSON: { "tasks": [ { "section_order": number, "type": string, "title": string, "instruction": string, "reason": string } ], "notes": string[] }

Input tasks:
${JSON.stringify(payload.tasks)}`,
        },
      ],
      {
        temperature: 0.35,
        maxTokens: 2500,
        responseFormat: "json_object",
      }
    );

    const parsed = JSON.parse(extractJson(raw)) as {
      tasks?: {
        section_order?: number;
        type?: string;
        title?: string;
        instruction?: string;
        reason?: string;
      }[];
      notes?: string[];
    };

    if (!parsed.tasks?.length) return plan;

    const byKey = new Map<string, (typeof parsed.tasks)[0]>();
    for (const t of parsed.tasks) {
      if (t.section_order == null || !t.type) continue;
      byKey.set(`${t.section_order}:${t.type}`, t);
    }

    const tasks: ProductionTask[] = plan.tasks.map((orig) => {
      const hit = byKey.get(`${orig.section_order}:${orig.type}`);
      if (!hit) return orig;
      return {
        ...orig,
        title: (hit.title || orig.title).slice(0, 80),
        instruction: (hit.instruction || orig.instruction).slice(0, 280),
        reason: (hit.reason || orig.reason).slice(0, 200),
        metadata: {
          ...orig.metadata,
          llm: "mistral",
          model: process.env.MISTRAL_MODEL || "mistral-small-latest",
        },
      };
    });

    return {
      energy_curve: plan.energy_curve,
      tasks,
      notes: [
        ...(parsed.notes || []).slice(0, 6),
        ...plan.notes,
        "Instructions refined by Mistral AI Producer.",
      ].slice(0, 12),
    };
  } catch (e) {
    console.error("mistral enhanceBlueprint failed", e instanceof Error ? e.message : e);
    return plan;
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export { isMistralConfigured };

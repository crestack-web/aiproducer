/**
 * Apply ProductionDirection onto existing LayerDecision numbers.
 * Does not invent layers — only scales what the producer brain already decided.
 */
import type { LayerDecision } from "../production/decision-engine";
import type { ProductionDirection } from "./types";
import type { VocalRole, SongSectionKind } from "../roles";

function roleKey(role: VocalRole): string {
  if (role === "lead") return "lead";
  if (role === "double") return "double";
  if (role.startsWith("harmony")) return "harmony";
  if (role === "adlib") return "adlib";
  if (role === "background") return "background";
  return role;
}

function sectionKey(section: SongSectionKind): string {
  if (section === "pre_chorus") return "pre_chorus";
  return section;
}

function scale(base: number, bias: number | undefined, amount: number): number {
  if (bias == null || bias === 0) return base;
  // confidence softens dramatic moves
  return base + bias * amount;
}

/**
 * Mutate a layer decision in place with direction biases (safe ranges).
 */
export function applyDirectionToLayerDecision(
  decision: LayerDecision,
  direction: ProductionDirection | null | undefined,
  confidenceScale = 1
): LayerDecision {
  if (!direction) return decision;
  const c = Math.max(0.25, Math.min(1, (direction.confidence ?? 0.6) * confidenceScale));
  const role = roleKey(decision.role);
  const section = sectionKey(decision.section);
  const v = decision.vocal;
  const notes = [...decision.notes];

  // Vocal presence (lead bias)
  const leadP = direction.vocal?.leadPresence;
  if (role === "lead" && leadP != null) {
    v.gainDb = scale(v.gainDb, leadP, 2.2 * c);
    notes.push(`dir:leadPresence:${leadP.toFixed(2)}`);
  }

  // Layer presence by role
  const roleDir = direction.roles?.[role];
  const layerBias =
    role === "double"
      ? direction.layers?.doubles
      : role === "harmony"
        ? direction.layers?.harmonies
        : role === "adlib"
          ? direction.layers?.adlibs
          : role === "background"
            ? direction.layers?.backgrounds
            : undefined;

  const presence = roleDir?.presence ?? layerBias;
  if (presence != null && role !== "lead") {
    v.gainDb = scale(v.gainDb, presence, 2.5 * c);
    notes.push(`dir:rolePresence:${presence.toFixed(2)}`);
  }

  // Space / sends
  const spaceR = direction.space?.reverb;
  const spaceD = direction.space?.delay;
  const spaceA = direction.space?.ambience;
  const dry = direction.space?.dryness;
  let reverbMul = 1;
  let delayMul = 1;
  if (spaceR != null) reverbMul += spaceR * 0.55 * c;
  if (spaceA != null) reverbMul += spaceA * 0.35 * c;
  if (dry != null) reverbMul -= dry * 0.5 * c;
  if (spaceD != null) delayMul += spaceD * 0.5 * c;
  if (roleDir?.space != null) {
    reverbMul += roleDir.space * 0.4 * c;
    delayMul += roleDir.space * 0.25 * c;
  }

  // Section energy/space
  const sec = direction.sections?.[section] || direction.sections?.[section.replace("_", "")];
  if (sec?.energy != null) {
    v.gainDb = scale(v.gainDb, sec.energy, 1.6 * c);
  }
  if (sec?.space != null) {
    reverbMul += sec.space * 0.45 * c;
  }
  if (sec?.intimacy != null && role === "lead") {
    reverbMul -= sec.intimacy * 0.35 * c;
    v.gainDb = scale(v.gainDb, sec.intimacy, 0.6 * c);
  }

  // Arrangement shortcuts
  if (section === "chorus" && direction.arrangement?.chorusEnergy != null) {
    v.gainDb = scale(v.gainDb, direction.arrangement.chorusEnergy, 1.4 * c);
  }
  if (section === "verse" && direction.arrangement?.verseEnergy != null) {
    v.gainDb = scale(v.gainDb, direction.arrangement.verseEnergy, 1.2 * c);
  }

  // Width
  let width = decision.width;
  if (direction.space?.width != null && roleDir?.width == null) {
    width = Math.max(0.05, Math.min(0.92, width + direction.space.width * 0.28 * c));
  }
  if (roleDir?.width != null) {
    width = Math.max(0.05, Math.min(0.92, width + roleDir.width * 0.35 * c));
  }
  if (sec?.width != null) {
    width = Math.max(0.05, Math.min(0.92, width + sec.width * 0.3 * c));
  }

  // Character
  if (direction.character?.intimate && role === "lead") {
    reverbMul *= 1 - 0.2 * direction.character.intimate * c;
    width = Math.max(0.08, width - 0.12 * direction.character.intimate * c);
  }
  if (direction.character?.atmospheric) {
    reverbMul += 0.25 * direction.character.atmospheric * c;
  }
  if (direction.vocal?.intimacy && role === "lead") {
    reverbMul *= 1 - 0.25 * direction.vocal.intimacy * c;
  }
  if (direction.vocal?.brightness != null) {
    // slight high shelf via saturation proxy not ideal — leave EQ notes
    notes.push(`dir:brightness:${direction.vocal.brightness}`);
  }

  // Beat integration → lead gain / duck note
  if (role === "lead" && direction.beatIntegration?.vocalForwardness != null) {
    v.gainDb = scale(
      v.gainDb,
      direction.beatIntegration.vocalForwardness,
      1.8 * c
    );
  }

  // Safety clamps (match decision-engine spirit)
  v.gainDb = Math.max(-12, Math.min(14, v.gainDb));
  v.reverbSend = Math.max(0.04, Math.min(0.48, v.reverbSend * reverbMul));
  v.delaySend = Math.max(0.02, Math.min(0.32, v.delaySend * delayMul));
  width = Math.max(0.05, Math.min(0.9, width));

  return {
    ...decision,
    width,
    notes,
    vocal: v,
  };
}

/** Mix-level biases from direction */
export function applyDirectionToMixGains(
  vocalGainDb: number,
  beatGainDb: number,
  direction: ProductionDirection | null | undefined
): { vocalGainDb: number; beatGainDb: number } {
  if (!direction?.beatIntegration) return { vocalGainDb, beatGainDb };
  const c = Math.max(0.25, Math.min(1, direction.confidence ?? 0.6));
  const vf = direction.beatIntegration.vocalForwardness ?? 0;
  const br = direction.beatIntegration.beatRespect ?? 0;
  return {
    vocalGainDb: Math.max(-6, Math.min(8, vocalGainDb + vf * 1.5 * c)),
    beatGainDb: Math.max(-6, Math.min(3, beatGainDb - br * 0.8 * c + (direction.beatIntegration.ducking ?? 0) * -0.4 * c)),
  };
}

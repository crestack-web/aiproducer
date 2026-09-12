import type { SongSectionKind } from "../roles";
import type { SectionDecision, SongRead } from "./types";

export function readSectionLevel(
  song: SongRead,
  sections: Array<{ section: SongSectionKind; startMs: number; endMs: number; id?: string }>
): SectionDecision[] {
  return sections.map((s, i) => {
    let density: SectionDecision["density"] = "hold";
    let vocalFaderRideDb = 0;
    let reverbSendScale = 1;
    const rationale: string[] = [];

    if (s.section === "verse") {
      density = "hold";
      vocalFaderRideDb = -0.4 * (1 - song.restraintVsPolish);
      reverbSendScale = 0.85;
      rationale.push("verse_hold_back");
    } else if (s.section === "pre_chorus") {
      density = "build";
      vocalFaderRideDb = 0.25;
      reverbSendScale = 1.05;
      rationale.push("pre_chorus_build");
    } else if (s.section === "chorus") {
      density = "push";
      vocalFaderRideDb = 0.55 + song.restraintVsPolish * 0.25;
      reverbSendScale = 1.15;
      rationale.push("chorus_push");
    } else if (s.section === "bridge") {
      density = "hold";
      vocalFaderRideDb = -0.2;
      reverbSendScale = 1.2;
      rationale.push("bridge_space");
    } else if (s.section === "outro") {
      density = "release";
      vocalFaderRideDb = -0.5;
      reverbSendScale = 1.3;
      rationale.push("outro_release");
    } else if (s.section === "intro") {
      density = "hold";
      vocalFaderRideDb = -0.6;
      reverbSendScale = 1.15;
      rationale.push("intro_atmosphere");
    }

    return {
      sectionId: s.id || `${s.section}_${i}`,
      section: s.section,
      timeRangeMs: [s.startMs, s.endMs] as [number, number],
      density,
      vocalFaderRideDb,
      reverbSendScale,
      rationale: rationale.join(","),
    };
  });
}

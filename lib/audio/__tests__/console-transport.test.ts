import { describe, expect, it } from "vitest";
import {
  isTrackAudible,
  getCaptureLatencyCompMs,
  type MixerSnapshot,
} from "../console-transport";

describe("isTrackAudible", () => {
  it("mutes win", () => {
    const mixer: MixerSnapshot = {
      muted: new Set(["a"]),
      soloed: new Set(),
      gainDb: new Map(),
    };
    expect(isTrackAudible("a", mixer)).toBe(false);
    expect(isTrackAudible("b", mixer)).toBe(true);
  });

  it("supports multi-solo", () => {
    const mixer: MixerSnapshot = {
      muted: new Set(),
      soloed: new Set(["lead", "harmony"]),
      gainDb: new Map(),
    };
    expect(isTrackAudible("lead", mixer)).toBe(true);
    expect(isTrackAudible("harmony", mixer)).toBe(true);
    expect(isTrackAudible("beat", mixer)).toBe(false);
  });

  it("empty solo means all unmuted audible", () => {
    const mixer: MixerSnapshot = {
      muted: new Set(["x"]),
      soloed: new Set(),
      gainDb: new Map(),
    };
    expect(isTrackAudible("y", mixer)).toBe(true);
  });
});

describe("getCaptureLatencyCompMs", () => {
  it("returns a non-negative compensation within a sane range", () => {
    const ms = getCaptureLatencyCompMs();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThanOrEqual(250);
  });
});

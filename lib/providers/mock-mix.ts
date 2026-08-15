import type { AudioMixProvider, MasterResult, MixAnalysis, MixResult, MixTrackInput } from "@/lib/audio/types";
import { randomUUID } from "crypto";

export class MockMixProvider implements AudioMixProvider {
  readonly name = "mock";

  async uploadStem(_body: Buffer, filename: string): Promise<{ readableUrl: string }> {
    return { readableUrl: `mock://upload/${filename}` };
  }

  async startMix(tracks: MixTrackInput[], opts: { musicalStyle: string; preview: boolean }): Promise<MixResult> {
    return {
      provider_task_id: `mock-mix-${randomUUID()}`,
      preview: opts.preview,
      local_path: tracks[0]?.path,
      metadata: { mock: true, track_count: tracks.length, musicalStyle: opts.musicalStyle },
    };
  }

  async retrieveMix(providerTaskId: string): Promise<MixResult> {
    return { provider_task_id: providerTaskId, preview: true, metadata: { mock: true, status: "complete" } };
  }

  async analyzeMix(): Promise<MixAnalysis> {
    return {
      status: "pass",
      metrics: { mock: true, lufs: -14, true_peak: -1.0, dynamic_range: 8 },
      notes: "Mock analysis always passes",
    };
  }

  async startMaster(_mixUrl: string, opts: { musicalStyle: string; desiredLoudness: string; preview: boolean }): Promise<MasterResult> {
    return {
      provider_task_id: `mock-master-${randomUUID()}`,
      preview: opts.preview,
      metadata: { mock: true, musicalStyle: opts.musicalStyle },
    };
  }

  async retrieveMaster(providerTaskId: string): Promise<MasterResult> {
    return { provider_task_id: providerTaskId, preview: false, metadata: { mock: true, status: "complete" } };
  }
}

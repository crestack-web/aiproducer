import type {
  AudioMixProvider,
  MasterResult,
  MixAnalysis,
  MixResult,
  MixTrackInput,
} from "@/lib/audio/types";
import { randomUUID } from "crypto";

/**
 * In-memory path registry so retrieveMix/retrieveMaster can return the same
 * storage path that startMix/startMaster received. Without this, produce wrote
 * master rows with mock:// paths and download always 404'd.
 */
const taskPaths = new Map<string, string>();

export class MockMixProvider implements AudioMixProvider {
  readonly name = "mock";

  async uploadStem(_body: Buffer, filename: string, _contentType: string): Promise<{ readableUrl: string }> {
    return { readableUrl: `mock://upload/${filename}` };
  }

  async startMix(
    tracks: MixTrackInput[],
    opts: { musicalStyle: string; preview: boolean; webhookUrl?: string; sampleRate?: number }
  ): Promise<MixResult> {
    const taskId = `mock-mix-${randomUUID()}`;
    // Prefer a real storage path (instrumental or first vocal) so download works
    const path =
      tracks.find((t) => t.path && !t.path.startsWith("mock://"))?.path ||
      tracks[0]?.path ||
      `mock://mix/${taskId}`;
    taskPaths.set(taskId, path);
    return {
      provider_task_id: taskId,
      preview: opts.preview,
      local_path: path,
      download_url: undefined,
      metadata: { mock: true, track_count: tracks.length, musicalStyle: opts.musicalStyle },
    };
  }

  async retrieveMix(providerTaskId: string): Promise<MixResult> {
    const path = taskPaths.get(providerTaskId);
    return {
      provider_task_id: providerTaskId,
      preview: true,
      local_path: path,
      metadata: { mock: true, status: "complete" },
    };
  }

  async analyzeMix(
    _audioUrl: string,
    _opts: { musicalStyle: string; isMaster: boolean }
  ): Promise<MixAnalysis> {
    return {
      status: "pass",
      metrics: { mock: true, lufs: -14, true_peak: -1.0, dynamic_range: 8 },
      notes: "Mock analysis always passes",
    };
  }

  async startMaster(
    mixUrl: string,
    opts: {
      musicalStyle: string;
      desiredLoudness: "LOW" | "MEDIUM" | "HIGH";
      preview: boolean;
      webhookUrl?: string;
    }
  ): Promise<MasterResult> {
    const taskId = `mock-master-${randomUUID()}`;
    const path = mixUrl && !mixUrl.startsWith("mock://") ? mixUrl : mixUrl || `mock://master/${taskId}`;
    taskPaths.set(taskId, path);
    return {
      provider_task_id: taskId,
      preview: opts.preview,
      local_path: path,
      metadata: { mock: true, musicalStyle: opts.musicalStyle },
    };
  }

  async retrieveMaster(providerTaskId: string): Promise<MasterResult> {
    const path = taskPaths.get(providerTaskId);
    return {
      provider_task_id: providerTaskId,
      preview: false,
      local_path: path,
      metadata: { mock: true, status: "complete" },
    };
  }
}

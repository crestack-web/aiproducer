import { mockWavBuffer } from "@/lib/dev-mock";
import type { MusicGenerationProvider } from "./provider";
import type {
  MusicGenerationRequest,
  ProviderGenerateResult,
  ProviderPollResult,
  ProviderSubmitResult,
} from "./types";
import { randomUUID } from "crypto";

export class MockMusicProvider implements MusicGenerationProvider {
  readonly name = "mock" as const;

  maxDurationSec(_kind: "preview" | "full"): number {
    return 3;
  }

  async checkAvailability(): Promise<void> {}

  async submitPrediction(_req: MusicGenerationRequest & { prompt: string }): Promise<ProviderSubmitResult> {
    return { providerPredictionId: `mock-pred-${randomUUID()}`, status: "succeeded" };
  }

  async pollPrediction(providerPredictionId: string): Promise<ProviderPollResult> {
    return { status: "succeeded", outputUrl: `mock://music/${providerPredictionId}.wav` };
  }

  async downloadOutput(_outputUrl: string) {
    return { buffer: mockWavBuffer(3, 22050), contentType: "audio/wav", extension: "wav" };
  }

  async generate(req: MusicGenerationRequest & { prompt: string }): Promise<ProviderGenerateResult> {
    const id = `mock-pred-${randomUUID()}`;
    return {
      buffer: mockWavBuffer(3, 22050),
      contentType: "audio/wav",
      extension: "wav",
      durationSec: 3,
      providerPredictionId: id,
      model: "mock-wav",
      metadata: { mock: true, prompt: req.prompt },
    };
  }
}

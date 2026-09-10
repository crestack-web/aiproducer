import { isWavBuffer } from "@/lib/audio/wav";
import { detectAudioFormat } from "@/lib/audio/roex-assets";

export type ValidationResult = {
  ok: boolean;
  format: string;
  bytes: number;
  errors: string[];
};

export function validateAudioBuffer(buffer: Buffer, pathHint?: string): ValidationResult {
  const errors: string[] = [];
  if (!buffer || buffer.length < 100) errors.push("empty");
  if (buffer && buffer.length > 120 * 1024 * 1024) errors.push("too_large");
  const det = detectAudioFormat(buffer, pathHint);
  if (det.format === "unknown" && !isWavBuffer(buffer)) {
    errors.push("unsupported_format");
  }
  return {
    ok: errors.length === 0,
    format: det.format,
    bytes: buffer?.length || 0,
    errors,
  };
}

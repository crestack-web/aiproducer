export type TryItStatus =
  | "created"
  | "sample_ready"
  | "voice_ready"
  | "generating"
  | "preview_ready"
  | "expired"
  | "failed";

export type TryItSessionRow = {
  id: string;
  user_id: string;
  scope: "trial";
  status: TryItStatus;
  eleven_voice_id: string | null;
  sample_path: string | null;
  sample_duration_ms: number | null;
  beat_path: string | null;
  vocal_path: string | null;
  mix_path: string | null;
  genre: string | null;
  tempo: number | null;
  lyrics: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  expires_at: string;
};

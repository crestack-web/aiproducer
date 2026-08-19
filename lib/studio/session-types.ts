/** Shared types for the project recording session booth. */
export type Task = {
  id: string;
  type: string;
  title?: string | null;
  instruction: string;
  reason?: string | null;
  status: string;
  required: boolean;
  start_ms: number | null;
  end_ms: number | null;
  section_id?: string | null;
  metadata?: {
    section_label?: string;
    vocal_part?: string;
    section_id?: string;
    /** Bar window for this layer when known (layered on top of ms placement). */
    start_bar?: number | null;
    end_bar?: number | null;
    layer_role?: string;
  };
};

export type ProjectMeta = {
  id: string;
  status: string;
  title?: string | null;
  genre?: string | null;
  mood?: string | null;
  tempo?: number | null;
};

export type Screen = "beat" | "analyzing" | "plan" | "session" | "assemble" | "done";
export type Phase = "ready" | "countdown" | "recording" | "review";

export type CaptureDeviceInfo = {
  actualInput?: string | null;
  actualInputLabel?: string | null;
  routingStatus?: string | null;
  requestedInput?: string | null;
  requestedOutput?: string | null;
  actualOutput?: string | null;
};

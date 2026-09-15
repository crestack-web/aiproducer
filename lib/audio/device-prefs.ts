/**
 * Device-level mic / monitor preferences (localStorage).
 * Survives sections, projects, and browser restarts on the same device.
 */

const MIC_KEY = "studio_preferred_mic_id";
const SPEAKER_KEY = "studio_preferred_speaker_id";
const CONFIRMED_KEY = "studio_audio_setup_confirmed";

export function readPreferredMicId(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
}

export function readPreferredSpeakerId(): string {
  if (typeof window === "undefined") return "__handset__";
  try {
    const v = localStorage.getItem(SPEAKER_KEY);
    return v != null && v !== "" ? v : "__handset__";
  } catch {
    return "__handset__";
  }
}

/** Artist has completed the picker at least once on this device. */
export function readAudioSetupConfirmed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CONFIRMED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePreferredMicId(deviceId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MIC_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

export function writePreferredSpeakerId(deviceId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SPEAKER_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

export function writeAudioSetupConfirmed(confirmed = true): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONFIRMED_KEY, confirmed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function micSummaryLabel(deviceId: string): string {
  if (!deviceId) return "Default microphone";
  return "Selected microphone";
}

export function speakerSummaryLabel(deviceId: string): string {
  if (deviceId === "__handset__") return "Phone earpiece";
  if (deviceId === "__speaker__") return "Phone speaker";
  if (deviceId === "__headphones__") return "Headphones";
  if (!deviceId) return "Default output";
  return "Selected speaker";
}

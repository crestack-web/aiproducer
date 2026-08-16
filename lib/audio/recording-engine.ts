/**
 * Mobile vocal RecordingEngine — capture path only (no beat mixing).
 *
 * Signal graph (recording):
 *   Phone mic → getUserMedia → [optional GainNode] → MediaStream → MediaRecorder
 *
 * Signal graph (monitor, separate):
 *   Beat <audio> → setSinkId(headphones) → user ears
 *
 * The beat must never connect to MediaRecorder / MediaStreamDestination.
 */

export type RecordingConstraintsMode = "music_headphones" | "music_speaker" | "speech_fallback";

export type RecordingDeviceInfo = {
  inputDeviceId: string;
  inputLabel: string;
  outputPreference: string;
  headphonesMonitoring: boolean;
  constraintsMode: RecordingConstraintsMode;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  sampleRate?: number;
  channelCount?: number;
  mimeType?: string;
};

export type OpenRecordingResult = {
  stream: MediaStream;
  /** Stream actually fed to MediaRecorder (may be gain-processed) */
  recordStream: MediaStream;
  info: RecordingDeviceInfo;
  fellBack: boolean;
  /** Tear down AudioContext gain graph if used */
  dispose: () => void;
};

const HEADPHONE_RE = /head|ear.?pod|airpod|headset|lightning|usb|bluetooth|wired/i;
const BUILTIN_MIC_RE = /iphone|ipad|android|phone|built.?in|internal|default/i;
const BT_MIC_RE = /airpod|bluetooth|headset|hands.?free|hfp|sco/i;

export function looksLikeHeadphonesLabel(label: string): boolean {
  return HEADPHONE_RE.test(label || "");
}

export function looksLikeBuiltInMicLabel(label: string): boolean {
  return BUILTIN_MIC_RE.test(label || "");
}

export function looksLikeBluetoothOrHeadsetMic(label: string): boolean {
  return BT_MIC_RE.test(label || "");
}

export function preferBuiltInMicId(
  devices: { deviceId: string; label: string }[]
): string {
  const notHeadset = devices.filter((d) => !looksLikeHeadphonesLabel(d.label));
  const builtin =
    notHeadset.find((d) => looksLikeBuiltInMicLabel(d.label)) ||
    notHeadset.find(
      (d) =>
        /microphone|mic/i.test(d.label) &&
        !/headset|headphone|ear.?pod|airpod|bluetooth/i.test(d.label)
    ) ||
    notHeadset[0];
  return builtin?.deviceId || "";
}

/**
 * MUSIC recording constraints.
 * Headphones monitor → no AEC (AEC damages sung vocals when there is no speaker bleed).
 * Phone speaker monitor → AEC on to reduce acoustic feedback into the mic.
 */
export function buildMusicMicConstraints(
  deviceId: string,
  headphonesMonitoring: boolean
): MediaTrackConstraints {
  const mode: RecordingConstraintsMode = headphonesMonitoring
    ? "music_headphones"
    : "music_speaker";

  const base: MediaTrackConstraints = {
    // Music path: preserve natural vocal; avoid call-center processing
    echoCancellation: mode === "music_speaker",
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };

  if (deviceId) {
    return { ...base, deviceId: { exact: deviceId } };
  }
  return base;
}

function isHeadphonesOutputPreference(pref: string): boolean {
  if (!pref || pref === "__headphones__") return true;
  if (pref === "__speaker__") return false;
  return looksLikeHeadphonesLabel(pref);
}

/**
 * Open mic for vocal recording. Never touches playback routing.
 */
export async function openRecordingStream(opts: {
  preferredInputId: string;
  outputPreference?: string;
}): Promise<OpenRecordingResult> {
  const headphonesMonitoring = isHeadphonesOutputPreference(opts.outputPreference || "__headphones__");
  const constraintsMode: RecordingConstraintsMode = headphonesMonitoring
    ? "music_headphones"
    : "music_speaker";

  let targetId = opts.preferredInputId;

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label?.trim() || `Microphone ${i + 1}`,
        }));
      if (!targetId) {
        targetId = preferBuiltInMicId(inputs);
      }
    } catch {
      /* ignore */
    }
  }

  const tryOpen = async (id: string, softExact: boolean) => {
    const constraints = softExact
      ? ({
          ...buildMusicMicConstraints("", headphonesMonitoring),
          ...(id ? { deviceId: { ideal: id } } : {}),
        } as MediaTrackConstraints)
      : buildMusicMicConstraints(id, headphonesMonitoring);
    return navigator.mediaDevices.getUserMedia({ audio: constraints });
  };

  let stream: MediaStream;
  let fellBack = false;

  try {
    stream = await tryOpen(targetId, false);
  } catch {
    fellBack = true;
    try {
      stream = await tryOpen(targetId, true);
    } catch {
      stream = await tryOpen("", false);
    }
  }

  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() || {};
  let inputLabel = (track?.label || "").trim();
  let inputDeviceId = settings.deviceId || targetId || "";

  // If we landed on a BT/headset mic while aiming for phone mic, try once more for built-in
  if (looksLikeBluetoothOrHeadsetMic(inputLabel) && navigator.mediaDevices?.enumerateDevices) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label?.trim() || `Microphone ${i + 1}`,
        }));
      const phoneId = preferBuiltInMicId(inputs);
      if (phoneId && phoneId !== inputDeviceId) {
        stream.getTracks().forEach((t) => t.stop());
        try {
          stream = await tryOpen(phoneId, false);
          fellBack = true;
          const t2 = stream.getAudioTracks()[0];
          inputLabel = (t2?.label || "").trim();
          inputDeviceId = t2?.getSettings?.().deviceId || phoneId;
        } catch {
          stream = await tryOpen(phoneId, true);
          const t2 = stream.getAudioTracks()[0];
          inputLabel = (t2?.label || "").trim();
          inputDeviceId = t2?.getSettings?.().deviceId || phoneId;
        }
      }
    } catch {
      /* keep first stream */
    }
  }

  // Unity-gain pass-through graph reserved for future safe gain; currently record raw track
  // so we never mix destination noise. recordStream === stream.
  const recordStream = stream;

  const info: RecordingDeviceInfo = {
    inputDeviceId,
    inputLabel,
    outputPreference: opts.outputPreference || "__headphones__",
    headphonesMonitoring,
    constraintsMode,
    echoCancellation: constraintsMode === "music_speaker",
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: typeof settings.sampleRate === "number" ? settings.sampleRate : undefined,
    channelCount: typeof settings.channelCount === "number" ? settings.channelCount : 1,
  };

  try {
    sessionStorage.setItem(
      "studio_last_recording_device",
      JSON.stringify({ ...info, at: Date.now() })
    );
  } catch {
    /* ignore */
  }

  return {
    stream,
    recordStream,
    info,
    fellBack,
    dispose: () => {
      /* no extra graph yet */
    },
  };
}

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const t of [
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm;codecs=opus",
    "audio/webm",
  ]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

export function createVocalRecorder(stream: MediaStream): {
  recorder: MediaRecorder;
  mimeType: string;
} {
  const mimeType = pickRecorderMime();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 256000,
    });
  } catch {
    recorder = new MediaRecorder(stream, { mimeType });
  }
  return { recorder, mimeType };
}

export function describeInputQualityWarning(info: RecordingDeviceInfo): string | null {
  if (looksLikeBluetoothOrHeadsetMic(info.inputLabel)) {
    return "Your headphones may be using their mic (lower quality). For the cleanest vocal, choose the phone microphone.";
  }
  return null;
}

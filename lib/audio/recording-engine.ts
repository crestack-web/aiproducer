/**
 * Mobile vocal RecordingEngine — capture path only (no beat mixing).
 *
 * INPUT (independent):
 *   Selected mic → getUserMedia → MediaStream → MediaRecorder
 *
 * OUTPUT (independent):
 *   Beat <audio> → setSinkId(headphones|speaker) → user ears
 *
 * The beat must never connect to MediaRecorder / MediaStreamDestination.
 * Input and output are never forced to match each other by the app.
 */

export type RecordingConstraintsMode = "music_headphones" | "music_speaker" | "speech_fallback";

export type RecordingDeviceInfo = {
  /** What the user/app requested */
  requestedInputDeviceId: string;
  requestedOutputDeviceId: string;
  /** What the platform actually granted (from track settings / labels) */
  actualInputDeviceId: string;
  actualInputLabel: string;
  actualInputGroupId?: string;
  /** Output preference passed through (setSinkId is separate) */
  outputPreference: string;
  headphonesMonitoring: boolean;
  constraintsMode: RecordingConstraintsMode;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  sampleRate?: number;
  channelCount?: number;
  mimeType?: string;
  /** True when actual input differs from requested in a meaningful way */
  inputMismatch: boolean;
  /** Human-readable reason when platform overrode input */
  routingNote: string | null;
  /** Legacy aliases used by existing UI */
  inputDeviceId: string;
  inputLabel: string;
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
const BT_MIC_RE = /airpod|bluetooth|headset|hands.?free|hfp|sco|ear.?pod/i;

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

function deviceWantsBuiltInMic(
  preferredId: string,
  devices: { deviceId: string; label: string }[]
): boolean {
  if (!preferredId) return true;
  const match = devices.find((d) => d.deviceId === preferredId);
  if (!match) return true;
  if (looksLikeBluetoothOrHeadsetMic(match.label)) return false;
  if (looksLikeHeadphonesLabel(match.label) && !looksLikeBuiltInMicLabel(match.label)) return false;
  return true;
}

/**
 * MUSIC recording constraints.
 * Headphones monitor → no AEC.
 * Phone speaker monitor → AEC on to reduce feedback.
 */
export function buildMusicMicConstraints(
  deviceId: string,
  headphonesMonitoring: boolean
): MediaTrackConstraints {
  const mode: RecordingConstraintsMode = headphonesMonitoring
    ? "music_headphones"
    : "music_speaker";

  const base: MediaTrackConstraints = {
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
 * Input selection is independent of output preference.
 */
export async function openRecordingStream(opts: {
  preferredInputId: string;
  outputPreference?: string;
}): Promise<OpenRecordingResult> {
  const requestedInputDeviceId = opts.preferredInputId || "";
  const requestedOutputDeviceId = opts.outputPreference || "__headphones__";
  const headphonesMonitoring = isHeadphonesOutputPreference(requestedOutputDeviceId);
  const constraintsMode: RecordingConstraintsMode = headphonesMonitoring
    ? "music_headphones"
    : "music_speaker";

  let inputs: { deviceId: string; label: string }[] = [];
  let targetId = requestedInputDeviceId;

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      inputs = all
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

  const userWantsBuiltIn = deviceWantsBuiltInMic(requestedInputDeviceId, inputs);

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

  let track = stream.getAudioTracks()[0];
  let settings = (track?.getSettings?.() || {}) as MediaTrackSettings;
  let inputLabel = (track?.label || "").trim();
  let inputDeviceId = settings.deviceId || targetId || "";
  let routingNote: string | null = null;

  // Only retry built-in when the USER wanted phone mic but OS handed BT mic.
  // Never override intentional headset mic choice.
  if (
    userWantsBuiltIn &&
    looksLikeBluetoothOrHeadsetMic(inputLabel) &&
    navigator.mediaDevices?.enumerateDevices
  ) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const listed = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label?.trim() || `Microphone ${i + 1}`,
        }));
      const phoneId = preferBuiltInMicId(listed);
      if (phoneId && phoneId !== inputDeviceId) {
        stream.getTracks().forEach((t) => t.stop());
        try {
          stream = await tryOpen(phoneId, false);
          fellBack = true;
        } catch {
          try {
            stream = await tryOpen(phoneId, true);
            fellBack = true;
          } catch {
            stream = await tryOpen(targetId, true);
          }
        }
        track = stream.getAudioTracks()[0];
        settings = (track?.getSettings?.() || {}) as MediaTrackSettings;
        inputLabel = (track?.label || "").trim();
        inputDeviceId = settings.deviceId || phoneId;
      }
    } catch {
      /* keep first stream */
    }
  }

  let inputMismatch = false;
  if (userWantsBuiltIn && looksLikeBluetoothOrHeadsetMic(inputLabel)) {
    inputMismatch = true;
    routingNote =
      "Your device is using the headset/Bluetooth microphone because of the current audio route. " +
      "The phone microphone could not be selected independently on this platform.";
  } else if (
    requestedInputDeviceId &&
    inputDeviceId &&
    requestedInputDeviceId !== inputDeviceId &&
    requestedInputDeviceId !== "default"
  ) {
    const requested = inputs.find((d) => d.deviceId === requestedInputDeviceId);
    if (
      requested &&
      inputLabel &&
      requested.label &&
      requested.label !== inputLabel &&
      !inputLabel.toLowerCase().includes(requested.label.toLowerCase().slice(0, 12))
    ) {
      inputMismatch = true;
      routingNote = `Requested “${requested.label}” but the system activated “${inputLabel}”.`;
    }
  }

  const recordStream = stream;

  const info: RecordingDeviceInfo = {
    requestedInputDeviceId,
    requestedOutputDeviceId,
    actualInputDeviceId: inputDeviceId,
    actualInputLabel: inputLabel,
    actualInputGroupId:
      typeof settings.groupId === "string" ? settings.groupId : undefined,
    outputPreference: requestedOutputDeviceId,
    headphonesMonitoring,
    constraintsMode,
    echoCancellation: constraintsMode === "music_speaker",
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: typeof settings.sampleRate === "number" ? settings.sampleRate : undefined,
    channelCount: typeof settings.channelCount === "number" ? settings.channelCount : 1,
    inputMismatch,
    routingNote,
    inputDeviceId,
    inputLabel,
  };

  try {
    sessionStorage.setItem(
      "studio_last_recording_device",
      JSON.stringify({
        ...info,
        browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
        platform: typeof navigator !== "undefined" ? navigator.platform : "",
        at: Date.now(),
      })
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
  if (info.routingNote) return info.routingNote;
  if (looksLikeBluetoothOrHeadsetMic(info.actualInputLabel || info.inputLabel)) {
    return "Headset/Bluetooth microphone is active. You can switch to the phone microphone above if you prefer higher quality.";
  }
  return null;
}

/** Developer diagnostics for a recording session (no secrets). */
export function buildRecordingRouteDiagnostics(
  info: RecordingDeviceInfo,
  outputRoute?: {
    requestedOutputDeviceId?: string;
    actualOutputDeviceId?: string;
    setSinkIdSupported?: boolean;
    routed?: boolean;
  }
): Record<string, unknown> {
  return {
    inputRequested: info.requestedInputDeviceId || "(default/built-in preference)",
    inputActual: info.actualInputDeviceId || info.inputDeviceId || "(unknown)",
    inputActualLabel: info.actualInputLabel || info.inputLabel || "(unlabeled)",
    inputGroupId: info.actualInputGroupId || null,
    inputMismatch: info.inputMismatch,
    routingNote: info.routingNote,
    outputRequested: outputRoute?.requestedOutputDeviceId || info.requestedOutputDeviceId,
    outputActual: outputRoute?.actualOutputDeviceId || "(system-managed)",
    outputControlSupported: outputRoute?.setSinkIdSupported ?? null,
    outputRouted: outputRoute?.routed ?? null,
    headphonesMonitoring: info.headphonesMonitoring,
    constraintsMode: info.constraintsMode,
    echoCancellation: info.echoCancellation,
    noiseSuppression: info.noiseSuppression,
    autoGainControl: info.autoGainControl,
    sampleRate: info.sampleRate ?? null,
    channelCount: info.channelCount ?? null,
    browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
  };
}

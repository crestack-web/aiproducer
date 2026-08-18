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

/** Honest outcome of requested vs actual input routing */
export type RoutingStatus = "MATCHED" | "OS_OVERRIDE" | "FALLBACK" | "DEFAULT";

export type RecordingDeviceInfo = {
  /** What the user/app requested */
  requestedInputDeviceId: string;
  requestedInputLabel?: string;
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
  /** Browser-reported track setting when available */
  effectiveEchoCancellation: boolean | null;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  sampleRate?: number;
  channelCount?: number;
  mimeType?: string;
  /** True when actual input differs from requested in a meaningful way */
  inputMismatch: boolean;
  /** MATCHED | OS_OVERRIDE | FALLBACK | DEFAULT */
  routingStatus: RoutingStatus;
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
 *
 * Architecture (unchanged):
 *   INPUT:  selected mic → getUserMedia → MediaRecorder  (vocal only)
 *   OUTPUT: beat <audio> → setSinkId                     (monitor only)
 * The beat must never enter MediaRecorder / MediaStreamDestination.
 *
 * Explicit selection uses deviceId: { exact }. We do NOT fight the OS with
 * repeated getUserMedia retries when Bluetooth forces a headset mic — that
 * override is reported as OS_OVERRIDE instead of silently claiming phone mic.
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

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label?.trim() || `Microphone ${i + 1}`,
        }));
    } catch {
      /* ignore */
    }
  }

  const requestedLabel =
    inputs.find((d) => d.deviceId === requestedInputDeviceId)?.label || "";
  const explicitSelection = Boolean(requestedInputDeviceId);
  // Explicit choice → that deviceId only. Empty → system default (no force-built-in).
  const targetId = requestedInputDeviceId;

  const tryOpen = async (id: string, mode: "exact" | "ideal" | "default") => {
    const base = buildMusicMicConstraints(
      mode === "default" ? "" : mode === "exact" ? id : "",
      headphonesMonitoring
    );
    let constraints: MediaTrackConstraints = base;
    if (mode === "ideal" && id) {
      constraints = { ...base, deviceId: { ideal: id } };
    }
    // exact path already embeds deviceId: { exact } via buildMusicMicConstraints
    return navigator.mediaDevices.getUserMedia({ audio: constraints });
  };

  let stream: MediaStream;
  let fellBack = false;

  if (explicitSelection) {
    try {
      // Strongest: honor artist’s exact mic choice
      stream = await tryOpen(targetId, "exact");
    } catch {
      // Platform rejected exact (unplugged / OS block) — one soft ideal, then default
      fellBack = true;
      try {
        stream = await tryOpen(targetId, "ideal");
      } catch {
        stream = await tryOpen("", "default");
      }
    }
  } else {
    // No explicit pick: system/default mic (do not force built-in over Bluetooth)
    stream = await tryOpen("", "default");
  }

  const track = stream.getAudioTracks()[0];
  const settings = (track?.getSettings?.() || {}) as MediaTrackSettings;
  const inputLabel = (track?.label || "").trim();
  const inputDeviceId = settings.deviceId || targetId || "";

  // —— Honest requested vs actual (no further getUserMedia fights) ——
  let inputMismatch = false;
  let routingStatus: RoutingStatus = explicitSelection ? "MATCHED" : "DEFAULT";
  let routingNote: string | null = null;

  const userWantedPhoneMic =
    explicitSelection && deviceWantsBuiltInMic(requestedInputDeviceId, inputs);
  const actualIsBtMic = looksLikeBluetoothOrHeadsetMic(inputLabel);
  const idMismatch =
    explicitSelection &&
    inputDeviceId &&
    requestedInputDeviceId !== inputDeviceId &&
    requestedInputDeviceId !== "default";

  if (userWantedPhoneMic && actualIsBtMic) {
    // Classic iOS/Bluetooth case: OS binds headset mic to BT audio route
    inputMismatch = true;
    routingStatus = "OS_OVERRIDE";
    routingNote =
      "Your device is using the AirPods/headset microphone because of the current Bluetooth audio route. " +
      "To use your phone microphone, disconnect AirPods or change the device’s audio route, " +
      "then select Phone Microphone and record again.";
  } else if (idMismatch || (explicitSelection && fellBack && actualIsBtMic)) {
    inputMismatch = true;
    routingStatus = fellBack ? "FALLBACK" : "OS_OVERRIDE";
    const wanted = requestedLabel || "selected microphone";
    const got = inputLabel || "another microphone";
    routingNote =
      `Requested “${wanted}” but the system activated “${got}”. ` +
      (actualIsBtMic
        ? "Bluetooth audio often forces the headset mic on mobile — disconnect AirPods to use the phone mic."
        : "Recording will use the microphone the system actually provided.");
  } else if (fellBack && explicitSelection) {
    routingStatus = "FALLBACK";
    if (requestedLabel && inputLabel && requestedLabel !== inputLabel) {
      inputMismatch = true;
      routingNote = `Could not lock “${requestedLabel}”; using “${inputLabel}”.`;
    }
  } else if (explicitSelection) {
    routingStatus = "MATCHED";
  }

  // recordStream is the same mic MediaStream — beat is never mixed in
  const recordStream = stream;

  const info: RecordingDeviceInfo = {
    requestedInputDeviceId,
    requestedInputLabel: requestedLabel || undefined,
    requestedOutputDeviceId,
    actualInputDeviceId: inputDeviceId,
    actualInputLabel: inputLabel,
    actualInputGroupId:
      typeof settings.groupId === "string" ? settings.groupId : undefined,
    outputPreference: requestedOutputDeviceId,
    headphonesMonitoring,
    constraintsMode,
    echoCancellation: constraintsMode === "music_speaker",
    effectiveEchoCancellation:
      typeof (settings as { echoCancellation?: boolean }).echoCancellation === "boolean"
        ? (settings as { echoCancellation: boolean }).echoCancellation
        : null,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: typeof settings.sampleRate === "number" ? settings.sampleRate : undefined,
    channelCount: typeof settings.channelCount === "number" ? settings.channelCount : 1,
    inputMismatch,
    routingStatus,
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
      /* no extra Web Audio graph — mic stream only */
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
  if (
    info.routingStatus === "OS_OVERRIDE" ||
    (info.inputMismatch && looksLikeBluetoothOrHeadsetMic(info.actualInputLabel || info.inputLabel))
  ) {
    return (
      info.routingNote ||
      "Your device is using the AirPods/headset microphone because of the current Bluetooth audio route. " +
        "To use your phone microphone, disconnect AirPods or change the device’s audio route."
    );
  }
  return null;
}

/** Developer diagnostics for a recording session (no secrets / no technical IDs in user UI). */
export function buildRecordingRouteDiagnostics(
  info: RecordingDeviceInfo,
  outputRoute?: {
    requestedOutputDeviceId?: string;
    requestedOutputLabel?: string;
    actualOutputDeviceId?: string;
    actualOutputLabel?: string;
    setSinkIdSupported?: boolean;
    routed?: boolean;
  }
): Record<string, unknown> {
  return {
    requestedInput: info.requestedInputLabel || info.requestedInputDeviceId || "(system default)",
    actualInput: info.actualInputLabel || info.inputLabel || "(unlabeled)",
    requestedInputDeviceId: info.requestedInputDeviceId || null,
    actualInputDeviceId: info.actualInputDeviceId || info.inputDeviceId || null,
    inputGroupId: info.actualInputGroupId || null,
    inputMismatch: info.inputMismatch,
    routingStatus: info.routingStatus,
    routingNote: info.routingNote,
    requestedOutput:
      outputRoute?.requestedOutputLabel ||
      outputRoute?.requestedOutputDeviceId ||
      info.requestedOutputDeviceId,
    actualOutput:
      outputRoute?.actualOutputLabel ||
      outputRoute?.actualOutputDeviceId ||
      "(system-managed)",
    outputControlSupported: outputRoute?.setSinkIdSupported ?? null,
    outputRouted: outputRoute?.routed ?? null,
    headphonesMonitoring: info.headphonesMonitoring,
    constraintsMode: info.constraintsMode,
    echoCancellation: info.echoCancellation,
    effectiveEchoCancellation: info.effectiveEchoCancellation,
    noiseSuppression: info.noiseSuppression,
    autoGainControl: info.autoGainControl,
    sampleRate: info.sampleRate ?? null,
    channelCount: info.channelCount ?? null,
    /** Capture purity: MediaRecorder receives mic stream only; beat is separate <audio> */
    beatInMediaRecorder: false,
    browser: typeof navigator !== "undefined" ? navigator.userAgent : "",
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
  };
}

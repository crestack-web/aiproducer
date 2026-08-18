import type { CaptureBleedAnalysis } from "@/lib/audio/capture-bleed-analysis";
import { buildCaptureDiagnosticSummary } from "@/lib/audio/capture-bleed-analysis";
import { classifyCapture, isPhoneSpeakerOutput, type SpeakerDuckDiagnostics } from "@/lib/audio/speaker-monitor-duck";

export function writeCaptureForensics(opts: {
  mimeType: string;
  blob: Blob;
  wallClockMs: number;
  offsetMs: number;
  placeMs: number;
  blobAnalysis: CaptureBleedAnalysis | null;
  duck: SpeakerDuckDiagnostics | null;
  selectedSpeakerId: string | null;
  selectedMicId: string | null;
  requestedInput: string | null;
  actualInput: string | null;
  actualInputLabel: string | null;
  requestedOutput: string | null;
  actualOutput: string | null;
}) {
  try {
    const duck = opts.duck;
    const liveClass = classifyCapture({
      beatInMediaRecorder: false,
      rmsSilentAvg: duck?.rmsSilentAvg ?? null,
      rmsVoiceAvg: duck?.rmsVoiceAvg ?? null,
    });
    const finalClass = opts.blobAnalysis?.classification ?? liveClass.classification;
    const finalReason = opts.blobAnalysis?.classificationReason ?? liveClass.reason;
    const summary = buildCaptureDiagnosticSummary({
      route: isPhoneSpeakerOutput(opts.selectedSpeakerId) ? "phone_mic+phone_speaker" : "other",
      requestedInput: opts.requestedInput || opts.selectedMicId || null,
      actualInput: opts.actualInputLabel || opts.actualInput || opts.selectedMicId || null,
      requestedOutput: opts.requestedOutput || opts.selectedSpeakerId || null,
      actualOutput: opts.actualOutput || opts.selectedSpeakerId || null,
      beatInMediaRecorder: false,
      duckEventCount: duck?.duckEventCount ?? 0,
      analysis: opts.blobAnalysis,
    });
    sessionStorage.setItem("studio_last_capture_summary", JSON.stringify(summary));
    sessionStorage.setItem(
      "studio_last_capture_forensics",
      JSON.stringify({
        mimeType: opts.mimeType,
        blobBytes: opts.blob.size,
        wallClockRecordingMs: opts.wallClockMs,
        beat_in_media_recorder: false,
        beatInMediaRecorder: false,
        beat_capture_possible: "acoustic_only_if_phone_speaker",
        captureGraph: "mic→getUserMedia→MediaRecorder (vocal only); beat→HTMLAudioElement",
        speaker_monitor_duck: isPhoneSpeakerOutput(opts.selectedSpeakerId),
        requestedInput: summary.requestedInput,
        actualInput: summary.actualInput,
        requestedOutput: summary.requestedOutput,
        actualOutput: summary.actualOutput,
        recordingOffsetMs: opts.offsetMs,
        placementStartMs: opts.placeMs,
        liveRmsSilentAvg: duck?.rmsSilentAvg ?? null,
        liveRmsVoiceAvg: duck?.rmsVoiceAvg ?? null,
        liveRmsPeak: duck?.rmsPeak ?? null,
        liveVoiceToBleedRatio: duck?.voiceToBleedRatio ?? null,
        duckEventCount: duck?.duckEventCount ?? 0,
        lastDuckStartMs: duck?.lastDuckStartMs ?? null,
        lastDuckReleaseMs: duck?.lastDuckReleaseMs ?? null,
        duckEvents: duck?.events ?? [],
        normalBeatVolume: duck?.normalBeatVolume ?? 0.045,
        duckedBeatVolume: duck?.duckedBeatVolume ?? 0.01,
        averageDuckedVolume: duck?.averageDuckedVolume ?? null,
        originalCaptureUnprocessed: true,
        originalDurationMs: opts.blobAnalysis?.originalDurationMs ?? null,
        vocalEnergy: opts.blobAnalysis?.vocalRms ?? null,
        backgroundEnergy: opts.blobAnalysis?.backgroundRms ?? null,
        voiceToBackgroundRatio: opts.blobAnalysis?.voiceToBackgroundRatio ?? null,
        backgroundLowBandEnergy: opts.blobAnalysis?.backgroundLowBandEnergy ?? null,
        backgroundRmsBeforeDuck: opts.blobAnalysis?.backgroundRmsBeforeDuck ?? null,
        backgroundRmsDuringDuck: opts.blobAnalysis?.backgroundRmsDuringDuck ?? null,
        backgroundRmsAfterDuck: opts.blobAnalysis?.backgroundRmsAfterDuck ?? null,
        duckBackgroundReduction: opts.blobAnalysis?.duckBackgroundReduction ?? null,
        blobAnalysisOk: opts.blobAnalysis?.ok ?? false,
        blobAnalysisMethod: opts.blobAnalysis?.analysisMethod ?? null,
        blobAnalysisLimitations: opts.blobAnalysis?.limitations ?? [],
        classification: finalClass,
        classificationReason: finalReason,
        summary,
        at: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}

export function mergeAnalysisIntoForensics(attached: {
  analysis?: { durationMs?: number | null; loudness?: { peak?: number | null; rms?: number | null } | null } | null;
  sourceSampleRate?: number | null;
  conversionSampleRate?: number | null;
  conversionMethod?: string | null;
}, wallClockMs: number) {
  try {
    const prev = sessionStorage.getItem("studio_last_capture_forensics");
    const base = prev ? JSON.parse(prev) : {};
    sessionStorage.setItem(
      "studio_last_capture_forensics",
      JSON.stringify({
        ...base,
        analysisDurationMs: attached.analysis?.durationMs ?? null,
        mic_peak: attached.analysis?.loudness?.peak ?? null,
        mic_rms: attached.analysis?.loudness?.rms ?? null,
        micPeak: attached.analysis?.loudness?.peak ?? null,
        micRms: attached.analysis?.loudness?.rms ?? null,
        sourceSampleRate: attached.sourceSampleRate,
        conversionSampleRate: attached.conversionSampleRate,
        conversionMethod: attached.conversionMethod,
        durationMs: attached.analysis?.durationMs ?? wallClockMs,
        originalCaptureUnprocessed: true,
        at: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}

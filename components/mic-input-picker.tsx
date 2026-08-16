"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

export type MicDevice = {
  deviceId: string;
  label: string;
};

type Props = {
  /** Controlled selected deviceId (empty = browser default) */
  selectedDeviceId: string;
  onSelect: (deviceId: string) => void;
  /** Hide during active recording */
  disabled?: boolean;
  compact?: boolean;
};

/**
 * Mobile-friendly mic discovery + selection + level test.
 * Labels come only from MediaDevices after permission.
 */
export function MicInputPicker({ selectedDeviceId, onSelect, disabled, compact }: Props) {
  const { colors: C } = useTheme();
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [perm, setPerm] = useState<"unknown" | "granted" | "denied" | "prompt">("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [testLabel, setTestLabel] = useState<string | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const stopTest = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    testStreamRef.current?.getTracks().forEach((t) => t.stop());
    testStreamRef.current = null;
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const listDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("This browser cannot list microphones");
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label?.trim() || `Microphone ${i + 1}`,
        }));
      setDevices(inputs);

      // If current selection vanished, fall back to default (empty) or first device
      if (
        selectedDeviceId &&
        inputs.length > 0 &&
        !inputs.some((d) => d.deviceId === selectedDeviceId)
      ) {
        onSelect("");
        setError("Selected mic disconnected — using default microphone");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list microphones");
    }
  }, [selectedDeviceId, onSelect]);

  const ensurePermissionAndList = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Permission unlocks device labels on most mobile browsers
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((t) => t.stop());
      setPerm("granted");
      await listDevices();
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPerm("denied");
        setError("Microphone permission denied. Enable mic access in browser settings.");
      } else if (name === "NotFoundError") {
        setError("No microphone found on this device.");
      } else {
        setError(e instanceof Error ? e.message : "Could not access microphone");
      }
    } finally {
      setBusy(false);
    }
  }, [listDevices]);

  useEffect(() => {
    void listDevices();
    const onChange = () => {
      void listDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
      stopTest();
    };
  }, [listDevices, stopTest]);

  async function startTest() {
    stopTest();
    setError(null);
    setBusy(true);
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId
          ? {
              deviceId: { exact: selectedDeviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        // Device may have disappeared — fall back to default
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        onSelect("");
        setError("Selected mic unavailable — testing default microphone");
      }
      testStreamRef.current = stream;
      setPerm("granted");
      await listDevices();

      const track = stream.getAudioTracks()[0];
      setTestLabel(track?.label || devices.find((d) => d.deviceId === selectedDeviceId)?.label || "Microphone");

      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      setTesting(true);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        setLevel(Math.min(1, avg * 2.2));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mic test failed");
      stopTest();
    } finally {
      setBusy(false);
    }
  }

  const bars = 12;
  const filled = Math.round(level * bars);

  return (
    <div
      style={{
        marginTop: compact ? 10 : 14,
        padding: compact ? 12 : 14,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        background: C.surface,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: C.brass,
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Microphone
      </div>

      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: C.textMuted, lineHeight: 1.4 }}>
        For the cleanest vocal, use headphones or earbuds while recording so the beat does not bleed
        into the mic.
      </p>

      {perm !== "granted" && devices.every((d) => !d.label || d.label.startsWith("Microphone ")) && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void ensurePermissionAndList()}
          style={{
            width: "100%",
            minHeight: 44,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
            background: C.inputFill,
            color: C.text,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          {busy ? "Requesting access…" : "Allow microphone access"}
        </button>
      )}

      {devices.length > 0 ? (
        <div role="radiogroup" aria-label="Microphone" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minHeight: 44,
              padding: "8px 10px",
              borderRadius: 12,
              border: `1px solid ${!selectedDeviceId ? C.brass : C.border}`,
              background: !selectedDeviceId ? C.brassSoft : "transparent",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              type="radio"
              name="studio-mic"
              checked={!selectedDeviceId}
              disabled={disabled}
              onChange={() => onSelect("")}
              style={{ width: 18, height: 18, accentColor: C.brass }}
            />
            <span style={{ fontSize: 14, color: C.text }}>Default microphone</span>
          </label>
          {devices.map((d) => (
            <label
              key={d.deviceId || d.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                minHeight: 44,
                padding: "8px 10px",
                borderRadius: 12,
                border: `1px solid ${selectedDeviceId === d.deviceId ? C.brass : C.border}`,
                background: selectedDeviceId === d.deviceId ? C.brassSoft : "transparent",
                cursor: disabled ? "default" : "pointer",
              }}
            >
              <input
                type="radio"
                name="studio-mic"
                checked={selectedDeviceId === d.deviceId}
                disabled={disabled}
                onChange={() => onSelect(d.deviceId)}
                style={{ width: 18, height: 18, accentColor: C.brass }}
              />
              <span style={{ fontSize: 14, color: C.text, lineHeight: 1.3 }}>{d.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 8px" }}>
          {perm === "denied"
            ? "No microphones available (permission denied)."
            : "No microphones listed yet. Allow access to see device names."}
        </p>
      )}

      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => (testing ? stopTest() : void startTest())}
        style={{
          width: "100%",
          minHeight: 44,
          marginTop: 10,
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          background: C.inputFill,
          color: C.text,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {testing ? "Stop test" : "Test microphone"}
      </button>

      {testing && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
            Speak · {testLabel || "Microphone"}
          </div>
          <div
            style={{
              display: "flex",
              gap: 3,
              height: 28,
              alignItems: "flex-end",
            }}
            aria-label={`Input level ${Math.round(level * 100)} percent`}
          >
            {Array.from({ length: bars }).map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${30 + (i / bars) * 70}%`,
                  borderRadius: 2,
                  background: i < filled ? C.signal : C.border,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.textMuted, lineHeight: 1.4 }}>
        Tip: phone mic + wired headphones often beats Bluetooth headsets (which can lower quality or
        add latency). Choose what works best for you.
      </p>

      {error && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: C.danger, lineHeight: 1.35 }}>{error}</p>
      )}
    </div>
  );
}

/** Build getUserMedia audio constraints for the selected device. */
export function micAudioConstraints(deviceId: string): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) {
    return { ...base, deviceId: { exact: deviceId } };
  }
  return base;
}

/**
 * Open mic stream with preferred device; fall back to default if exact fails.
 */
export async function openMicStream(
  preferredDeviceId: string
): Promise<{ stream: MediaStream; usedDeviceId: string; fellBack: boolean }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: micAudioConstraints(preferredDeviceId),
    });
    const track = stream.getAudioTracks()[0];
    const settingsId = track?.getSettings?.().deviceId || preferredDeviceId || "";
    return { stream, usedDeviceId: settingsId, fellBack: false };
  } catch (e) {
    if (preferredDeviceId) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micAudioConstraints(""),
      });
      return { stream, usedDeviceId: "", fellBack: true };
    }
    throw e;
  }
}

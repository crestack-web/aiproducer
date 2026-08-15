import type { AudioMixProvider, MasterResult, MixAnalysis, MixResult, MixTrackInput } from "@/lib/audio/types";

const BASE = "https://tonn.roexaudio.com";

function apiKey(): string {
  const k = process.env.ROEX_API_KEY;
  if (!k) throw new Error("ROEX_API_KEY is not configured");
  return k;
}

function headers(): HeadersInit {
  return { "Content-Type": "application/json", "X-API-Key": apiKey() };
}

export function mapMusicalStyle(genre?: string | null): string {
  const g = (genre || "r&b").toLowerCase();
  if (g.includes("hip")) return "HIP_HOP";
  if (g.includes("rock")) return "ROCK_INDIE";
  if (g.includes("electro") || g.includes("edm")) return "ELECTRONIC";
  if (g.includes("r&b") || g.includes("rnb") || g.includes("soul")) return "RNB";
  return "POP";
}

export class RoExMixProvider implements AudioMixProvider {
  readonly name = "roex";

  async uploadStem(body: Buffer, filename: string, contentType: string): Promise<{ readableUrl: string }> {
    const up = await fetch(`${BASE}/upload`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ filename, contentType }),
    });
    if (!up.ok) throw new Error(`RoEx upload URL failed: ${up.status} ${await up.text()}`);
    const json = (await up.json()) as { signed_url?: string; readable_url?: string };
    if (!json.signed_url || !json.readable_url) throw new Error("RoEx upload response missing URLs");
    const put = await fetch(json.signed_url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });
    if (!put.ok) throw new Error(`RoEx signed PUT failed: ${put.status}`);
    return { readableUrl: json.readable_url };
  }

  async startMix(
    tracks: MixTrackInput[],
    opts: { musicalStyle: string; preview: boolean; webhookUrl?: string; sampleRate?: number }
  ): Promise<MixResult> {
    const trackData = tracks.map((t) => ({
      trackURL: t.path,
      instrumentGroup: t.instrumentGroup,
      presenceSetting: t.presenceSetting,
      panPreference: t.panPreference,
      reverbPreference: t.reverbPreference,
    }));
    const res = await fetch(`${BASE}/mixpreview`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        multitrackData: {
          trackData,
          musicalStyle: opts.musicalStyle,
          returnStems: false,
          sampleRate: opts.sampleRate ?? 44100,
          webhookURL: opts.webhookUrl,
        },
      }),
    });
    if (!res.ok) throw new Error(`RoEx mix start failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { multitrack_task_id?: string };
    if (!json.multitrack_task_id) throw new Error("RoEx mix missing task id");
    return { provider_task_id: json.multitrack_task_id, preview: opts.preview, metadata: json as Record<string, unknown> };
  }

  async retrieveMix(providerTaskId: string): Promise<MixResult> {
    const res = await fetch(`${BASE}/retrievepreviewmix`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        multitrackData: { multitrackTaskId: providerTaskId, retrieveFXSettings: false },
      }),
    });
    if (!res.ok) throw new Error(`RoEx retrieve mix failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { preview_mix_url?: string; download_url?: string };
    return {
      provider_task_id: providerTaskId,
      preview: true,
      download_url: json.preview_mix_url || json.download_url,
      metadata: json as Record<string, unknown>,
    };
  }

  async analyzeMix(audioUrl: string, opts: { musicalStyle: string; isMaster: boolean }): Promise<MixAnalysis> {
    const res = await fetch(`${BASE}/mixanalysis`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        mixDiagnosisData: {
          audioFileLocation: audioUrl,
          musicalStyle: opts.musicalStyle,
          isMaster: opts.isMaster,
        },
      }),
    });
    if (!res.ok) throw new Error(`RoEx mix analysis failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as Record<string, unknown>;
    return { status: "needs_review", metrics: json, notes: "Raw RoEx analysis; gate rules refine next" };
  }

  async startMaster(
    mixUrl: string,
    opts: { musicalStyle: string; desiredLoudness: "LOW" | "MEDIUM" | "HIGH"; preview: boolean; webhookUrl?: string }
  ): Promise<MasterResult> {
    const res = await fetch(`${BASE}/masteringpreview`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        masteringData: {
          trackData: [{ trackURL: mixUrl }],
          musicalStyle: opts.musicalStyle,
          desiredLoudness: opts.desiredLoudness,
          webhookURL: opts.webhookUrl,
        },
      }),
    });
    if (!res.ok) throw new Error(`RoEx master start failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { mastering_task_id?: string };
    if (!json.mastering_task_id) throw new Error("RoEx master missing task id");
    return { provider_task_id: json.mastering_task_id, preview: opts.preview, metadata: json as Record<string, unknown> };
  }

  async retrieveMaster(providerTaskId: string): Promise<MasterResult> {
    const res = await fetch(`${BASE}/retrievefinalmaster`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ masteringData: { masteringTaskId: providerTaskId } }),
    });
    if (!res.ok) throw new Error(`RoEx retrieve master failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { download_url?: string };
    return { provider_task_id: providerTaskId, preview: false, download_url: json.download_url, metadata: json as Record<string, unknown> };
  }
}

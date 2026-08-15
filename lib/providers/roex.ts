import type {
  AudioMixProvider,
  MasterResult,
  MixAnalysis,
  MixResult,
  MixTrackInput,
} from "@/lib/audio/types";

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
  const g = (genre || "pop").toLowerCase();
  if (g.includes("hip") || g.includes("rap")) return "HIPHOP_GRIME";
  if (g.includes("trap")) return "TRAP";
  if (g.includes("rock")) return "ROCK_INDIE";
  if (g.includes("techno")) return "TECHNO";
  if (g.includes("house")) return "HOUSE";
  if (g.includes("electro") || g.includes("edm")) return "ELECTRONIC";
  if (g.includes("afro") || g.includes("amapiano")) return "AFROBEAT";
  if (g.includes("latin") || g.includes("reggaeton")) return "REGGAETON";
  if (g.includes("reggae")) return "REGGAE_DUB";
  if (g.includes("jazz")) return "JAZZ";
  if (g.includes("lofi") || g.includes("lo-fi")) return "LO_FI";
  if (g.includes("country") || g.includes("acoustic")) return "COUNTRY_ACOUSTIC";
  if (g.includes("metal")) return "METAL";
  if (g.includes("k-pop") || g.includes("kpop")) return "K_POP";
  return "POP";
}

export function stemToInstrumentGroup(kind: MixTrackInput["kind"]): string {
  switch (kind) {
    case "INSTRUMENTAL":
      return "BACKING_TRACK_GROUP";
    case "LEAD":
      return "VOCAL_GROUP";
    case "DOUBLE":
    case "HARMONY":
    case "BACKGROUND":
      return "BACKING_VOX_GROUP";
    case "ADLIBS":
      return "VOCAL_GROUP";
    default:
      return "OTHER_GROUP1";
  }
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
    const json = (await up.json()) as {
      signed_url?: string;
      readable_url?: string;
      error?: boolean;
      message?: string;
    };
    if (json.error || !json.signed_url || !json.readable_url) {
      throw new Error(json.message || "RoEx upload response missing URLs");
    }
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
      instrumentGroup: t.instrumentGroup || stemToInstrumentGroup(t.kind),
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
          sampleRate: String(opts.sampleRate ?? 44100),
          webhookURL: opts.webhookUrl,
        },
      }),
    });
    if (!res.ok) throw new Error(`RoEx mix start failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { multitrack_task_id?: string; error?: boolean; message?: string };
    if (json.error || !json.multitrack_task_id) throw new Error(json.message || "RoEx mix missing task id");
    return {
      provider_task_id: json.multitrack_task_id,
      preview: opts.preview,
      metadata: json as Record<string, unknown>,
    };
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
    const json = (await res.json()) as {
      previewMixTaskResults?: {
        download_url_preview_mixed?: string;
        preview_mix_url?: string;
        download_url?: string;
      };
    };
    const results = json.previewMixTaskResults || {};
    const download =
      results.download_url_preview_mixed || results.preview_mix_url || results.download_url;
    return {
      provider_task_id: providerTaskId,
      preview: true,
      download_url: download,
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
    if (!res.ok) {
      const t = await res.text();
      return {
        status: "needs_review",
        metrics: { http_status: res.status, body: t.slice(0, 500) },
        notes: "Mix analysis unavailable",
      };
    }
    const json = (await res.json()) as Record<string, unknown>;
    return { status: "needs_review", metrics: json, notes: "Raw RoEx analysis" };
  }

  async startMaster(
    mixUrl: string,
    opts: {
      musicalStyle: string;
      desiredLoudness: "LOW" | "MEDIUM" | "HIGH";
      preview: boolean;
      webhookUrl?: string;
    }
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
    const json = (await res.json()) as { mastering_task_id?: string; error?: boolean; message?: string };
    if (json.error || !json.mastering_task_id) throw new Error(json.message || "RoEx master missing task id");
    return {
      provider_task_id: json.mastering_task_id,
      preview: opts.preview,
      metadata: json as Record<string, unknown>,
    };
  }

  async retrieveMaster(providerTaskId: string): Promise<MasterResult> {
    const res = await fetch(`${BASE}/retrievepreviewmaster`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ masteringData: { masteringTaskId: providerTaskId } }),
    });
    if (!res.ok) throw new Error(`RoEx retrieve master failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      previewMasterTaskResults?: {
        download_url_mastered_preview?: string;
        download_url?: string;
      };
      finalMasterTaskResults?: { download_url?: string };
    };
    const preview = json.previewMasterTaskResults || {};
    const final = json.finalMasterTaskResults || {};
    const download =
      preview.download_url_mastered_preview || preview.download_url || final.download_url;
    return {
      provider_task_id: providerTaskId,
      preview: true,
      download_url: download,
      metadata: json as Record<string, unknown>,
    };
  }
}

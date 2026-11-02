/**
 * GET /api/projects/:id/beat/stems
 * List Daydream (or other) instrumental stems for the active beat.
 * Free users: signed listen URLs only.
 * Paid users: canDownload true + ?download=stemName streams attachment.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSignedDownloadUrl, downloadStorageObject } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/server";
import { isPaidBeatSubscriber } from "@/lib/music-generation/beat-quota";

type Ctx = { params: Promise<{ id: string }> };

const STEM_ORDER = ["drums", "bass", "guitar", "keys", "other"] as const;

const STEM_LABEL: Record<string, string> = {
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  keys: "Keys",
  other: "Other",
};

const STEM_COLOR: Record<string, string> = {
  drums: "#5B8DEF",
  bass: "#6BCB77",
  guitar: "#A0E35B",
  keys: "#7B6CF6",
  other: "#4AA8B5",
};

async function loadBeat(projectId: string, userId: string) {
  const service = createServiceClient();
  const { data: project } = await service
    .from("projects")
    .select("id, metadata, user_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) return null;

  const meta =
    project.metadata && typeof project.metadata === "object"
      ? (project.metadata as Record<string, unknown>)
      : {};
  const activeBeatId =
    typeof meta.active_beat_id === "string" ? meta.active_beat_id : null;

  let beat: Record<string, unknown> | null = null;
  if (activeBeatId) {
    const res = await service
      .from("beats")
      .select("id, audio_path, metadata, source, status")
      .eq("id", activeBeatId)
      .eq("project_id", projectId)
      .maybeSingle();
    beat = res.data as Record<string, unknown> | null;
  }
  if (!beat) {
    const res = await service
      .from("beats")
      .select("id, audio_path, metadata, source, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    beat = res.data as Record<string, unknown> | null;
  }
  return beat;
}

export async function GET(req: Request, ctx: Ctx) {
  const { id: projectId } = await ctx.params;
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const downloadStem = (url.searchParams.get("download") || "").toLowerCase().trim();

  const beat = await loadBeat(projectId, user.id);
  if (!beat) {
    return NextResponse.json({ stems: [], canDownload: false, message: "No beat yet" });
  }

  const beatMeta =
    beat.metadata && typeof beat.metadata === "object"
      ? (beat.metadata as Record<string, unknown>)
      : {};
  const stemsMap =
    beatMeta.stems && typeof beatMeta.stems === "object"
      ? (beatMeta.stems as Record<string, string>)
      : {};

  const paid = await isPaidBeatSubscriber(user.id);

  // Paid download of one stem
  if (downloadStem) {
    if (!paid) {
      return NextResponse.json(
        {
          error: "Stem downloads are included on paid plans. You can still listen for free.",
          code: "STEM_DOWNLOAD_PAID",
          upgrade: true,
        },
        { status: 402 }
      );
    }
    const path = stemsMap[downloadStem];
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "Stem not found" }, { status: 404 });
    }
    try {
      const buffer = await downloadStorageObject(path);
      const ext = path.split(".").pop() || "flac";
      const contentType =
        ext === "mp3"
          ? "audio/mpeg"
          : ext === "wav"
            ? "audio/wav"
            : "audio/flac";
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="ap-${downloadStem}.${ext}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch (e) {
      console.error("[beat/stems] download", e);
      return NextResponse.json({ error: "Could not download stem" }, { status: 500 });
    }
  }

  const stems: Array<{
    id: string;
    label: string;
    color: string;
    listenUrl: string | null;
  }> = [];

  for (const name of STEM_ORDER) {
    const path = stemsMap[name];
    if (!path) continue;
    let listenUrl: string | null = null;
    try {
      listenUrl = await createSignedDownloadUrl(path, 3600);
    } catch (e) {
      console.warn("[beat/stems] sign", name, e);
    }
    stems.push({
      id: name,
      label: STEM_LABEL[name] || name,
      color: STEM_COLOR[name] || "#888",
      listenUrl,
    });
  }

  return NextResponse.json({
    stems,
    canDownload: paid,
    stemsReady: stems.length > 0,
    provider: typeof beatMeta.stems_provider === "string" ? beatMeta.stems_provider : null,
    message: stems.length
      ? paid
        ? "Listen or download each stem."
        : "Listen free. Upgrade to download stems."
      : "Stems are not available for this beat yet.",
  });
}

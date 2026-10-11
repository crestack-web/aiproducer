/**
 * In-flight beat generation lock (one at a time).
 * Ignores jobs older than 8 minutes so hung provider runs do not block the studio.
 */
import { createServiceClient } from "@/lib/supabase/server";

const STALE_MS = 8 * 60 * 1000;

export async function hasInFlightBeatGeneration(userId: string): Promise<boolean> {
  if (!userId) return false;
  const supabase = createServiceClient();
  try {
    const sinceIso = new Date(Date.now() - STALE_MS).toISOString();
    const { data, error } = await supabase
      .from("music_generation_jobs")
      .select("id, created_at, status")
      .eq("user_id", userId)
      .in("status", [
        "CREATED",
        "SUBMITTING",
        "GENERATING",
        "DOWNLOADING",
        "PROCESSING",
      ])
      .gte("created_at", sinceIso)
      .limit(5);
    if (error) {
      console.warn("[beat-quota] in-flight check", error.message);
      return false;
    }
    return (data?.length || 0) > 0;
  } catch {
    return false;
  }
}

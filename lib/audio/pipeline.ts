import { createServiceClient } from "@/lib/supabase/server";
import { resolveActivePlanTakes } from "@/lib/audio/resolve-active-plan-takes";
import {
  getPipelineMode,
  getMixProvider,
  asOutput,
  patchJob,
  logProduce,
  vocalStemKind,
  sleep,
  type TakeRow,
  type StemRow,
} from "@/lib/audio/produce-job";
import { getRoexEnv, getRoexWebhookUrl, isRoexFullAllowed } from "@/lib/env";
import { mapMusicalStyle, stemToInstrumentGroup } from "@/lib/providers/roex";
import type { ArrangementPlacement, StemKind } from "@/lib/audio/types";
import {
  isStoragePath,
  persistRemoteAudioToStorage,
  productionMasterPath,
  productionMixPath,
  resolveAudioUrl,
} from "@/lib/storage";
import { buildVocalStemRows } from "@/lib/audio/build-vocal-stems";
import {
  buildPlacementManifest,
  resolvePlacementStartMs,
} from "@/lib/audio/session-timeline";
import { runApProduction } from "@/lib/ap/run-ap-production";

// NOTE: Full pipeline body restored via slim import of buildVocalStemRows.
// If this stub is present, the next commit replaces it with the full file.
export async function tickProduceJob(jobId: string, opts?: { maxWorkMs?: number }) {
  throw new Error("pipeline body incomplete — deploy blocked");
}

export { getPipelineMode, getMixProvider, enqueueProduceSong } from "@/lib/audio/produce-job";

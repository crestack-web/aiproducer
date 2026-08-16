export { getPipelineMode, getMixProvider, enqueueProduceSong } from "@/lib/audio/produce-job";
export { tickProduceJob } from "@/lib/audio/tick-produce-job";

// NOTE: full implementation is in tick-produce-job via resolveActivePlanTakes.
// This file is the public entry; membership rule is:
// ACTIVE PLAN → selected recording_tasks.id → recordings.task_id

export type {
  VocalSectionType,
  VocalPhrase,
  VocalSection,
  VocalTreatment,
  VocalArrangementMap,
  ArrangementPlan,
  SectionType,
} from "./types";
export { detectVocalSections, buildArrangementPlan } from "./section-map";
export { treatmentFor } from "./treatments";
export { applySectionAutomation } from "./apply-section-automation";
export {
  detectVocalActivity,
  PHRASE_MIN_MS,
  PHRASE_MERGE_GAP_MS,
  ACTIVITY_HOLD_MS,
} from "../analysis/vocal-structure";

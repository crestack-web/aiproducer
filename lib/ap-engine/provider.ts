import type { ApProduceInput, ApProduceResult, ApProduceFailure, StageReporter } from "./types";

/**
 * Production provider abstraction (AP Phase 1).
 * Internal engine is default; RoEx may implement optionally later.
 */
export interface AudioProductionProvider {
  readonly name: string;
  produce(input: ApProduceInput, report?: StageReporter): Promise<ApProduceResult | ApProduceFailure>;
}

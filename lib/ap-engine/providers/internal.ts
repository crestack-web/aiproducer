import { runApProduction } from "../index";
import type { AudioProductionProvider } from "../provider";
import type { ApProduceFailure, ApProduceInput, ApProduceResult, StageReporter } from "../types";

export class InternalAPProvider implements AudioProductionProvider {
  readonly name = "ap-internal";

  produce(
    input: ApProduceInput,
    report?: StageReporter
  ): Promise<ApProduceResult | ApProduceFailure> {
    return runApProduction(input, report);
  }
}

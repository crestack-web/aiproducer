/**
 * Optional RoEx provider stub — not used on the default Produce path.
 * Kept so the architecture can re-enable external mix later without coupling.
 */
import type { AudioProductionProvider } from "../provider";
import type { ApProduceFailure, ApProduceInput, StageReporter } from "../types";
import { AP_ENGINE_VERSION } from "../types";

export class OptionalRoexProvider implements AudioProductionProvider {
  readonly name = "roex-optional";

  async produce(
    _input: ApProduceInput,
    _report?: StageReporter
  ): Promise<ApProduceFailure> {
    return {
      ok: false,
      stage: "failed",
      error: "RoEx is optional and disabled on the default production path",
      detail: "Use InternalAPProvider",
      engineVersion: AP_ENGINE_VERSION,
    };
  }
}

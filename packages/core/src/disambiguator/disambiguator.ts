import { validateDisambiguatorOutput } from '@wo-agent/schemas';
import type { DisambiguatorInput, DisambiguatorOutput } from '@wo-agent/schemas';
import type { MetricsRecorder } from '../observability/types.js';

/**
 * Internal result wrapper — adds isFailSafe flag for the handler.
 * DisambiguatorOutput (schema-locked) stays clean; this is control-plane only.
 */
export interface DisambiguatorCallResult {
  readonly classification: DisambiguatorOutput['classification'];
  readonly reasoning: string;
  readonly isFailSafe: boolean;
}

type LlmDisambiguatorFn = (input: DisambiguatorInput, ...rest: unknown[]) => Promise<unknown>;

const FAIL_SAFE_RESULT: DisambiguatorCallResult = {
  classification: 'clarification',
  reasoning: 'fail-safe',
  isFailSafe: true,
};

/**
 * Call the MessageDisambiguator LLM tool with schema validation and one retry (spec §2.3).
 *
 * NEVER THROWS. On any failure (LLM exception, schema validation failure after retry),
 * returns a fail-safe result with classification='clarification' and isFailSafe=true.
 * The handler uses isFailSafe to fall back to the heuristic instead of trusting the
 * classification, so LLM failure cannot suppress currently-detected new issues.
 *
 * Flow:
 * 1. Call LLM function
 * 2. Validate output against disambiguator.schema.json
 * 3. On validation failure: retry once with same input
 * 4. On second failure: return fail-safe (clarification)
 * 5. On LLM exception: return fail-safe (clarification) immediately
 */
export async function callDisambiguator(
  input: DisambiguatorInput,
  llmCall: LlmDisambiguatorFn,
  metricsRecorder?: MetricsRecorder,
  ...rest: unknown[]
): Promise<DisambiguatorCallResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await llmCall(input, ...rest);
    } catch {
      // LLM exception — fail safe immediately, no retry.
      // llm_call_error_total is already emitted by withObservedLlmCall wrapper.
      return FAIL_SAFE_RESULT;
    }

    const validation = validateDisambiguatorOutput(raw);
    if (!validation.valid) {
      await metricsRecorder?.record({
        metric_name: 'schema_validation_failure_total',
        metric_value: 1,
        component: 'disambiguator',
        conversation_id: input.conversation_id,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const output = validation.data!;
    return {
      classification: output.classification,
      reasoning: output.reasoning,
      isFailSafe: false,
    };
  }

  // Both attempts failed schema validation — fail safe
  return FAIL_SAFE_RESULT;
}

import type { FollowUpGeneratorInput, FollowUpGeneratorOutput, FollowUpQuestion } from '@wo-agent/schemas';
import { validateFollowUpOutput } from '@wo-agent/schemas';
import { truncateQuestions } from './caps.js';

export enum FollowUpGeneratorErrorCode {
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  LLM_CALL_FAILED = 'LLM_CALL_FAILED',
}

export class FollowUpGeneratorError extends Error {
  constructor(
    public readonly code: FollowUpGeneratorErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FollowUpGeneratorError';
  }
}

export interface FollowUpGeneratorResult {
  readonly status: 'ok' | 'llm_fail';
  readonly output?: FollowUpGeneratorOutput;
  readonly error?: string;
}

type LlmFollowUpFn = (
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
) => Promise<unknown>;

/**
 * Call the FollowUpGenerator LLM tool with schema validation pipeline.
 *
 * Pipeline: LLM call → schema validate → filter ineligible fields → truncate to budget → accept
 * Schema failure: one retry with error context → llm_fail
 * LLM exception: throw immediately
 *
 * @param input - validated FollowUpGeneratorInput
 * @param llmCall - the raw LLM function
 * @param remainingBudget - max questions this turn (from caps check)
 */
export async function callFollowUpGenerator(
  input: FollowUpGeneratorInput,
  llmCall: LlmFollowUpFn,
  remainingBudget: number,
): Promise<FollowUpGeneratorResult> {
  const eligibleFields = new Set(input.fields_needing_input);
  let validated: FollowUpGeneratorOutput | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await llmCall(
        input,
        attempt > 0 ? { retryHint: 'schema_errors' } : undefined,
      );
    } catch (err) {
      throw new FollowUpGeneratorError(
        FollowUpGeneratorErrorCode.LLM_CALL_FAILED,
        `FollowUpGenerator LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const schemaResult = validateFollowUpOutput(raw);
    if (!schemaResult.valid) {
      lastError = schemaResult.errors;
      continue;
    }

    validated = schemaResult.data!;
    break;
  }

  if (validated === null) {
    return {
      status: 'llm_fail',
      error: `FollowUpGenerator output failed schema validation after retry: ${JSON.stringify(lastError)}`,
    };
  }

  // Filter out questions targeting fields not in fields_needing_input
  const filteredQuestions = validated.questions.filter(
    (q) => eligibleFields.has(q.field_target),
  );

  // Truncate to remaining budget (spec §15: max 3 per turn)
  const finalQuestions = truncateQuestions(filteredQuestions, remainingBudget);

  return {
    status: 'ok',
    output: { questions: finalQuestions as FollowUpQuestion[] },
  };
}

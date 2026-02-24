import { validateIssueSplitterOutput } from '@wo-agent/schemas';
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';

export enum SplitterErrorCode {
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  LLM_CALL_FAILED = 'LLM_CALL_FAILED',
  ISSUE_COUNT_MISMATCH = 'ISSUE_COUNT_MISMATCH',
}

export class SplitterError extends Error {
  constructor(
    public readonly code: SplitterErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SplitterError';
  }
}

type LlmSplitterFn = (input: IssueSplitterInput) => Promise<unknown>;

/**
 * Call the IssueSplitter LLM tool with schema validation and one retry (spec §2.3).
 *
 * Flow:
 * 1. Call LLM function
 * 2. Validate output against issue_split.schema.json
 * 3. Validate issue_count matches issues.length
 * 4. On validation failure: retry once with same input
 * 5. On second failure: throw SplitterError
 * 6. On LLM exception: throw SplitterError immediately (no retry)
 */
export async function callIssueSplitter(
  input: IssueSplitterInput,
  llmCall: LlmSplitterFn,
): Promise<IssueSplitterOutput> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await llmCall(input);
    } catch (err) {
      throw new SplitterError(
        SplitterErrorCode.LLM_CALL_FAILED,
        `IssueSplitter LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const validation = validateIssueSplitterOutput(raw);
    if (!validation.valid) {
      lastError = validation.errors;
      continue;
    }

    const output = validation.data!;

    // Semantic validation: issue_count must match issues array length
    if (output.issue_count !== output.issues.length) {
      lastError = `issue_count (${output.issue_count}) does not match issues.length (${output.issues.length})`;
      continue;
    }

    return output;
  }

  throw new SplitterError(
    SplitterErrorCode.SCHEMA_VALIDATION_FAILED,
    `IssueSplitter output failed validation after retry: ${JSON.stringify(lastError)}`,
    lastError,
  );
}

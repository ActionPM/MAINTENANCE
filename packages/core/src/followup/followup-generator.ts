import type {
  FollowUpGeneratorInput,
  FollowUpGeneratorOutput,
  FollowUpQuestion,
} from '@wo-agent/schemas';
import { taxonomy, validateFollowUpOutput, taxonomyConstraints } from '@wo-agent/schemas';
import { resolveValidOptions } from '../classifier/constraint-resolver.js';
import { truncateQuestions } from './caps.js';
import type { MetricsRecorder, ObservabilityContext } from '../observability/types.js';
import { selectFollowUpFrontierFields } from './field-ordering.js';

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
  ...rest: unknown[]
) => Promise<unknown>;

const DEFAULT_FALLBACK_OPTIONS: Partial<Record<string, readonly string[]>> = {
  Category: taxonomy.Category,
  Location: taxonomy.Location,
  Sub_Location: taxonomy.Sub_Location,
  Maintenance_Category: taxonomy.Maintenance_Category,
  Maintenance_Object: taxonomy.Maintenance_Object,
  Maintenance_Problem: taxonomy.Maintenance_Problem,
  Management_Category: taxonomy.Management_Category,
  Management_Object: taxonomy.Management_Object,
  Priority: taxonomy.Priority,
};

function buildFallbackQuestion(field: string, input: FollowUpGeneratorInput): FollowUpQuestion {
  const validOptions = resolveValidOptions(field, input.classification, taxonomyConstraints);
  const options = validOptions ?? DEFAULT_FALLBACK_OPTIONS[field] ?? [];

  switch (field) {
    case 'Category':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-category`,
        field_target: field,
        prompt: 'Is this a maintenance issue or a management issue?',
        options,
        answer_type: 'enum',
      };
    case 'Location':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-location`,
        field_target: field,
        prompt: 'Where is this issue located?',
        options,
        answer_type: 'enum',
      };
    case 'Sub_Location':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-sub-location`,
        field_target: field,
        prompt: 'Which room or area is this in?',
        options,
        answer_type: 'enum',
      };
    case 'Maintenance_Category':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-maintenance-category`,
        field_target: field,
        prompt: 'What kind of maintenance issue is this?',
        options,
        answer_type: 'enum',
      };
    case 'Maintenance_Object':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-maintenance-object`,
        field_target: field,
        prompt:
          input.classification[field] === 'needs_object'
            ? 'What item or fixture is affected?'
            : 'Which item or fixture is affected?',
        options,
        answer_type: 'enum',
      };
    case 'Maintenance_Problem':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-maintenance-problem`,
        field_target: field,
        prompt: 'What is the problem with it?',
        options,
        answer_type: 'enum',
      };
    case 'Management_Category':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-management-category`,
        field_target: field,
        prompt: 'What type of management issue is this?',
        options,
        answer_type: 'enum',
      };
    case 'Management_Object':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-management-object`,
        field_target: field,
        prompt:
          input.classification[field] === 'needs_object'
            ? 'What is this about specifically?'
            : 'Which item or topic is this about?',
        options,
        answer_type: 'enum',
      };
    case 'Priority':
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-priority`,
        field_target: field,
        prompt: 'How urgent is this issue?',
        options,
        answer_type: 'enum',
      };
    default:
      return {
        question_id: `fallback-${input.issue_id}-${input.turn_number}-${field.toLowerCase()}`,
        field_target: field,
        prompt: `Please provide more detail for ${field}.`,
        options: [],
        answer_type: 'text',
      };
  }
}

function buildDeterministicFallbackQuestions(
  input: FollowUpGeneratorInput,
  frontierFields: readonly string[],
): FollowUpQuestion[] {
  return frontierFields.length > 0 ? [buildFallbackQuestion(frontierFields[0], input)] : [];
}

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
  metricsRecorder?: MetricsRecorder,
  obsCtx?: ObservabilityContext,
): Promise<FollowUpGeneratorResult> {
  const frontierFields = selectFollowUpFrontierFields(
    input.fields_needing_input,
    input.classification,
  );
  if (frontierFields.length === 0) {
    return {
      status: 'ok',
      output: { questions: [] },
    };
  }

  const narrowedInput: FollowUpGeneratorInput = {
    ...input,
    fields_needing_input: frontierFields,
  };

  const eligibleFields = new Set(frontierFields);
  let validated: FollowUpGeneratorOutput | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = obsCtx
        ? await llmCall(
            narrowedInput,
            attempt > 0 ? { retryHint: 'schema_errors' } : undefined,
            obsCtx,
          )
        : await llmCall(narrowedInput, attempt > 0 ? { retryHint: 'schema_errors' } : undefined);
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
      await metricsRecorder?.record({
        metric_name: 'schema_validation_failure_total',
        metric_value: 1,
        component: 'followup_generator',
        request_id: obsCtx?.request_id,
        tags: { issue_id: input.issue_id },
        timestamp: new Date().toISOString(),
      });
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
  const filteredQuestions = validated.questions.filter((q) => eligibleFields.has(q.field_target));

  // Filter question options to taxonomy-valid values only (BUG-011 Fix A).
  // Enum questions ALWAYS get taxonomy-valid options. No raw LLM options survive.
  // Dropped questions are rebuilt per-field from the deterministic fallback.
  const droppedFields: string[] = [];
  const constraintFiltered = filteredQuestions
    .map((q) => {
      // Non-enum questions (text, yes_no) don't have taxonomy-bound options.
      if (q.answer_type !== 'enum') return q;

      const valid = resolveValidOptions(
        q.field_target,
        narrowedInput.classification,
        taxonomyConstraints,
      );

      if (valid !== null) {
        // Constrained field: keep only constraint-valid LLM options.
        const opts = q.options.filter((opt) => valid.includes(opt));
        if (opts.length > 0) return { ...q, options: opts };
        // All LLM options hallucinated — replace with constraint-valid values.
        return { ...q, options: valid.slice(0, 10) };
      }

      // Unconstrained field: filter against full-taxonomy defaults to prevent
      // LLM paraphrases (e.g., "In my apartment unit" instead of "suite") from
      // being posted as answers and pinned as non-taxonomy values.
      const taxonomyDefaults = DEFAULT_FALLBACK_OPTIONS[q.field_target];
      if (taxonomyDefaults) {
        const opts = q.options.filter((opt) => taxonomyDefaults.includes(opt));
        if (opts.length > 0) return { ...q, options: opts };
        return { ...q, options: [...taxonomyDefaults].slice(0, 10) };
      }

      // No canonical option source — track the field for deterministic rebuild.
      droppedFields.push(q.field_target);
      return null;
    })
    .filter((q): q is NonNullable<typeof q> => q !== null);

  // Rebuild deterministic questions for any dropped fields still in the frontier.
  const survivingFields = new Set(constraintFiltered.map((q) => q.field_target));
  for (const field of droppedFields) {
    if (!survivingFields.has(field)) {
      constraintFiltered.push(buildFallbackQuestion(field, narrowedInput));
      survivingFields.add(field);
    }
  }

  // Truncate to remaining budget (spec §15: max 3 per turn)
  const finalQuestions = truncateQuestions(constraintFiltered, remainingBudget);
  if (finalQuestions.length === 0) {
    return {
      status: 'ok',
      output: {
        questions: buildDeterministicFallbackQuestions(narrowedInput, frontierFields),
      },
    };
  }

  return {
    status: 'ok',
    output: { questions: finalQuestions as FollowUpQuestion[] },
  };
}

import type { IssueClassifierInput, IssueClassifierOutput, Taxonomy } from '@wo-agent/schemas';
import { validateClassifierOutput, validateClassificationAgainstTaxonomy } from '@wo-agent/schemas';
import type { MetricsRecorder, ObservabilityContext } from '../observability/types.js';
import { ClassifierTriageReason } from './triage-routing.js';

export enum ClassifierErrorCode {
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  LLM_CALL_FAILED = 'LLM_CALL_FAILED',
  TAXONOMY_VALIDATION_FAILED = 'TAXONOMY_VALIDATION_FAILED',
}

export class ClassifierError extends Error {
  constructor(
    public readonly code: ClassifierErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ClassifierError';
  }
}

export interface ClassifierResult {
  readonly status: 'ok' | 'llm_fail' | 'needs_human_triage';
  readonly output?: IssueClassifierOutput;
  /** Both attempts stored for audit when needs_human_triage */
  readonly conflicting?: readonly IssueClassifierOutput[];
  readonly error?: string;
  readonly triage_reason?: ClassifierTriageReason;
}

export type LlmClassifierFn = (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
  ...rest: unknown[]
) => Promise<unknown>;

/**
 * Call the IssueClassifier LLM tool with full validation pipeline.
 *
 * Pipeline: LLM call -> schema validate -> taxonomy validate -> category gating check
 *           -> accept or retry(1x per failure type) -> fail safe
 *
 * - Parse/schema failure: one retry with error context
 * - Domain failure (contradictory gating): one constrained retry -> needs_human_triage
 * - LLM exception: throw immediately (no retry)
 */
export async function callIssueClassifier(
  input: IssueClassifierInput,
  llmCall: LlmClassifierFn,
  taxonomy: Taxonomy,
  taxonomyVersion?: string,
  metricsRecorder?: MetricsRecorder,
  obsCtx?: ObservabilityContext,
): Promise<ClassifierResult> {
  // --- Phase 1: Schema + taxonomy value validation with one retry ---
  let validated: IssueClassifierOutput | null = null;
  let lastSchemaError: unknown;
  let lastRaw: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      let retryHint = 'schema_errors';
      const hasNeedsObjectMisplacement =
        // Taxonomy validation error format (pre-enum schema)
        (Array.isArray(lastSchemaError) &&
          lastSchemaError.some(
            (e: Record<string, unknown>) =>
              e.field === 'Maintenance_Problem' && e.value === 'needs_object',
          )) ||
        // Schema enum validation: check the raw data for the misplaced value
        (lastRaw != null &&
          typeof lastRaw === 'object' &&
          'classification' in lastRaw &&
          (lastRaw as Record<string, Record<string, unknown>>).classification
            ?.Maintenance_Problem === 'needs_object');
      if (hasNeedsObjectMisplacement) {
        retryHint =
          'schema_errors — "needs_object" is only valid for the Maintenance_Object field, not Maintenance_Problem. Use "other_problem" or "not_working" for Maintenance_Problem.';
      }
      raw = obsCtx
        ? await llmCall(input, attempt > 0 ? { retryHint } : undefined, obsCtx)
        : await llmCall(input, attempt > 0 ? { retryHint } : undefined);
    } catch (err) {
      throw new ClassifierError(
        ClassifierErrorCode.LLM_CALL_FAILED,
        `IssueClassifier LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    // Schema validation
    const schemaResult = validateClassifierOutput(raw);
    if (!schemaResult.valid) {
      lastSchemaError = schemaResult.errors;
      lastRaw = raw;
      await metricsRecorder?.record({
        metric_name: 'schema_validation_failure_total',
        metric_value: 1,
        component: 'classifier',
        request_id: obsCtx?.request_id,
        tags: { issue_id: input.issue_id },
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    // Taxonomy domain validation (values exist in taxonomy.json)
    const domainResult = validateClassificationAgainstTaxonomy(
      schemaResult.data!.classification,
      taxonomy,
      taxonomyVersion,
    );
    if (domainResult.invalidValues.length > 0) {
      lastSchemaError = domainResult.invalidValues;
      lastRaw = raw;
      await metricsRecorder?.record({
        metric_name: 'schema_validation_failure_total',
        metric_value: 1,
        component: 'classifier',
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
      error: `IssueClassifier output failed schema/taxonomy validation after retry: ${JSON.stringify(lastSchemaError)}`,
      triage_reason: ClassifierTriageReason.SCHEMA_VALIDATION_RETRY_FAILED,
    };
  }

  // --- Phase 2: Category gating check (spec 5.3) ---
  const gatingResult = validateClassificationAgainstTaxonomy(
    validated.classification,
    taxonomy,
    taxonomyVersion,
  );

  if (!gatingResult.contradictory) {
    // No contradiction -- accept
    return { status: 'ok', output: validated };
  }

  // Contradictory -- one constrained retry
  const category = validated.classification['Category'];
  const constraint =
    category === 'management'
      ? 'Set all maintenance-domain fields (Maintenance_Category, Maintenance_Object, Maintenance_Problem) to their not-applicable equivalents.'
      : 'Set all management-domain fields (Management_Category, Management_Object) to their not-applicable equivalents.';

  let retryRaw: unknown;
  try {
    retryRaw = obsCtx
      ? await llmCall(input, { retryHint: 'domain_constraint', constraint }, obsCtx)
      : await llmCall(input, { retryHint: 'domain_constraint', constraint });
  } catch {
    return {
      status: 'needs_human_triage',
      conflicting: [validated],
      error: 'LLM call failed on category gating retry',
      triage_reason: ClassifierTriageReason.CATEGORY_GATING_RETRY_FAILED,
    };
  }

  // Validate retry output through full pipeline
  const retrySchema = validateClassifierOutput(retryRaw);
  if (!retrySchema.valid) {
    await metricsRecorder?.record({
      metric_name: 'schema_validation_failure_total',
      metric_value: 1,
      component: 'classifier',
      request_id: obsCtx?.request_id,
      tags: { issue_id: input.issue_id },
      timestamp: new Date().toISOString(),
    });
    return {
      status: 'needs_human_triage',
      conflicting: [validated],
      error: 'Category gating retry failed schema validation',
      triage_reason: ClassifierTriageReason.CATEGORY_GATING_RETRY_FAILED,
    };
  }

  const retryTaxonomy = validateClassificationAgainstTaxonomy(
    retrySchema.data!.classification,
    taxonomy,
    taxonomyVersion,
  );
  if (retryTaxonomy.invalidValues.length > 0 || retryTaxonomy.contradictory) {
    // Still contradictory after retry -- needs human triage (spec 5.3 step 3)
    return {
      status: 'needs_human_triage',
      conflicting: [validated, retrySchema.data!],
      error: 'Category gating still contradictory after constrained retry',
      triage_reason: ClassifierTriageReason.CATEGORY_GATING_RETRY_FAILED,
    };
  }

  return { status: 'ok', output: retrySchema.data! };
}

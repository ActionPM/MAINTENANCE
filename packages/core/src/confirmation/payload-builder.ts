import { createHash } from 'node:crypto';
import type { SplitIssue } from '@wo-agent/schemas';
import type { IssueClassificationResult } from '../session/types.js';

export interface ConfirmationIssue {
  readonly issue_id: string;
  readonly summary: string;
  readonly raw_excerpt: string;
  readonly classification: Record<string, string>;
  readonly confidence_by_field: Record<string, number>;
  readonly missing_fields: readonly string[];
  readonly needs_human_triage: boolean;
}

export interface ConfirmationPayload {
  readonly issues: readonly ConfirmationIssue[];
}

/**
 * Build the tenant-facing confirmation payload from session state.
 * One confirmation issue per split issue, enriched with classification data.
 * If a classification result is missing for an issue, mark it as needs_human_triage.
 */
export function buildConfirmationPayload(
  splitIssues: readonly SplitIssue[],
  classificationResults: readonly IssueClassificationResult[],
): ConfirmationPayload {
  const resultMap = new Map(classificationResults.map(r => [r.issue_id, r]));

  const issues: ConfirmationIssue[] = splitIssues.map(issue => {
    const result = resultMap.get(issue.issue_id);
    if (!result) {
      return {
        issue_id: issue.issue_id,
        summary: issue.summary,
        raw_excerpt: issue.raw_excerpt,
        classification: {},
        confidence_by_field: {},
        missing_fields: [],
        needs_human_triage: true,
      };
    }

    return {
      issue_id: issue.issue_id,
      summary: issue.summary,
      raw_excerpt: issue.raw_excerpt,
      classification: { ...result.classifierOutput.classification },
      confidence_by_field: { ...result.computedConfidence },
      missing_fields: [...result.classifierOutput.missing_fields],
      needs_human_triage: result.classifierOutput.needs_human_triage,
    };
  });

  return { issues };
}

/**
 * Compute a deterministic hash of content for staleness comparison.
 * Uses SHA-256, returns hex string.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

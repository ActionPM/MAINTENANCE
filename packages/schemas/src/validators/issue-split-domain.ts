import type { IssueSplitterOutput } from '../types/issue-split.js';

export interface IssueSplitDomainValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateIssueSplitDomain(
  output: IssueSplitterOutput,
): IssueSplitDomainValidationResult {
  const errors: string[] = [];

  if (output.issue_count !== output.issues.length) {
    errors.push(
      `issue_count (${output.issue_count}) does not equal issues.length (${output.issues.length})`,
    );
  }

  return { valid: errors.length === 0, errors };
}

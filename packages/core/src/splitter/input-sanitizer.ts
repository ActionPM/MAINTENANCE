const MAX_ISSUE_TEXT_CHARS = 500;
const MAX_ISSUES_PER_CONVERSATION = 10;

/**
 * Sanitize tenant-provided issue text (spec §13):
 * - Strip control chars (except space)
 * - Replace newlines/tabs with spaces
 * - Normalize consecutive whitespace
 * - Escape HTML entities
 * - Trim
 * - Truncate to maxLength
 */
export function sanitizeIssueText(text: string, maxLength = MAX_ISSUE_TEXT_CHARS): string {
  let sanitized = text
    // Strip control characters (U+0000–U+001F, U+007F–U+009F) except space (0x20)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, (ch) => (ch === '\n' || ch === '\t' || ch === '\r' ? ' ' : ''))
    // Normalize consecutive whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Escape HTML entities
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Truncate
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

export interface IssueConstraintResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Validate issue text and count constraints (spec §13, §8):
 * - Text must not be empty after sanitization
 * - Text must not exceed 500 chars
 * - Total issues must not exceed 10
 */
export function validateIssueConstraints(
  text: string,
  currentIssueCount: number,
): IssueConstraintResult {
  if (text.trim().length === 0) {
    return { valid: false, error: 'Issue text must not be empty' };
  }
  if (text.length > MAX_ISSUE_TEXT_CHARS) {
    return { valid: false, error: `Issue text must not exceed ${MAX_ISSUE_TEXT_CHARS} characters` };
  }
  if (currentIssueCount >= MAX_ISSUES_PER_CONVERSATION) {
    return { valid: false, error: `Cannot exceed ${MAX_ISSUES_PER_CONVERSATION} issues per conversation` };
  }
  return { valid: true };
}

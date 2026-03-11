import { createHash } from 'node:crypto';

/**
 * Redact sensitive info from a regression candidate before storing.
 * - Hashes conversation_id
 * - Replaces potential PII patterns in issue_text
 */
export function redactCandidate(candidate: {
  conversation_id: string;
  issue_text?: string;
  [key: string]: unknown;
}): typeof candidate {
  const hashed_id = createHash('sha256')
    .update(candidate.conversation_id)
    .digest('hex')
    .slice(0, 16);

  let redactedText = candidate.issue_text;
  if (redactedText) {
    // Redact potential unit numbers (e.g., "unit 302", "apt 4B")
    redactedText = redactedText.replace(
      /\b(unit|apt|suite|room)\s*#?\s*\d+[A-Za-z]?\b/gi,
      '[UNIT]',
    );
    // Redact phone numbers
    redactedText = redactedText.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    // Redact email addresses
    redactedText = redactedText.replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, '[EMAIL]');
    // Redact names after "my name is" or "I'm"
    redactedText = redactedText.replace(
      /(?:my name is|I'm|I am)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g,
      '[NAME]',
    );
  }

  return {
    ...candidate,
    conversation_id: `redacted-${hashed_id}`,
    issue_text: redactedText,
  };
}

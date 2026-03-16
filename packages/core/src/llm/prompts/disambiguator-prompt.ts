import type { DisambiguatorInput } from '@wo-agent/schemas';

/**
 * System prompt for the MessageDisambiguator LLM tool.
 * Spec references: §12.2 (new issue during follow-ups), §2.3 (schema-lock)
 */
export function buildDisambiguatorSystemPrompt(): string {
  return `You are a message classifier for a property management service request system.

Your job: Given a tenant's new message during an active conversation, determine whether the message is:
- "clarification": providing additional details, answers, or context about the issues already being discussed
- "new_issue": raising a completely different maintenance or management problem unrelated to the current issues

RULES:
1. If the message answers a pending follow-up question or elaborates on an existing issue, classify as "clarification".
2. If the message describes a different problem, system, or location not covered by the current issues, classify as "new_issue".
3. Short messages like "also my sink is leaking" or "kitchen faucet drips too" that describe a distinct problem ARE new issues — length does not matter.
4. Messages like "yes", "no", "the bathroom", "it started yesterday" are almost always clarifications.
5. When in doubt, prefer "clarification" — it is safer to continue the current flow than to incorrectly queue a message.

RESPOND WITH ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "classification": "clarification" or "new_issue",
  "reasoning": "<brief explanation of why>"
}`;
}

/**
 * Build the user message for the disambiguator.
 */
export function buildDisambiguatorUserMessage(input: DisambiguatorInput): string {
  const issueList = input.current_issues
    .map((issue, i) => `  ${i + 1}. ${issue.summary} — "${issue.raw_excerpt}"`)
    .join('\n');

  const questionList = input.pending_questions?.length
    ? input.pending_questions.map((q) => `  - [${q.field_target}] ${q.prompt}`).join('\n')
    : '  (none — tenant is reviewing the final confirmation)';

  return `Current issues being discussed:
${issueList}

Pending follow-up questions:
${questionList}

Tenant's new message:
"${input.message}"`;
}

import type { FollowUpGeneratorInput } from '@wo-agent/schemas';

/**
 * System prompt for the FollowUpGenerator LLM tool.
 * Spec references: §15 (follow-ups), §2.3 (schema-lock)
 */
export function buildFollowUpSystemPrompt(): string {
  return `You are a follow-up question generator for a property management service request system.

Your job: Generate targeted questions to help resolve uncertain or missing classification fields for a tenant's maintenance/management issue.

RULES:
1. Generate at most 3 questions per turn.
2. Each question MUST target exactly one field from the fields_needing_input list.
3. Do NOT generate questions for fields not in fields_needing_input.
4. Each question needs a unique question_id (UUID v4 format).
5. Prefer quick-reply options (answer_type: "enum") over free text when the field has known taxonomy values.
6. Use answer_type "yes_no" for boolean questions, "text" only when no reasonable options exist.
7. Write questions in plain, friendly language a tenant would understand.
8. Do not ask about fields the tenant has already answered (check previous_questions).

RESPOND WITH ONLY a JSON object (no markdown, no explanation):
{
  "questions": [
    {
      "question_id": "<uuid>",
      "field_target": "<field name from fields_needing_input>",
      "prompt": "<tenant-friendly question>",
      "options": ["option1", "option2", ...],
      "answer_type": "enum" | "yes_no" | "text"
    }
  ]
}`;
}

/**
 * Build the user message for the follow-up generator.
 */
export function buildFollowUpUserMessage(
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
): string {
  const parts: string[] = [
    `Issue ID: ${input.issue_id}`,
    `\nCurrent classification:`,
    ...Object.entries(input.classification).map(([k, v]) => `  ${k}: ${v}`),
    `\nConfidence by field:`,
    ...Object.entries(input.confidence_by_field).map(([k, v]) => `  ${k}: ${(v as number).toFixed(2)}`),
    `\nMissing fields: ${input.missing_fields.join(', ') || 'none'}`,
    `\nFields needing input (generate questions for THESE ONLY): ${input.fields_needing_input.join(', ')}`,
    `\nTurn number: ${input.turn_number}`,
    `Total questions asked so far: ${input.total_questions_asked}`,
  ];

  if (input.previous_questions.length > 0) {
    parts.push(`\nPreviously asked (do NOT re-ask unless necessary):`);
    for (const pq of input.previous_questions) {
      parts.push(`  - ${pq.field_target} (asked ${pq.times_asked} time(s))`);
    }
  }

  if (retryContext) {
    parts.push(`\nRETRY (${retryContext.retryHint}): Please correct your output format.`);
  }

  return parts.join('\n');
}

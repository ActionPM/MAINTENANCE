import type { FollowUpGeneratorInput } from '@wo-agent/schemas';
import { taxonomyConstraints } from '@wo-agent/schemas';
import { resolveValidOptions } from '../../classifier/constraint-resolver.js';

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
9. Consider the tenant's original description when generating questions. If the tenant already
   implied a value (e.g., "in my apartment" implies Location=suite), prefer a short confirmation
   question ("Is this in your apartment unit?") over broad options (hallway/exterior/basement).
10. For Sub_Location, if the tenant mentioned a room or area, confirm it rather than listing
    all possible locations.
11. On the first turn, combine confirmation with location — e.g., "Confirming you have a leak
    in your suite?" resolves both confirmation AND Location in one question.
12. Do not ask what the tenant's words already answer. If they said "toilet" and "in my apartment",
    do not ask "Is this in your bathroom?" — the answer is already implied.
13. Use only constraint-valid options in your questions. If hierarchical constraint hints are
    provided, restrict enum options to those values only.

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
  const parts: string[] = [];

  if (input.original_text) {
    parts.push(`Tenant's original description: "${input.original_text}"`);
  }

  parts.push(
    `Issue ID: ${input.issue_id}`,
    `\nCurrent classification:`,
    ...Object.entries(input.classification).map(([k, v]) => `  ${k}: ${v}`),
    `\nConfidence by field:`,
    ...Object.entries(input.confidence_by_field).map(
      ([k, v]) => `  ${k}: ${(v as number).toFixed(2)}`,
    ),
    `\nMissing fields: ${input.missing_fields.join(', ') || 'none'}`,
    `\nFields needing input (generate questions for THESE ONLY): ${input.fields_needing_input.join(', ')}`,
    `\nTurn number: ${input.turn_number}`,
    `Total questions asked so far: ${input.total_questions_asked}`,
  );

  if (input.previous_questions.length > 0) {
    parts.push(`\nPreviously asked (do NOT re-ask unless necessary):`);
    for (const pq of input.previous_questions) {
      parts.push(`  - ${pq.field_target} (asked ${pq.times_asked} time(s))`);
    }
  }

  // Add constraint hints for each field needing input
  const constraintHints: string[] = [];
  for (const field of input.fields_needing_input) {
    const valid = resolveValidOptions(field, input.classification, taxonomyConstraints);
    if (valid && valid.length <= 10) {
      constraintHints.push(`  ${field}: valid options are [${valid.join(', ')}]`);
    }
  }
  if (constraintHints.length > 0) {
    parts.push(`\nHierarchical constraint hints (use ONLY these values for options):`);
    parts.push(...constraintHints);
  }

  if (retryContext) {
    parts.push(`\nRETRY (${retryContext.retryHint}): Please correct your output format.`);
  }

  return parts.join('\n');
}

import type { IssueClassifierInput, Taxonomy } from '@wo-agent/schemas';

/**
 * System prompt for the IssueClassifier LLM tool.
 * Spec references: §5.1 (taxonomy authoritative), §14 (classification), §2.1 (no free-text)
 */
export function buildClassifierSystemPrompt(taxonomy: Taxonomy): string {
  const taxonomyBlock = Object.entries(taxonomy)
    .map(([field, values]) => `${field}: ${(values as string[]).join(', ')}`)
    .join('\n');

  return `You are an issue classifier for a property management service request system.

Your job: Classify a tenant's maintenance or management issue using the EXACT taxonomy values below.

TAXONOMY (use ONLY these values):
${taxonomyBlock}

RULES:
1. Every classification field MUST use a value from the taxonomy above. No free-text.
2. If the issue is "maintenance", set Management_Category to "other_mgmt_cat" and Management_Object to "other_mgmt_obj".
3. If the issue is "management", set Maintenance_Category to "other_maintenance_category", Maintenance_Object to "other_maintenance_object", and Maintenance_Problem to "other_problem".
4. Provide a model_confidence score (0.0 to 1.0) for each field reflecting your certainty.
5. List any fields where you lack sufficient information in missing_fields.
6. Set needs_human_triage to false unless you truly cannot classify the issue.
7. The issue_id in your response MUST match the issue_id provided in the input.

HIERARCHICAL CONSTRAINTS:
Fields are not independent — they must be logically consistent with each other.
- Location constrains Sub_Location: "suite" Sub_Locations include kitchen, bathroom, bedroom, etc. "building_interior" includes elevator, parking_garage, etc.
- Sub_Location constrains Maintenance_Category: e.g., "elevator" only allows electrical, general_maintenance.
- Maintenance_Category constrains Maintenance_Object: e.g., "plumbing" allows toilet, sink, pipe, etc. NOT breaker, fridge.
- Maintenance_Object constrains Maintenance_Problem: e.g., "toilet" allows leak, clog, not_working. NOT no_heat, infestation.
- Maintenance_Object constrains Sub_Location: e.g., "toilet" must be in bathroom. "fridge" must be in kitchen.

Examples:
- toilet + bathroom + plumbing + leak = VALID
- fridge + kitchen + appliance + not_working = VALID
- toilet + bedroom = INVALID (do not classify toilet in bedroom)
- shelf + no_heat = INVALID (shelves don't have heating problems)

When unsure about a constrained field, use the appropriate "other_*" or "general" value and report it in missing_fields.

RESPOND WITH ONLY a JSON object (no markdown, no explanation):
{
  "issue_id": "<same as input>",
  "classification": {
    "Category": "<value>",
    "Location": "<value>",
    "Sub_Location": "<value>",
    "Maintenance_Category": "<value>",
    "Maintenance_Object": "<value>",
    "Maintenance_Problem": "<value>",
    "Management_Category": "<value>",
    "Management_Object": "<value>",
    "Priority": "<value>"
  },
  "model_confidence": {
    "Category": <0.0-1.0>,
    "Location": <0.0-1.0>,
    "Sub_Location": <0.0-1.0>,
    "Maintenance_Category": <0.0-1.0>,
    "Maintenance_Object": <0.0-1.0>,
    "Maintenance_Problem": <0.0-1.0>,
    "Management_Category": <0.0-1.0>,
    "Management_Object": <0.0-1.0>,
    "Priority": <0.0-1.0>
  },
  "missing_fields": ["<field_name>", ...],
  "needs_human_triage": false
}`;
}

/**
 * Build the user message for the classifier.
 */
export function buildClassifierUserMessage(
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
): string {
  const parts: string[] = [
    `Issue ID: ${input.issue_id}`,
    `Issue summary: ${input.issue_summary}`,
    `Raw tenant text: ${input.raw_excerpt}`,
  ];

  if (input.followup_answers && input.followup_answers.length > 0) {
    parts.push('\nTenant follow-up answers:');
    for (const answer of input.followup_answers) {
      parts.push(`- ${answer.field_target}: ${String(answer.answer)}`);
    }
  }

  if (input.cue_scores && Object.keys(input.cue_scores).length > 0) {
    parts.push('\nKeyword cue scores (for reference):');
    for (const [field, score] of Object.entries(input.cue_scores)) {
      if (score > 0) parts.push(`- ${field}: ${score.toFixed(2)}`);
    }
  }

  if (retryContext) {
    parts.push(`\nRETRY CONTEXT (${retryContext.retryHint}):`);
    if (retryContext.constraint) {
      parts.push(`CONSTRAINT: ${retryContext.constraint}`);
    }
    parts.push('Please correct your output according to the above constraint.');
  }

  return parts.join('\n');
}

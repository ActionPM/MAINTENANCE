import type { IssueClassifierInput, Taxonomy } from '@wo-agent/schemas';
import { compareSemver } from '@wo-agent/schemas';

/** The prompt version boundary for the evidence-based classifier. */
export const EVIDENCE_BASED_PROMPT_VERSION = '2.0.0';

/** The prompt version boundary for Priority guidance (added in 2.1.0). */
export const PRIORITY_GUIDANCE_VERSION = '2.1.0';

/** The prompt version boundary for domain assignment hints (added in 2.2.0). */
export const DOMAIN_HINTS_VERSION = '2.2.0';

/** The prompt version boundary for HVAC classification hints (added in 2.3.0). */
export const HVAC_HINTS_VERSION = '2.3.0';

const DOMAIN_HINTS_BLOCK = `
DOMAIN ASSIGNMENT HINTS:
- Intercom, buzzer, door-entry, and visitor-access issues are management (general/intercom)
  unless the tenant describes a specific electrical repair (e.g., "wires exposed", "sparking").
- Key fob programming, lockout, and room-access issues are management (general/building_access).
- Lock/key issues involving physical damage ("broken lock", "key snapped off") are maintenance (locksmith).`;

const HVAC_HINTS_BLOCK = `
HVAC CLASSIFICATION HINTS:
- When the tenant describes a heating/cooling problem but does not name the specific component,
  set Maintenance_Object to "needs_object" (do NOT omit the field).
- "Baseboard", "baseboard heater", and "heating unit" map to Maintenance_Object "radiator".
- "Furnace", "boiler", and "heating system" indicate Maintenance_Category "hvac" with
  Maintenance_Object "needs_object" unless the tenant names a specific part.
- If the issue is clearly in-unit (e.g., "my heat", "in my apartment"), set Location to "suite"
  and Sub_Location to "general" even without a specific room name.`;

const PRIORITY_GUIDANCE_BLOCK = `
PRIORITY GUIDANCE:
- "emergency": immediate safety risk (fire, gas leak, flooding, structural danger, burning smell)
- "high": significant disruption to habitability (no heat, no hot water, broken lock, major leak, infestation, electrical safety)
- "normal": standard maintenance or management request (dripping faucet, appliance issue, clog, document request)
- "low": cosmetic or non-urgent (paint touch-up, minor wear, scuff)
- Only classify as "emergency" when there is clear evidence of safety risk or uninhabitable conditions.`;

/**
 * System prompt for the IssueClassifier LLM tool (legacy force-fill version).
 * Used for conversations pinned to prompt_version < 2.0.0.
 */
export function buildClassifierSystemPromptV1(
  taxonomy: Taxonomy,
  options?: {
    includePriorityGuidance?: boolean;
    includeDomainHints?: boolean;
    includeHvacHints?: boolean;
  },
): string {
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
${options?.includePriorityGuidance ? PRIORITY_GUIDANCE_BLOCK : ''}${options?.includeDomainHints ? DOMAIN_HINTS_BLOCK : ''}${options?.includeHvacHints ? HVAC_HINTS_BLOCK : ''}
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
 * System prompt for the IssueClassifier LLM tool (v2 — evidence-based).
 * Used for conversations pinned to prompt_version >= 2.0.0.
 *
 * Key changes from v1:
 * - Only assign taxonomy values when the tenant's text provides clear evidence
 * - Omit unsupported fields instead of guessing
 * - Cross-domain fields use "not_applicable" (not other_*)
 * - "needs_object" used intentionally for ambiguous objects
 */
export function buildClassifierSystemPromptV2(
  taxonomy: Taxonomy,
  options?: {
    includePriorityGuidance?: boolean;
    includeDomainHints?: boolean;
    includeHvacHints?: boolean;
  },
): string {
  const taxonomyBlock = Object.entries(taxonomy)
    .map(([field, values]) => `${field}: ${(values as string[]).join(', ')}`)
    .join('\n');

  return `You are an issue classifier for a property management service request system.

Your job: Classify a tenant's maintenance or management issue using the taxonomy values below.
Only assign values that are clearly supported by the tenant's text.

TAXONOMY (valid values):
${taxonomyBlock}

EVIDENCE-BASED CLASSIFICATION RULES:
1. Only assign a taxonomy value when the tenant's text provides clear evidence for it.
2. If the text does not support a field value, OMIT that field from the classification object entirely.
3. Do not guess Location, Sub_Location, or object fields from weak or indirect evidence.
4. A mentioned object does NOT automatically imply a location (e.g., "sink" does not mean Location=suite).
5. All values must come from the taxonomy. No free-text values.

CROSS-DOMAIN NORMALIZATION:
- If the issue is "maintenance", set Management_Category and Management_Object to "not_applicable".
- If the issue is "management", set Maintenance_Category, Maintenance_Object, and Maintenance_Problem to "not_applicable".

NEEDS_OBJECT GUIDANCE:
- Use "needs_object" when the category/problem type is understood but the specific object cannot be identified from the text.
- Do not use "needs_object" as a lazy default — use it only when there genuinely is an object involved but it is ambiguous.${
    options?.includeHvacHints
      ? `
- IMPORTANT: "needs_object" is ONLY valid for the Maintenance_Object field.
  Do NOT use "needs_object" as a value for Maintenance_Problem or any other field.
  If the problem type is unclear, use "other_problem" for Maintenance_Problem.`
      : ''
  }

${options?.includePriorityGuidance ? PRIORITY_GUIDANCE_BLOCK : ''}${options?.includeDomainHints ? DOMAIN_HINTS_BLOCK : ''}${options?.includeHvacHints ? HVAC_HINTS_BLOCK : ''}
MISSING_FIELDS:
- List fields you omitted from classification because the text did not support a value.
- Also list fields where you assigned a value but have low certainty.

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

RESPOND WITH ONLY a JSON object (no markdown, no explanation):
{
  "issue_id": "<same as input>",
  "classification": {
    // Include only fields you can classify with evidence. Omit fields you cannot.
  },
  "model_confidence": {
    // Only include confidence scores for fields present in classification
  },
  "missing_fields": ["<field_name>", ...],
  "needs_human_triage": false
}`;
}

/**
 * Build the system prompt for the classifier, selecting v1 or v2 based on prompt_version.
 * This is the main entry point — all callers should use this.
 */
export function buildClassifierSystemPrompt(taxonomy: Taxonomy, promptVersion?: string): string {
  const includePriorityGuidance =
    !!promptVersion && compareSemver(promptVersion, PRIORITY_GUIDANCE_VERSION) >= 0;
  const includeDomainHints =
    !!promptVersion && compareSemver(promptVersion, DOMAIN_HINTS_VERSION) >= 0;
  const includeHvacHints = !!promptVersion && compareSemver(promptVersion, HVAC_HINTS_VERSION) >= 0;

  if (promptVersion && compareSemver(promptVersion, EVIDENCE_BASED_PROMPT_VERSION) >= 0) {
    return buildClassifierSystemPromptV2(taxonomy, {
      includePriorityGuidance,
      includeDomainHints,
      includeHvacHints,
    });
  }
  return buildClassifierSystemPromptV1(taxonomy, {
    includePriorityGuidance,
    includeDomainHints,
    includeHvacHints,
  });
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
      parts.push('Use "not_applicable" for cross-domain fields instead of "other_*" values.');
    }
    parts.push('Please correct your output according to the above constraint.');
  }

  return parts.join('\n');
}

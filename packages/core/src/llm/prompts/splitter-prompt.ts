/**
 * System prompt for the IssueSplitter LLM tool.
 * Spec references: §2.2 (split first), §13 (splitting), §2.3 (schema-lock)
 */
export function buildSplitterSystemPrompt(): string {
  return `You are an issue splitter for a property management service request system.

Your job: Given a tenant's message, identify each DISTINCT maintenance or management issue mentioned.

RULES:
1. Each distinct issue gets its own entry. "My toilet is leaking and the light is broken" = 2 issues.
2. Related symptoms of one root cause = 1 issue. "Water leaking from ceiling and dripping on floor" = 1 issue (water leak).
3. Generate a unique issue_id (UUID v4 format) for each issue.
4. The summary should be a concise description (under 200 chars) of the issue.
5. The raw_excerpt should be the exact portion of the tenant's text that describes this issue.
6. issue_count MUST equal the length of the issues array.
7. If there is only one issue, still return it as a single-element array.

RESPOND WITH ONLY a JSON object in this exact format (no markdown, no explanation):
{
  "issues": [
    {
      "issue_id": "<uuid>",
      "summary": "<concise description>",
      "raw_excerpt": "<exact text from tenant message>"
    }
  ],
  "issue_count": <number matching issues array length>
}`;
}

/**
 * Build the user message for the splitter.
 */
export function buildSplitterUserMessage(rawText: string): string {
  return `Tenant message:\n\n${rawText}`;
}

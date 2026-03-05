/**
 * Extract a JSON object from an LLM text response.
 *
 * Handles:
 * - Pure JSON responses
 * - JSON wrapped in ```json ... ``` or ``` ... ``` code blocks
 * - JSON embedded in surrounding prose (first { ... } match)
 *
 * Throws if no valid JSON object is found.
 */
export function extractJsonFromResponse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('No JSON found in empty response');

  // Try 1: direct parse (pure JSON)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to other strategies
    }
  }

  // Try 2: extract from markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  // Try 3: find first { ... } balanced braces
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(firstBrace, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('No JSON found in LLM response');
}

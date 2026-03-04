import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import { buildSplitterSystemPrompt, buildSplitterUserMessage } from '../prompts/splitter-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create an IssueSplitter adapter function that calls the real LLM.
 * Returns the raw parsed JSON cast to IssueSplitterOutput — the
 * callIssueSplitter validation pipeline handles actual schema validation
 * and retry logic, so the cast is safe (invalid data is caught downstream).
 */
export function createSplitterAdapter(
  client: LlmClient,
): (input: IssueSplitterInput) => Promise<IssueSplitterOutput> {
  return async (input: IssueSplitterInput): Promise<IssueSplitterOutput> => {
    const response = await client.complete({
      system: buildSplitterSystemPrompt(),
      userMessage: buildSplitterUserMessage(input.raw_text),
      model: input.model_id,
    });
    return extractJsonFromResponse(response) as IssueSplitterOutput;
  };
}

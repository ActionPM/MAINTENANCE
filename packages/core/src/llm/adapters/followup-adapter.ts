import type { FollowUpGeneratorInput } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import { buildFollowUpSystemPrompt, buildFollowUpUserMessage } from '../prompts/followup-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create a FollowUpGenerator adapter function that calls the real LLM.
 * Returns raw parsed JSON — callFollowUpGenerator handles validation,
 * field filtering, budget truncation, and retry logic.
 */
export function createFollowUpAdapter(
  client: LlmClient,
): (
  input: FollowUpGeneratorInput,
  retryContext?: { retryHint: string },
) => Promise<unknown> {
  const systemPrompt = buildFollowUpSystemPrompt();

  return async (
    input: FollowUpGeneratorInput,
    retryContext?: { retryHint: string },
  ): Promise<unknown> => {
    const response = await client.complete({
      system: systemPrompt,
      userMessage: buildFollowUpUserMessage(input, retryContext),
    });
    return extractJsonFromResponse(response);
  };
}

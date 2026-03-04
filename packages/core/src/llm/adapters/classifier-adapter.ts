import type { IssueClassifierInput, Taxonomy } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import { buildClassifierSystemPrompt, buildClassifierUserMessage } from '../prompts/classifier-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create an IssueClassifier adapter function that calls the real LLM.
 * Returns raw parsed JSON — callIssueClassifier handles validation,
 * taxonomy checking, category gating, and retry logic.
 */
export function createClassifierAdapter(
  client: LlmClient,
  taxonomy: Taxonomy,
): (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
) => Promise<unknown> {
  const systemPrompt = buildClassifierSystemPrompt(taxonomy);

  return async (
    input: IssueClassifierInput,
    retryContext?: { retryHint: string; constraint?: string },
  ): Promise<unknown> => {
    const response = await client.complete({
      system: systemPrompt,
      userMessage: buildClassifierUserMessage(input, retryContext),
      model: input.model_id,
    });
    return extractJsonFromResponse(response);
  };
}

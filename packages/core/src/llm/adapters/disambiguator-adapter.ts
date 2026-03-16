import type { DisambiguatorInput, DisambiguatorOutput } from '@wo-agent/schemas';
import type { LlmClient } from '../anthropic-client.js';
import {
  buildDisambiguatorSystemPrompt,
  buildDisambiguatorUserMessage,
} from '../prompts/disambiguator-prompt.js';
import { extractJsonFromResponse } from '../parse-response.js';

/**
 * Create a MessageDisambiguator adapter function that calls the real LLM.
 * Returns raw parsed JSON cast to DisambiguatorOutput — the
 * callDisambiguator validation pipeline handles actual schema validation
 * and retry logic, so the cast is safe (invalid data is caught downstream).
 */
export function createDisambiguatorAdapter(
  client: LlmClient,
): (input: DisambiguatorInput) => Promise<DisambiguatorOutput> {
  const systemPrompt = buildDisambiguatorSystemPrompt();

  return async (input: DisambiguatorInput): Promise<DisambiguatorOutput> => {
    const response = await client.complete({
      system: systemPrompt,
      userMessage: buildDisambiguatorUserMessage(input),
      model: input.model_id === 'default' ? undefined : input.model_id,
      maxTokens: 256,
    });
    return extractJsonFromResponse(response) as DisambiguatorOutput;
  };
}

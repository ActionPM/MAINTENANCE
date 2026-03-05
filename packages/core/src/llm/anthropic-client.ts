import Anthropic from '@anthropic-ai/sdk';

export interface LlmClientConfig {
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly defaultMaxTokens?: number;
  /** API request timeout in ms (default: 30000) */
  readonly timeout?: number;
}

export interface CompletionRequest {
  readonly system: string;
  readonly userMessage: string;
  readonly model?: string;
  readonly maxTokens?: number;
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<string>;
}

/**
 * Create an Anthropic API client wrapper.
 * Returns a simplified interface for our LLM tools.
 */
export function createAnthropicClient(config: LlmClientConfig): LlmClient {
  const sdk = new Anthropic({ apiKey: config.apiKey, timeout: config.timeout ?? 30_000 });
  const defaultModel = config.defaultModel ?? 'claude-sonnet-4-20250514';
  const defaultMaxTokens = config.defaultMaxTokens ?? 2048;

  return {
    async complete(request: CompletionRequest): Promise<string> {
      const response = await sdk.messages.create({
        model: request.model ?? defaultModel,
        max_tokens: request.maxTokens ?? defaultMaxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text content in Anthropic response');
      }
      return textBlock.text;
    },
  };
}

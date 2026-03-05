import type { IssueSplitterInput, IssueSplitterOutput, IssueClassifierInput, FollowUpGeneratorInput, Taxonomy } from '@wo-agent/schemas';
import { createAnthropicClient } from './anthropic-client.js';
import { createSplitterAdapter } from './adapters/splitter-adapter.js';
import { createClassifierAdapter } from './adapters/classifier-adapter.js';
import { createFollowUpAdapter } from './adapters/followup-adapter.js';

export interface CreateLlmDepsConfig {
  readonly apiKey: string;
  readonly taxonomy: Taxonomy;
  readonly defaultModel?: string;
  readonly defaultMaxTokens?: number;
}

export interface LlmDependencies {
  readonly issueSplitter: (input: IssueSplitterInput) => Promise<IssueSplitterOutput>;
  readonly issueClassifier: (
    input: IssueClassifierInput,
    retryContext?: { retryHint: string; constraint?: string },
  ) => Promise<unknown>;
  readonly followUpGenerator: (
    input: FollowUpGeneratorInput,
    retryContext?: { retryHint: string },
  ) => Promise<unknown>;
}

/**
 * Create all three LLM dependency functions wired to the Anthropic API.
 * Drop-in replacements for the stubs in orchestrator-factory.ts.
 */
export function createLlmDependencies(config: CreateLlmDepsConfig): LlmDependencies {
  const client = createAnthropicClient({
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    defaultMaxTokens: config.defaultMaxTokens,
  });

  return {
    issueSplitter: createSplitterAdapter(client),
    issueClassifier: createClassifierAdapter(client, config.taxonomy),
    followUpGenerator: createFollowUpAdapter(client),
  };
}

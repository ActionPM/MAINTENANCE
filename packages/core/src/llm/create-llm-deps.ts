import type {
  IssueSplitterInput,
  IssueSplitterOutput,
  IssueClassifierInput,
  FollowUpGeneratorInput,
  DisambiguatorInput,
  Taxonomy,
} from '@wo-agent/schemas';
import type { Logger, MetricsRecorder } from '../observability/types.js';
import { createAnthropicClient } from './anthropic-client.js';
import { createSplitterAdapter } from './adapters/splitter-adapter.js';
import { createClassifierAdapter } from './adapters/classifier-adapter.js';
import { createFollowUpAdapter } from './adapters/followup-adapter.js';
import { createDisambiguatorAdapter } from './adapters/disambiguator-adapter.js';
import { withObservedLlmCall } from './with-observed-llm-call.js';
import { callDisambiguator } from '../disambiguator/disambiguator.js';
import type { DisambiguatorCallResult } from '../disambiguator/disambiguator.js';

export interface CreateLlmDepsConfig {
  readonly apiKey: string;
  readonly taxonomy: Taxonomy;
  readonly defaultModel?: string;
  readonly defaultMaxTokens?: number;
  readonly logger?: Logger;
  readonly metricsRecorder?: MetricsRecorder;
}

export interface LlmDependencies {
  readonly issueSplitter: (
    input: IssueSplitterInput,
    ...rest: unknown[]
  ) => Promise<IssueSplitterOutput>;
  readonly issueClassifier: (input: IssueClassifierInput, ...rest: unknown[]) => Promise<unknown>;
  readonly followUpGenerator: (
    input: FollowUpGeneratorInput,
    ...rest: unknown[]
  ) => Promise<unknown>;
  readonly messageDisambiguator: (
    input: DisambiguatorInput,
    ...rest: unknown[]
  ) => Promise<DisambiguatorCallResult>;
}

/**
 * Create all four LLM dependency functions wired to the Anthropic API.
 * Drop-in replacements for the stubs in orchestrator-factory.ts.
 * When logger/metricsRecorder are provided, each adapter is wrapped
 * with observability instrumentation (logging + latency/error metrics).
 *
 * The disambiguator is wrapped differently: its adapter produces raw
 * DisambiguatorOutput, which callDisambiguator validates and wraps into
 * DisambiguatorCallResult with the isFailSafe control flag.
 */
export function createLlmDependencies(config: CreateLlmDepsConfig): LlmDependencies {
  const client = createAnthropicClient({
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    defaultMaxTokens: config.defaultMaxTokens,
  });

  const rawSplitter = createSplitterAdapter(client);
  const rawClassifier = createClassifierAdapter(client, config.taxonomy);
  const rawFollowUp = createFollowUpAdapter(client);
  const rawDisambiguator = createDisambiguatorAdapter(client);

  // Cast adapters to rest-param signature expected by withObservedLlmCall.
  // The wrappers detect ObservabilityContext by shape at runtime; typed
  // second params (retryContext) pass through transparently via ...rest.
  type AdapterFn<I, O> = (input: I, ...rest: unknown[]) => Promise<O>;

  // Wrap the disambiguator adapter with callDisambiguator for validation/retry/fail-safe.
  // callDisambiguator never throws — it returns DisambiguatorCallResult with isFailSafe.
  const wrappedDisambiguator = (input: DisambiguatorInput): Promise<DisambiguatorCallResult> =>
    callDisambiguator(
      input,
      rawDisambiguator as AdapterFn<DisambiguatorInput, unknown>,
      config.metricsRecorder,
    );

  if (config.logger || config.metricsRecorder) {
    return {
      issueSplitter: withObservedLlmCall(
        rawSplitter as AdapterFn<IssueSplitterInput, IssueSplitterOutput>,
        config.logger,
        config.metricsRecorder,
        'splitter',
      ),
      issueClassifier: withObservedLlmCall(
        rawClassifier as AdapterFn<IssueClassifierInput, unknown>,
        config.logger,
        config.metricsRecorder,
        'classifier',
      ),
      followUpGenerator: withObservedLlmCall(
        rawFollowUp as AdapterFn<FollowUpGeneratorInput, unknown>,
        config.logger,
        config.metricsRecorder,
        'followup',
      ),
      messageDisambiguator: wrappedDisambiguator,
    };
  }

  return {
    issueSplitter: rawSplitter as AdapterFn<IssueSplitterInput, IssueSplitterOutput>,
    issueClassifier: rawClassifier as AdapterFn<IssueClassifierInput, unknown>,
    followUpGenerator: rawFollowUp as AdapterFn<FollowUpGeneratorInput, unknown>,
    messageDisambiguator: wrappedDisambiguator,
  };
}

import {
  callIssueClassifier,
  createAnthropicClient,
  createClassifierAdapter,
} from '@wo-agent/core';
import type { IssueClassifierInput } from '@wo-agent/schemas';
import {
  CUE_VERSION,
  DEFAULT_MODEL_ID,
  PROMPT_VERSION,
  TAXONOMY_VERSION,
  loadTaxonomy,
} from '@wo-agent/schemas';
import type { Taxonomy } from '@wo-agent/schemas';

export interface ClassifierAdapterInput {
  readonly issue_id: string;
  readonly issue_text: string;
  readonly cue_scores?: Record<string, unknown>;
  readonly retryContext?: unknown;
}

export interface ClassifierAdapterOutput {
  readonly classification: Record<string, string>;
  readonly model_confidence: Record<string, number>;
  readonly missing_fields: readonly string[];
  readonly needs_human_triage: boolean;
}

export interface ClassifierAdapter {
  classify(input: ClassifierAdapterInput): Promise<ClassifierAdapterOutput>;
}

export class FixtureClassifierAdapter implements ClassifierAdapter {
  constructor(private readonly fixtures: Record<string, ClassifierAdapterOutput>) {}

  async classify(input: ClassifierAdapterInput): Promise<ClassifierAdapterOutput> {
    const fixture = this.fixtures[input.issue_id];
    if (!fixture) {
      throw new Error(`No fixture for issue ${input.issue_id}`);
    }
    return fixture;
  }
}

export class RecordedOutputAdapter implements ClassifierAdapter {
  constructor(private readonly recordings: Record<string, ClassifierAdapterOutput>) {}

  async classify(input: ClassifierAdapterInput): Promise<ClassifierAdapterOutput> {
    const recording = this.recordings[input.issue_id];
    if (!recording) {
      return {
        classification: {},
        model_confidence: {},
        missing_fields: [],
        needs_human_triage: true,
      };
    }
    return recording;
  }
}

export interface AnthropicClassifierAdapterConfig {
  readonly apiKey?: string;
  readonly taxonomy?: Taxonomy;
  readonly taxonomyVersion?: string;
  readonly modelId?: string;
  readonly promptVersion?: string;
  readonly cueVersion?: string;
  readonly llmCall?: EvalLlmClassifierFn;
}

export class AnthropicClassifierAdapter implements ClassifierAdapter {
  private readonly taxonomy: Taxonomy;
  private readonly taxonomyVersion: string;
  private readonly modelId: string;
  private readonly promptVersion: string;
  private readonly cueVersion: string;
  private readonly llmCall: EvalLlmClassifierFn;

  constructor(config: AnthropicClassifierAdapterConfig) {
    this.taxonomy = config.taxonomy ?? loadTaxonomy();
    this.taxonomyVersion = config.taxonomyVersion ?? TAXONOMY_VERSION;
    this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
    this.promptVersion = config.promptVersion ?? PROMPT_VERSION;
    this.cueVersion = config.cueVersion ?? CUE_VERSION;

    if (config.llmCall) {
      this.llmCall = config.llmCall;
      return;
    }

    if (!config.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for --adapter anthropic');
    }

    const client = createAnthropicClient({
      apiKey: config.apiKey,
      defaultModel: this.modelId,
    });
    this.llmCall = createClassifierAdapter(client, this.taxonomy);
  }

  async classify(input: ClassifierAdapterInput): Promise<ClassifierAdapterOutput> {
    const cueScores = normalizeCueScores(input.cue_scores);
    const result = await callIssueClassifier(
      {
        issue_id: input.issue_id,
        issue_summary: input.issue_text,
        raw_excerpt: input.issue_text,
        taxonomy_version: this.taxonomyVersion,
        model_id: this.modelId,
        prompt_version: this.promptVersion,
        cue_version: this.cueVersion,
        cue_scores: cueScores,
      },
      this.llmCall,
      this.taxonomy,
      this.taxonomyVersion,
    );

    if (result.status === 'ok' && result.output) {
      return {
        classification: result.output.classification,
        model_confidence: result.output.model_confidence,
        missing_fields: [...result.output.missing_fields],
        needs_human_triage: false,
      };
    }

    if (result.status === 'needs_human_triage') {
      const fallback = result.conflicting?.[0];
      return {
        classification: fallback?.classification ?? {},
        model_confidence: fallback?.model_confidence ?? {},
        missing_fields: [...(fallback?.missing_fields ?? [])],
        needs_human_triage: true,
      };
    }

    throw new Error(result.error ?? 'Anthropic classifier evaluation failed');
  }
}

type EvalLlmClassifierFn = (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
  ...rest: unknown[]
) => Promise<unknown>;

function normalizeCueScores(
  cueScores: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
  if (!cueScores) {
    return undefined;
  }

  const numericEntries = Object.entries(cueScores).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );
  if (numericEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(numericEntries);
}

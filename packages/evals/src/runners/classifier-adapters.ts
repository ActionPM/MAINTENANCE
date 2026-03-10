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

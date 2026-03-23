export interface IssueSplitterInput {
  readonly raw_text: string;
  readonly conversation_id: string;
  readonly taxonomy_version: string;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly cue_version: string;
}

export interface SplitIssue {
  readonly issue_id: string;
  readonly summary: string;
  readonly raw_excerpt: string;
}

export interface IssueSplitterOutput {
  readonly issues: readonly SplitIssue[];
  readonly issue_count: number;
}

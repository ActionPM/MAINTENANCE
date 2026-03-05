export interface FollowupAnswer {
  readonly field_target: string;
  readonly answer: string | boolean;
}

export interface IssueClassifierInput {
  readonly issue_id: string;
  readonly issue_summary: string;
  readonly raw_excerpt: string;
  readonly followup_answers?: readonly FollowupAnswer[];
  readonly taxonomy_version: string;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly cue_scores?: Record<string, number>;
  readonly retry_context?: string;
}

export interface IssueClassifierOutput {
  readonly issue_id: string;
  readonly classification: Record<string, string>;
  readonly model_confidence: Record<string, number>;
  readonly missing_fields: readonly string[];
  readonly needs_human_triage: boolean;
}

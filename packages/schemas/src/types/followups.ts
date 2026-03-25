export interface PreviousQuestion {
  readonly field_target: string;
  readonly times_asked: number;
}

export interface FollowUpGeneratorInput {
  readonly issue_id: string;
  readonly classification: Record<string, string>;
  readonly confidence_by_field: Record<string, number>;
  readonly missing_fields: readonly string[];
  readonly fields_needing_input: readonly string[];
  readonly previous_questions: readonly PreviousQuestion[];
  readonly turn_number: number;
  readonly total_questions_asked: number;
  readonly taxonomy_version: string;
  readonly prompt_version: string;
  readonly cue_version: string;
  readonly original_text?: string;
}

export type FollowUpAnswerType = 'enum' | 'yes_no' | 'text';

export interface FollowUpQuestion {
  readonly question_id: string;
  readonly field_target: string;
  readonly prompt: string;
  readonly options: readonly string[];
  readonly answer_type: FollowUpAnswerType;
}

export interface FollowUpGeneratorOutput {
  readonly questions: readonly FollowUpQuestion[];
}

export interface AnswerReceived {
  readonly question_id: string;
  readonly answer: unknown;
  readonly received_at: string;
}

export interface FollowUpEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly issue_id: string;
  readonly turn_number: number;
  readonly questions_asked: readonly FollowUpQuestion[];
  readonly answers_received?: readonly AnswerReceived[] | null;
  readonly created_at: string;
}

import type { ConversationState } from '../conversation-states.js';
import type { SplitIssue } from './issue-split.js';
import type { FollowUpQuestion } from './followups.js';

/**
 * Input to the MessageDisambiguator LLM tool.
 * Determines whether a tenant message during follow-ups or confirmation
 * is clarification of the current issues or a wholly new issue (spec §12.2).
 */
export interface DisambiguatorInput {
  readonly message: string;
  readonly current_issues: readonly SplitIssue[];
  readonly pending_questions: readonly FollowUpQuestion[] | null;
  readonly conversation_state: ConversationState;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly cue_version: string;
  readonly conversation_id: string;
}

/**
 * Schema-locked LLM output from the disambiguator.
 * Only classification + reasoning — no internal control flags.
 */
export interface DisambiguatorOutput {
  readonly classification: 'clarification' | 'new_issue';
  readonly reasoning: string;
}

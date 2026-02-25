import type { FollowUpEvent, FollowUpQuestion, AnswerReceived } from '@wo-agent/schemas';

export interface QuestionsEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly issueId: string;
  readonly turnNumber: number;
  readonly questions: readonly FollowUpQuestion[];
  readonly createdAt: string;
}

export interface AnswersEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly issueId: string;
  readonly turnNumber: number;
  readonly questions: readonly FollowUpQuestion[];
  readonly answers: readonly AnswerReceived[];
  readonly createdAt: string;
}

/**
 * Build a followup_event recording that questions were asked (spec §7.1).
 * answers_received is null — the tenant hasn't responded yet.
 * This event is append-only (INSERT only, never updated).
 */
export function buildFollowUpQuestionsEvent(input: QuestionsEventInput): FollowUpEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    issue_id: input.issueId,
    turn_number: input.turnNumber,
    questions_asked: [...input.questions],
    answers_received: null,
    created_at: input.createdAt,
  };
}

/**
 * Build a followup_event recording that the tenant answered (spec §7.1).
 * Both questions and answers are recorded for full traceability.
 * This is a NEW event — the previous "questions asked" event is immutable.
 */
export function buildFollowUpAnswersEvent(input: AnswersEventInput): FollowUpEvent {
  // Validate that all answer question_ids match questions_asked
  const questionIds = new Set(input.questions.map((q) => q.question_id));
  for (const answer of input.answers) {
    if (!questionIds.has(answer.question_id)) {
      throw new Error(
        `question_id "${answer.question_id}" does not match any question in questions_asked`,
      );
    }
  }

  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    issue_id: input.issueId,
    turn_number: input.turnNumber,
    questions_asked: [...input.questions],
    answers_received: [...input.answers],
    created_at: input.createdAt,
  };
}

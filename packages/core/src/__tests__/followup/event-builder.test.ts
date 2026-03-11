import { describe, it, expect } from 'vitest';
import {
  buildFollowUpQuestionsEvent,
  buildFollowUpAnswersEvent,
} from '../../followup/event-builder.js';
import type { FollowUpQuestion, FollowUpEvent } from '@wo-agent/schemas';
import { validateFollowUpEvent } from '@wo-agent/schemas';

const QUESTIONS: FollowUpQuestion[] = [
  {
    question_id: 'q1',
    field_target: 'Priority',
    prompt: 'How urgent is this?',
    options: ['low', 'normal', 'high'],
    answer_type: 'enum',
  },
];

describe('buildFollowUpQuestionsEvent', () => {
  it('creates a valid FollowUpEvent with questions and null answers', () => {
    const event = buildFollowUpQuestionsEvent({
      eventId: 'evt-1',
      conversationId: 'conv-1',
      issueId: 'issue-1',
      turnNumber: 1,
      questions: QUESTIONS,
      createdAt: '2026-02-25T12:00:00.000Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.issue_id).toBe('issue-1');
    expect(event.turn_number).toBe(1);
    expect(event.questions_asked).toEqual(QUESTIONS);
    expect(event.answers_received).toBeNull();
    expect(event.created_at).toBe('2026-02-25T12:00:00.000Z');

    // Must pass schema validation
    const validation = validateFollowUpEvent(event);
    expect(validation.valid).toBe(true);
  });
});

describe('buildFollowUpAnswersEvent', () => {
  it('creates a valid FollowUpEvent with questions and answers', () => {
    const event = buildFollowUpAnswersEvent({
      eventId: 'evt-2',
      conversationId: 'conv-1',
      issueId: 'issue-1',
      turnNumber: 1,
      questions: QUESTIONS,
      answers: [{ question_id: 'q1', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' }],
      createdAt: '2026-02-25T12:05:00.000Z',
    });

    expect(event.event_id).toBe('evt-2');
    expect(event.answers_received).toHaveLength(1);
    expect(event.answers_received![0].answer).toBe('normal');

    // Must pass schema validation
    const validation = validateFollowUpEvent(event);
    expect(validation.valid).toBe(true);
  });

  it('rejects mismatched question_id in answers', () => {
    expect(() =>
      buildFollowUpAnswersEvent({
        eventId: 'evt-3',
        conversationId: 'conv-1',
        issueId: 'issue-1',
        turnNumber: 1,
        questions: QUESTIONS,
        answers: [
          { question_id: 'nonexistent', answer: 'normal', received_at: '2026-02-25T12:05:00.000Z' },
        ],
        createdAt: '2026-02-25T12:05:00.000Z',
      }),
    ).toThrow(/question_id .* does not match/);
  });
});

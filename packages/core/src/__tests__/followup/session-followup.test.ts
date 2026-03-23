import { describe, it, expect } from 'vitest';
import {
  createSession,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
} from '../../session/session.js';
import type { FollowUpQuestion, PreviousQuestion } from '@wo-agent/schemas';

const VERSIONS = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test',
  prompt_version: '1.0.0',
      cue_version: '1.2.0',
};

describe('follow-up tracking on session', () => {
  it('initializes with default follow-up tracking values', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    expect(session.followup_turn_number).toBe(0);
    expect(session.total_questions_asked).toBe(0);
    expect(session.previous_questions).toEqual([]);
    expect(session.pending_followup_questions).toBeNull();
  });
});

describe('updateFollowUpTracking', () => {
  it('increments turn number and total questions asked', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    const questions: FollowUpQuestion[] = [
      {
        question_id: 'q1',
        field_target: 'Priority',
        prompt: 'Priority?',
        options: ['low', 'high'],
        answer_type: 'enum',
      },
      {
        question_id: 'q2',
        field_target: 'Location',
        prompt: 'Location?',
        options: ['suite', 'common'],
        answer_type: 'enum',
      },
    ];

    session = updateFollowUpTracking(session, questions);

    expect(session.followup_turn_number).toBe(1);
    expect(session.total_questions_asked).toBe(2);
    expect(session.previous_questions).toEqual([
      { field_target: 'Priority', times_asked: 1 },
      { field_target: 'Location', times_asked: 1 },
    ]);
  });

  it('increments times_asked for previously asked fields', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    // First turn: ask about Priority
    const turn1: FollowUpQuestion[] = [
      {
        question_id: 'q1',
        field_target: 'Priority',
        prompt: 'Priority?',
        options: [],
        answer_type: 'enum',
      },
    ];
    session = updateFollowUpTracking(session, turn1);
    expect(session.previous_questions).toEqual([{ field_target: 'Priority', times_asked: 1 }]);

    // Second turn: ask about Priority again + Location
    const turn2: FollowUpQuestion[] = [
      {
        question_id: 'q2',
        field_target: 'Priority',
        prompt: 'Priority again?',
        options: [],
        answer_type: 'enum',
      },
      {
        question_id: 'q3',
        field_target: 'Location',
        prompt: 'Location?',
        options: [],
        answer_type: 'enum',
      },
    ];
    session = updateFollowUpTracking(session, turn2);
    expect(session.followup_turn_number).toBe(2);
    expect(session.total_questions_asked).toBe(3);
    expect(session.previous_questions).toContainEqual({ field_target: 'Priority', times_asked: 2 });
    expect(session.previous_questions).toContainEqual({ field_target: 'Location', times_asked: 1 });
  });
});

describe('setPendingFollowUpQuestions', () => {
  it('stores pending questions on session', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    const questions: FollowUpQuestion[] = [
      {
        question_id: 'q1',
        field_target: 'Priority',
        prompt: 'Priority?',
        options: ['low', 'high'],
        answer_type: 'enum',
      },
    ];

    session = setPendingFollowUpQuestions(session, questions);
    expect(session.pending_followup_questions).toEqual(questions);
  });

  it('allows clearing pending questions with null', () => {
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: VERSIONS,
    });

    session = setPendingFollowUpQuestions(session, [
      {
        question_id: 'q1',
        field_target: 'Priority',
        prompt: '?',
        options: [],
        answer_type: 'text',
      },
    ]);
    session = setPendingFollowUpQuestions(session, null);
    expect(session.pending_followup_questions).toBeNull();
  });
});

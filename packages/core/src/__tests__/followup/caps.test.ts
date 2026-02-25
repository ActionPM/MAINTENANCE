import { describe, it, expect } from 'vitest';
import {
  checkFollowUpCaps,
  filterEligibleFields,
  truncateQuestions,
} from '../../followup/caps.js';
import { DEFAULT_FOLLOWUP_CAPS } from '@wo-agent/schemas';
import type { FollowUpQuestion, PreviousQuestion, FollowUpCaps } from '@wo-agent/schemas';

const caps = DEFAULT_FOLLOWUP_CAPS;

describe('checkFollowUpCaps', () => {
  it('returns canContinue=true when under all caps', () => {
    const result = checkFollowUpCaps({
      turnNumber: 1,
      totalQuestionsAsked: 0,
      previousQuestions: [],
      fieldsNeedingInput: ['Priority', 'Location'],
      caps,
    });
    expect(result.canContinue).toBe(true);
    expect(result.escapeHatch).toBe(false);
    expect(result.remainingQuestionBudget).toBe(3); // min(3 per turn, 9 - 0 total)
  });

  it('returns escapeHatch=true when turn_number exceeds max_turns', () => {
    const result = checkFollowUpCaps({
      turnNumber: 9, // exceeds max_turns=8
      totalQuestionsAsked: 5,
      previousQuestions: [],
      fieldsNeedingInput: ['Priority'],
      caps,
    });
    expect(result.canContinue).toBe(false);
    expect(result.escapeHatch).toBe(true);
    expect(result.reason).toContain('max_turns');
  });

  it('returns escapeHatch=true when total questions exhausted', () => {
    const result = checkFollowUpCaps({
      turnNumber: 4,
      totalQuestionsAsked: 9, // at max
      previousQuestions: [],
      fieldsNeedingInput: ['Priority'],
      caps,
    });
    expect(result.canContinue).toBe(false);
    expect(result.escapeHatch).toBe(true);
    expect(result.reason).toContain('max_total_questions');
  });

  it('limits remaining budget to max_questions_per_turn', () => {
    const result = checkFollowUpCaps({
      turnNumber: 1,
      totalQuestionsAsked: 0,
      previousQuestions: [],
      fieldsNeedingInput: ['A', 'B', 'C', 'D', 'E'],
      caps,
    });
    expect(result.remainingQuestionBudget).toBe(3);
  });

  it('limits remaining budget to total questions remaining', () => {
    const result = checkFollowUpCaps({
      turnNumber: 4,
      totalQuestionsAsked: 7, // only 2 left
      previousQuestions: [],
      fieldsNeedingInput: ['A', 'B', 'C'],
      caps,
    });
    expect(result.remainingQuestionBudget).toBe(2);
  });

  it('returns escapeHatch when no eligible fields remain', () => {
    const result = checkFollowUpCaps({
      turnNumber: 2,
      totalQuestionsAsked: 2,
      previousQuestions: [
        { field_target: 'Priority', times_asked: 2 }, // maxed out
      ],
      fieldsNeedingInput: ['Priority'], // only field, but maxed
      caps,
    });
    expect(result.canContinue).toBe(false);
    expect(result.escapeHatch).toBe(true);
    expect(result.eligibleFields).toEqual([]);
  });
});

describe('filterEligibleFields', () => {
  it('excludes fields at max re-ask limit', () => {
    const result = filterEligibleFields(
      ['Priority', 'Location', 'Category'],
      [
        { field_target: 'Priority', times_asked: 2 },
        { field_target: 'Location', times_asked: 1 },
      ],
      caps,
    );
    expect(result).toEqual(['Location', 'Category']);
  });

  it('includes fields not yet asked', () => {
    const result = filterEligibleFields(
      ['Priority', 'Location'],
      [],
      caps,
    );
    expect(result).toEqual(['Priority', 'Location']);
  });

  it('excludes all fields when all maxed', () => {
    const result = filterEligibleFields(
      ['Priority'],
      [{ field_target: 'Priority', times_asked: 2 }],
      caps,
    );
    expect(result).toEqual([]);
  });
});

describe('truncateQuestions', () => {
  it('passes through when under budget', () => {
    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'Priority', prompt: 'What priority?', options: ['low', 'normal', 'high'], answer_type: 'enum' },
    ];
    const result = truncateQuestions(questions, 3);
    expect(result).toHaveLength(1);
  });

  it('truncates to budget', () => {
    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'A', prompt: 'Q1?', options: [], answer_type: 'text' },
      { question_id: 'q2', field_target: 'B', prompt: 'Q2?', options: [], answer_type: 'text' },
      { question_id: 'q3', field_target: 'C', prompt: 'Q3?', options: [], answer_type: 'text' },
      { question_id: 'q4', field_target: 'D', prompt: 'Q4?', options: [], answer_type: 'text' },
    ];
    const result = truncateQuestions(questions, 2);
    expect(result).toHaveLength(2);
    expect(result[0].question_id).toBe('q1');
    expect(result[1].question_id).toBe('q2');
  });

  it('returns empty array when budget is 0', () => {
    const questions: FollowUpQuestion[] = [
      { question_id: 'q1', field_target: 'A', prompt: 'Q1?', options: [], answer_type: 'text' },
    ];
    const result = truncateQuestions(questions, 0);
    expect(result).toHaveLength(0);
  });
});

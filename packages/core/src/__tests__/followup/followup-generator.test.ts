import { describe, it, expect, vi } from 'vitest';
import {
  callFollowUpGenerator,
  FollowUpGeneratorError,
  FollowUpGeneratorErrorCode,
} from '../../followup/followup-generator.js';
import type {
  FollowUpGeneratorInput,
  FollowUpGeneratorOutput,
  FollowUpQuestion,
} from '@wo-agent/schemas';

const VALID_INPUT: FollowUpGeneratorInput = {
  issue_id: 'issue-1',
  classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
  confidence_by_field: { Category: 0.9, Maintenance_Category: 0.5, Priority: 0.4 },
  missing_fields: [],
  fields_needing_input: ['Maintenance_Category', 'Priority'],
  previous_questions: [],
  turn_number: 1,
  total_questions_asked: 0,
  taxonomy_version: '1.0.0',
  prompt_version: '1.0.0',
      cue_version: '1.2.0',
};

const VALID_OUTPUT: FollowUpGeneratorOutput = {
  questions: [
    {
      question_id: 'q1',
      field_target: 'Maintenance_Category',
      prompt: 'What type of maintenance issue is this?',
      options: ['plumbing', 'electrical', 'hvac', 'other'],
      answer_type: 'enum',
    },
    {
      question_id: 'q2',
      field_target: 'Priority',
      prompt: 'How urgent is this issue?',
      options: ['low', 'normal', 'high', 'emergency'],
      answer_type: 'enum',
    },
  ],
};

describe('callFollowUpGenerator', () => {
  it('returns valid output on first attempt', async () => {
    const llmCall = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(2);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries once on schema validation failure then succeeds', async () => {
    const badOutput = { questions: [{ question_id: 'q1' }] }; // missing required fields
    const llmCall = vi.fn().mockResolvedValueOnce(badOutput).mockResolvedValueOnce(VALID_OUTPUT);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('returns llm_fail after two schema validation failures', async () => {
    const badOutput = { questions: [{ question_id: 'q1' }] };
    const llmCall = vi.fn().mockResolvedValue(badOutput);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 3);
    expect(result.status).toBe('llm_fail');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws FollowUpGeneratorError on LLM call exception', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(callFollowUpGenerator(VALID_INPUT, llmCall, 3)).rejects.toThrow(
      FollowUpGeneratorError,
    );
  });

  it('truncates questions to remaining budget', async () => {
    const threeQuestions: FollowUpGeneratorOutput = {
      questions: [
        {
          question_id: 'q1',
          field_target: 'Maintenance_Category',
          prompt: 'Q1?',
          options: [],
          answer_type: 'text',
        },
        {
          question_id: 'q2',
          field_target: 'Priority',
          prompt: 'Q2?',
          options: [],
          answer_type: 'text',
        },
        {
          question_id: 'q3',
          field_target: 'Maintenance_Category',
          prompt: 'Q3?',
          options: [],
          answer_type: 'text',
        },
      ],
    };
    const llmCall = vi.fn().mockResolvedValue(threeQuestions);
    const result = await callFollowUpGenerator(VALID_INPUT, llmCall, 2);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(2);
  });

  it('filters out questions targeting ineligible fields', async () => {
    const inputWithRestricted: FollowUpGeneratorInput = {
      ...VALID_INPUT,
      fields_needing_input: ['Priority'], // only Priority eligible
    };
    const outputWithExtra: FollowUpGeneratorOutput = {
      questions: [
        {
          question_id: 'q1',
          field_target: 'Maintenance_Category',
          prompt: 'Category?',
          options: [],
          answer_type: 'enum',
        },
        {
          question_id: 'q2',
          field_target: 'Priority',
          prompt: 'Priority?',
          options: ['low', 'high'],
          answer_type: 'enum',
        },
      ],
    };
    const llmCall = vi.fn().mockResolvedValue(outputWithExtra);
    const result = await callFollowUpGenerator(inputWithRestricted, llmCall, 3);
    expect(result.status).toBe('ok');
    // Should filter to only the eligible field
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Priority');
  });
});

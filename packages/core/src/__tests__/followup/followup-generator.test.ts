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
  classification: {},
  confidence_by_field: { Category: 0.9, Management_Category: 0.5, Priority: 0.4 },
  missing_fields: [],
  fields_needing_input: ['Management_Category', 'Priority'],
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
      field_target: 'Management_Category',
      prompt: 'What type of management issue is this?',
      options: ['access', 'cleaning', 'noise', 'other'],
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
          field_target: 'Management_Category',
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
          field_target: 'Management_Category',
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

  it('builds a deterministic fallback question when all returned questions are filtered out', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Location: 0.2, Maintenance_Category: 0.2 },
      missing_fields: ['Location'],
      fields_needing_input: ['Location', 'Maintenance_Category'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a plumbing issue',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Maintenance_Category',
          prompt: 'What kind of issue is it?',
          options: ['plumbing'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0]).toMatchObject({
      field_target: 'Location',
      prompt: 'Where is this issue located?',
      options: ['suite', 'building_interior', 'building_exterior'],
      answer_type: 'enum',
    });
  });
});

describe('callFollowUpGenerator maintenance frontier ordering', () => {
  it('builds the LLM prompt input from the maintenance frontier subset', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: {
        Location: 0.2,
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.2,
        Priority: 0.2,
      },
      missing_fields: [],
      fields_needing_input: [
        'Location',
        'Sub_Location',
        'Maintenance_Category',
        'Maintenance_Object',
        'Maintenance_Problem',
        'Priority',
      ],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a plumbing issue',
    };

    const llmCall = vi.fn(async (llmInput: FollowUpGeneratorInput) => {
      expect(llmInput.fields_needing_input).toEqual(['Location']);
      return {
        questions: [
          {
            question_id: 'q1',
            field_target: 'Location',
            prompt: 'Where is the issue located?',
            options: ['suite', 'building_interior'],
            answer_type: 'enum',
          },
        ],
      };
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Location');
  });

  it('drops returned questions that target non-frontier maintenance fields', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance', Location: 'suite' },
      confidence_by_field: {
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Priority: 0.2,
      },
      missing_fields: [],
      fields_needing_input: ['Sub_Location', 'Maintenance_Category', 'Priority'],
      previous_questions: [],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn(async (llmInput: FollowUpGeneratorInput) => {
      expect(llmInput.fields_needing_input).toEqual(['Sub_Location']);
      return {
        questions: [
          {
            question_id: 'q1',
            field_target: 'Sub_Location',
            prompt: 'Which room is this in?',
            options: ['bathroom', 'kitchen'],
            answer_type: 'enum',
          },
          {
            question_id: 'q2',
            field_target: 'Maintenance_Category',
            prompt: 'What kind of maintenance issue is it?',
            options: ['plumbing'],
            answer_type: 'enum',
          },
          {
            question_id: 'q3',
            field_target: 'Priority',
            prompt: 'How urgent is it?',
            options: ['low', 'high'],
            answer_type: 'enum',
          },
        ],
      };
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Sub_Location');
  });

  it('applies option filtering after frontier filtering', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Maintenance_Object: 'toilet',
      },
      confidence_by_field: {
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
      },
      missing_fields: [],
      fields_needing_input: ['Sub_Location', 'Maintenance_Category'],
      previous_questions: [],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn(async () => ({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Which room is this in?',
          options: ['bathroom', 'kitchen', 'parking_garage'],
          answer_type: 'enum',
        },
        {
          question_id: 'q2',
          field_target: 'Maintenance_Category',
          prompt: 'What kind of maintenance issue is it?',
          options: ['plumbing'],
          answer_type: 'enum',
        },
      ],
    }));

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Sub_Location');
    expect(result.output!.questions[0].options).toEqual(['bathroom']);
  });

  it('keeps only the earliest uncertain maintenance field when downstream guesses already exist', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
      },
      confidence_by_field: {
        Location: 0.3,
        Maintenance_Object: 0.3,
        Maintenance_Problem: 0.3,
      },
      missing_fields: [],
      fields_needing_input: ['Location', 'Maintenance_Object', 'Maintenance_Problem'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a plumbing issue',
    };

    const llmCall = vi.fn(async (llmInput: FollowUpGeneratorInput) => {
      expect(llmInput.fields_needing_input).toEqual(['Location']);
      return {
        questions: [
          {
            question_id: 'q1',
            field_target: 'Location',
            prompt: 'Where is this issue located?',
            options: ['suite', 'building_interior', 'building_exterior'],
            answer_type: 'enum',
          },
          {
            question_id: 'q2',
            field_target: 'Maintenance_Object',
            prompt: 'What fixture is affected?',
            options: ['toilet'],
            answer_type: 'enum',
          },
        ],
      };
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions.map((q) => q.field_target)).toEqual(['Location']);
  });
});

describe('BUG-011: taxonomy-only enum option enforcement', () => {
  it('replaces all-hallucinated options with constraint-valid taxonomy values', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance', Location: 'suite' },
      confidence_by_field: { Sub_Location: 0.2 },
      missing_fields: [],
      fields_needing_input: ['Sub_Location'],
      previous_questions: [],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Where in your apartment?',
          options: ['half bath', 'master bathroom', 'powder room'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    expect(q.field_target).toBe('Sub_Location');
    // All LLM options were hallucinated — replaced with constraint-valid values
    expect(q.options).not.toContain('half bath');
    expect(q.options).not.toContain('master bathroom');
    expect(q.options).not.toContain('powder room');
    // Should have constraint-valid options from Location_to_Sub_Location['suite']
    expect(q.options.length).toBeGreaterThan(0);
    expect(
      q.options.every((o: string) =>
        [
          'kitchen',
          'bathroom',
          'common_living_dining',
          'bedroom',
          'closets',
          'keys_locks',
          'windows',
          'balcony',
          'ceiling',
          'general',
          'entire_unit',
          'multiple_rooms',
        ].includes(o),
      ),
    ).toBe(true);
  });

  it('filters LLM paraphrases for unconstrained fields against taxonomy defaults', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Location: 0.2 },
      missing_fields: ['Location'],
      fields_needing_input: ['Location'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Location',
          prompt: 'Where is the leak?',
          options: ['In my apartment unit', 'Common area', 'suite'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    // Only 'suite' is a valid taxonomy slug
    expect(q.options).toEqual(['suite']);
    expect(q.options).not.toContain('In my apartment unit');
    expect(q.options).not.toContain('Common area');
  });

  it('replaces all-paraphrased unconstrained options with full taxonomy defaults', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Location: 0.2 },
      missing_fields: ['Location'],
      fields_needing_input: ['Location'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Location',
          prompt: 'Where is the issue?',
          options: ['In my apartment unit', 'Common area', 'Outside'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    // All LLM options are paraphrases — replaced with full taxonomy defaults
    expect(q.options).toEqual(['suite', 'building_interior', 'building_exterior']);
  });

  it('does not filter text or yes_no questions', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance', Location: 'suite' },
      confidence_by_field: { Sub_Location: 0.2 },
      missing_fields: [],
      fields_needing_input: ['Sub_Location'],
      previous_questions: [],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Please describe where the issue is',
          options: [],
          answer_type: 'text',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    expect(q.answer_type).toBe('text');
    expect(q.options).toEqual([]);
  });

  it('keeps valid LLM options when some pass constraint filter', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance', Location: 'suite' },
      confidence_by_field: { Sub_Location: 0.2 },
      missing_fields: [],
      fields_needing_input: ['Sub_Location'],
      previous_questions: [],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Which room?',
          options: ['bathroom', 'master bathroom'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    // 'bathroom' is valid for suite; 'master bathroom' is not
    expect(q.options).toEqual(['bathroom']);
  });

  it('enum options are never empty — taxonomy defaults used as fallback', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance' },
      confidence_by_field: { Location: 0.2 },
      missing_fields: ['Location'],
      fields_needing_input: ['Location'],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Location',
          prompt: 'Where?',
          options: ['invalid1', 'invalid2', 'invalid3'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    expect(q.options.length).toBeGreaterThan(0);
    expect(q.options).toEqual(['suite', 'building_interior', 'building_exterior']);
  });
});

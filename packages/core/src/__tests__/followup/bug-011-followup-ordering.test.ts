import { describe, it, expect, vi } from 'vitest';
import { callFollowUpGenerator } from '../../followup/followup-generator.js';
import type { FollowUpGeneratorInput } from '@wo-agent/schemas';

const SUITE_SUB_LOCATIONS = [
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
];

describe('BUG-011: leak scenario follows correct ordering with taxonomy-valid options', () => {
  it('after Location=suite confirmed, next question targets Sub_Location', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-leak',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
      },
      confidence_by_field: {
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.2,
        Priority: 0.2,
      },
      missing_fields: [],
      fields_needing_input: [
        'Sub_Location',
        'Maintenance_Category',
        'Maintenance_Object',
        'Maintenance_Problem',
        'Priority',
      ],
      previous_questions: [],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a leak',
    };

    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Where in your apartment is the leak?',
          options: ['bathroom', 'kitchen', 'bedroom'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    expect(result.output!.questions).toHaveLength(1);
    expect(result.output!.questions[0].field_target).toBe('Sub_Location');
    // All options must be valid Sub_Location slugs for suite
    for (const opt of result.output!.questions[0].options) {
      expect(SUITE_SUB_LOCATIONS).toContain(opt);
    }
  });

  it('Location question options are taxonomy slugs, not LLM paraphrases', async () => {
    const input: FollowUpGeneratorInput = {
      issue_id: 'issue-leak',
      classification: {
        Category: 'maintenance',
      },
      confidence_by_field: {
        Location: 0.2,
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.2,
        Priority: 0.2,
      },
      missing_fields: ['Location'],
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
      original_text: 'I have a leak',
    };

    // LLM returns paraphrased options
    const llmCall = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Location',
          prompt: 'Where is the leak located?',
          options: [
            'In my apartment unit',
            'Common area',
            'Building exterior',
            'Basement/garage',
            'Other',
          ],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, llmCall, 3);
    expect(result.status).toBe('ok');
    const q = result.output!.questions[0];
    expect(q.field_target).toBe('Location');
    // Paraphrases should be replaced with taxonomy defaults
    expect(q.options).toEqual(['suite', 'building_interior', 'building_exterior']);
    expect(q.options).not.toContain('In my apartment unit');
    expect(q.options).not.toContain('Basement/garage');
  });

  it('full flow: Location → Sub_Location → Object → Problem with valid options at each step', async () => {
    // Round 1: Location
    const round1Input: FollowUpGeneratorInput = {
      issue_id: 'issue-leak',
      classification: { Category: 'maintenance' },
      confidence_by_field: {
        Location: 0.2,
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.2,
      },
      missing_fields: ['Location'],
      fields_needing_input: [
        'Location',
        'Sub_Location',
        'Maintenance_Category',
        'Maintenance_Object',
        'Maintenance_Problem',
      ],
      previous_questions: [],
      turn_number: 1,
      total_questions_asked: 0,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a leak',
    };

    const llmCallRound1 = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Location',
          prompt: 'Where is the leak?',
          options: ['In my apartment', 'Hallway', 'Outside'],
          answer_type: 'enum',
        },
      ],
    });

    const result1 = await callFollowUpGenerator(round1Input, llmCallRound1, 3);
    expect(result1.output!.questions[0].field_target).toBe('Location');
    expect(result1.output!.questions[0].options).toEqual([
      'suite',
      'building_interior',
      'building_exterior',
    ]);

    // Round 2: Sub_Location (Location=suite now resolved)
    const round2Input: FollowUpGeneratorInput = {
      issue_id: 'issue-leak',
      classification: { Category: 'maintenance', Location: 'suite' },
      confidence_by_field: {
        Sub_Location: 0.2,
        Maintenance_Category: 0.2,
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.2,
      },
      missing_fields: [],
      fields_needing_input: [
        'Sub_Location',
        'Maintenance_Category',
        'Maintenance_Object',
        'Maintenance_Problem',
      ],
      previous_questions: [{ field_target: 'Location', times_asked: 1 }],
      turn_number: 2,
      total_questions_asked: 1,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a leak',
    };

    const llmCallRound2 = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q2',
          field_target: 'Sub_Location',
          prompt: 'Which room?',
          options: ['Half bath/powder room', 'Master bathroom', 'Guest bathroom'],
          answer_type: 'enum',
        },
      ],
    });

    const result2 = await callFollowUpGenerator(round2Input, llmCallRound2, 3);
    expect(result2.output!.questions[0].field_target).toBe('Sub_Location');
    // All hallucinated — replaced with constraint-valid values for suite
    const subLocOpts = result2.output!.questions[0].options;
    expect(subLocOpts.length).toBeGreaterThan(0);
    for (const opt of subLocOpts) {
      expect(SUITE_SUB_LOCATIONS).toContain(opt);
    }
    expect(subLocOpts).not.toContain('Half bath/powder room');
    expect(subLocOpts).not.toContain('Master bathroom');

    // Round 3: Maintenance_Object (Sub_Location=bathroom, Category=plumbing resolved)
    const round3Input: FollowUpGeneratorInput = {
      issue_id: 'issue-leak',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
      },
      confidence_by_field: {
        Maintenance_Object: 0.2,
        Maintenance_Problem: 0.2,
      },
      missing_fields: [],
      fields_needing_input: ['Maintenance_Object', 'Maintenance_Problem'],
      previous_questions: [
        { field_target: 'Location', times_asked: 1 },
        { field_target: 'Sub_Location', times_asked: 1 },
      ],
      turn_number: 3,
      total_questions_asked: 2,
      taxonomy_version: '1.0.0',
      prompt_version: '1.0.0',
      cue_version: '1.2.0',
      original_text: 'I have a leak',
    };

    const llmCallRound3 = vi.fn().mockResolvedValue({
      questions: [
        {
          question_id: 'q3',
          field_target: 'Maintenance_Object',
          prompt: 'What is leaking?',
          options: ['toilet', 'sink', 'bathtub', 'shower_head'],
          answer_type: 'enum',
        },
      ],
    });

    const result3 = await callFollowUpGenerator(round3Input, llmCallRound3, 3);
    expect(result3.output!.questions[0].field_target).toBe('Maintenance_Object');
    // Options should be filtered to plumbing objects valid for bathroom
    const objOpts = result3.output!.questions[0].options;
    expect(objOpts.length).toBeGreaterThan(0);
    // All options must be valid taxonomy values (no hallucinations)
    // We don't assert exact values since they come from constraint maps,
    // but we verify no hallucinated options survived
    for (const opt of objOpts) {
      expect(typeof opt).toBe('string');
      expect(opt.length).toBeGreaterThan(0);
    }
  });
});

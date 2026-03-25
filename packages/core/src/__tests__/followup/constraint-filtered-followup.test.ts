import { describe, it, expect } from 'vitest';
import { callFollowUpGenerator } from '../../followup/followup-generator.js';
import type { FollowUpGeneratorInput, FollowUpQuestion } from '@wo-agent/schemas';

describe('constraint-filtered follow-up options', () => {
  const baseInput: FollowUpGeneratorInput = {
    issue_id: 'issue-1',
    classification: {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    },
    confidence_by_field: { Sub_Location: 0.3 },
    missing_fields: [],
    fields_needing_input: ['Sub_Location'],
    previous_questions: [],
    turn_number: 1,
    total_questions_asked: 0,
    taxonomy_version: '1.0',
    prompt_version: '1.0',
    cue_version: '1.2.0',
    original_text: 'my toilet is leaking',
  };

  it('filters out invalid Sub_Location options for suite issue', async () => {
    // LLM returns parking_garage and elevator which are invalid for Location=suite
    const mockLlm = async () => ({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Where is this issue?',
          options: ['bathroom', 'kitchen', 'parking_garage', 'elevator'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(baseInput, mockLlm, 3);
    expect(result.status).toBe('ok');
    const question = result.output!.questions[0];
    // With Location=suite AND Maintenance_Object=toilet, intersection yields only bathroom
    expect(question.options).toContain('bathroom');
    expect(question.options).not.toContain('parking_garage');
    expect(question.options).not.toContain('elevator');
    expect(question.options).not.toContain('kitchen'); // toilet constrains to bathroom only
  });

  it('filters Maintenance_Problem options for toilet', async () => {
    const input: FollowUpGeneratorInput = {
      ...baseInput,
      fields_needing_input: ['Maintenance_Problem'],
      confidence_by_field: { Maintenance_Problem: 0.3 },
    };

    const mockLlm = async () => ({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Maintenance_Problem',
          prompt: 'What is the problem?',
          options: ['leak', 'clog', 'no_heat', 'infestation'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, mockLlm, 3);
    expect(result.status).toBe('ok');
    const question = result.output!.questions[0];
    expect(question.options).toContain('leak');
    expect(question.options).toContain('clog');
    expect(question.options).not.toContain('no_heat');
    expect(question.options).not.toContain('infestation');
  });

  it('keeps all options when no constraint applies', async () => {
    const input: FollowUpGeneratorInput = {
      ...baseInput,
      classification: { Category: 'maintenance' },
      fields_needing_input: ['Location'],
      confidence_by_field: { Location: 0.3 },
    };

    const mockLlm = async () => ({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Location',
          prompt: 'Where is this issue located?',
          options: ['suite', 'building_interior', 'building_exterior'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, mockLlm, 3);
    expect(result.status).toBe('ok');
    const question = result.output!.questions[0];
    // Location has no parent constraints, so all options kept
    expect(question.options).toEqual(['suite', 'building_interior', 'building_exterior']);
  });

  it('falls back to original options if all filtered out', async () => {
    // Edge case: all options invalid (shouldn't happen in practice)
    const input: FollowUpGeneratorInput = {
      ...baseInput,
      classification: { Category: 'maintenance', Location: 'suite', Maintenance_Object: 'toilet' },
      fields_needing_input: ['Sub_Location'],
      confidence_by_field: { Sub_Location: 0.3 },
    };

    const mockLlm = async () => ({
      questions: [
        {
          question_id: 'q1',
          field_target: 'Sub_Location',
          prompt: 'Where is this?',
          options: ['parking_garage', 'elevator'],
          answer_type: 'enum',
        },
      ],
    });

    const result = await callFollowUpGenerator(input, mockLlm, 3);
    expect(result.status).toBe('ok');
    // Falls back to original options when filtering would remove everything
    expect(result.output!.questions[0].options.length).toBeGreaterThan(0);
  });
});

import { randomUUID } from 'crypto';
import type { FollowUpGeneratorInput, FollowUpGeneratorOutput } from '@wo-agent/schemas';

/**
 * Question templates keyed by field_target. All option values are valid
 * entries in taxonomy.json for the corresponding field.
 */
const QUESTION_TEMPLATES: Record<
  string,
  { prompt: string; answer_type: 'enum' | 'yes_no' | 'text'; options: readonly string[] }
> = {
  Location: {
    prompt: 'Where exactly is this issue? Is it inside your unit or in a common area?',
    answer_type: 'enum',
    options: ['suite', 'building_interior', 'building_exterior'],
  },
  Sub_Location: {
    prompt: 'Which room or area is this in?',
    answer_type: 'enum',
    options: ['kitchen', 'bathroom', 'bedroom', 'hallways_stairwells', 'general'],
  },
  Maintenance_Category: {
    prompt: 'What type of maintenance issue is this?',
    answer_type: 'enum',
    options: ['plumbing', 'electrical', 'hvac', 'pest_control', 'general_maintenance'],
  },
  Maintenance_Object: {
    prompt: 'What specific item or fixture is affected?',
    answer_type: 'text',
    options: [],
  },
  Maintenance_Problem: {
    prompt: 'Can you describe what is happening with the issue in more detail?',
    answer_type: 'text',
    options: [],
  },
  Priority: {
    prompt: 'How urgent is this issue?',
    answer_type: 'enum',
    options: ['low', 'normal', 'high', 'emergency'],
  },
};

/**
 * Deterministic demo follow-up generator. Produces questions for each field
 * listed in fields_needing_input, using pre-built templates with valid
 * taxonomy options. Used when USE_DEMO_FIXTURES=true.
 */
export function createDemoFollowupGenerator(): (
  input: FollowUpGeneratorInput,
) => Promise<FollowUpGeneratorOutput> {
  return async (input: FollowUpGeneratorInput): Promise<FollowUpGeneratorOutput> => {
    if (input.fields_needing_input.length === 0) {
      return { questions: [] };
    }

    const questions = input.fields_needing_input
      .filter((field) => field in QUESTION_TEMPLATES)
      .map((field) => {
        const template = QUESTION_TEMPLATES[field];
        return {
          question_id: randomUUID(),
          field_target: field,
          prompt: template.prompt,
          options: [...template.options],
          answer_type: template.answer_type,
        };
      });

    return { questions };
  };
}

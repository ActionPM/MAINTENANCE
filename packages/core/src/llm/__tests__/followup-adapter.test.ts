import { describe, it, expect, vi } from 'vitest';
import { createFollowUpAdapter } from '../adapters/followup-adapter.js';
import type { LlmClient } from '../anthropic-client.js';
import type { FollowUpGeneratorInput } from '@wo-agent/schemas';

function mockClient(responseText: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(responseText),
  };
}

const VALID_INPUT: FollowUpGeneratorInput = {
  issue_id: 'issue-1',
  classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
  confidence_by_field: { Sub_Location: 0.4, Maintenance_Object: 0.3 },
  missing_fields: ['Sub_Location'],
  fields_needing_input: ['Sub_Location', 'Maintenance_Object'],
  previous_questions: [],
  turn_number: 1,
  total_questions_asked: 0,
  taxonomy_version: '1.0.0',
  prompt_version: '1.0.0',
};

describe('createFollowUpAdapter', () => {
  it('calls LLM and parses follow-up questions', async () => {
    const responseJson = JSON.stringify({
      questions: [
        {
          question_id: 'q-1',
          field_target: 'Sub_Location',
          prompt: 'Where in your unit is the plumbing issue?',
          options: ['kitchen', 'bathroom', 'general'],
          answer_type: 'enum',
        },
      ],
    });
    const client = mockClient(responseJson);
    const adapter = createFollowUpAdapter(client);

    const result = await adapter(VALID_INPUT);
    expect(result).toHaveProperty('questions');
    expect((result as any).questions).toHaveLength(1);
  });

  it('includes fields_needing_input in the user message', async () => {
    const client = mockClient('{"questions":[]}');
    const adapter = createFollowUpAdapter(client);
    await adapter(VALID_INPUT);

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('Sub_Location');
    expect(call.userMessage).toContain('Maintenance_Object');
  });

  it('includes retry context when provided', async () => {
    const client = mockClient('{"questions":[]}');
    const adapter = createFollowUpAdapter(client);
    await adapter(VALID_INPUT, { retryHint: 'schema_errors' });

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('schema_errors');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createClassifierAdapter } from '../adapters/classifier-adapter.js';
import type { LlmClient } from '../anthropic-client.js';
import type { IssueClassifierInput } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';

function mockClient(responseText: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(responseText),
  };
}

const VALID_INPUT: IssueClassifierInput = {
  issue_id: 'issue-1',
  issue_summary: 'Toilet is leaking',
  raw_excerpt: 'My toilet is leaking water onto the bathroom floor',
  taxonomy_version: '1.0.0',
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
};

describe('createClassifierAdapter', () => {
  const taxonomy = loadTaxonomy();

  it('calls LLM with taxonomy in the prompt and parses response', async () => {
    const responseJson = JSON.stringify({
      issue_id: 'issue-1',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'other_mgmt_obj',
        Priority: 'normal',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.85,
        Sub_Location: 0.9,
        Maintenance_Category: 0.92,
        Maintenance_Object: 0.95,
        Maintenance_Problem: 0.93,
        Management_Category: 0.0,
        Management_Object: 0.0,
        Priority: 0.7,
      },
      missing_fields: [],
      needs_human_triage: false,
    });
    const client = mockClient(responseJson);
    const adapter = createClassifierAdapter(client, taxonomy);

    const result = await adapter(VALID_INPUT);
    expect(result).toHaveProperty('issue_id', 'issue-1');
    expect(result).toHaveProperty('classification');
  });

  it('includes retry context in the prompt when provided', async () => {
    const client = mockClient(
      '{"issue_id":"issue-1","classification":{},"model_confidence":{},"missing_fields":[],"needs_human_triage":false}',
    );
    const adapter = createClassifierAdapter(client, taxonomy);
    await adapter(VALID_INPUT, {
      retryHint: 'domain_constraint',
      constraint: 'Set maintenance fields to N/A',
    });

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('domain_constraint');
    expect(call.userMessage).toContain('Set maintenance fields to N/A');
  });

  it('includes followup_answers when present', async () => {
    const client = mockClient(
      '{"issue_id":"issue-1","classification":{},"model_confidence":{},"missing_fields":[],"needs_human_triage":false}',
    );
    const adapter = createClassifierAdapter(client, taxonomy);
    const inputWithAnswers: IssueClassifierInput = {
      ...VALID_INPUT,
      followup_answers: [{ field_target: 'Sub_Location', answer: 'bathroom' }],
    };
    await adapter(inputWithAnswers);

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('bathroom');
    expect(call.userMessage).toContain('Sub_Location');
  });
});

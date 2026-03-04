import { describe, it, expect, vi } from 'vitest';
import { createSplitterAdapter } from '../adapters/splitter-adapter.js';
import type { LlmClient } from '../anthropic-client.js';
import type { IssueSplitterInput } from '@wo-agent/schemas';

function mockClient(responseText: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(responseText),
  };
}

const VALID_INPUT: IssueSplitterInput = {
  raw_text: 'My toilet is leaking and the kitchen light is flickering',
  conversation_id: 'conv-1',
  taxonomy_version: '1.0.0',
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
};

describe('createSplitterAdapter', () => {
  it('returns a function that calls the LLM and parses the JSON response', async () => {
    const responseJson = JSON.stringify({
      issues: [
        { issue_id: 'issue-1', summary: 'Toilet leak', raw_excerpt: 'My toilet is leaking' },
        { issue_id: 'issue-2', summary: 'Kitchen light flickering', raw_excerpt: 'the kitchen light is flickering' },
      ],
      issue_count: 2,
    });
    const client = mockClient(responseJson);
    const adapter = createSplitterAdapter(client);

    const result = await adapter(VALID_INPUT);
    expect(result).toHaveProperty('issue_count', 2);
    expect(result).toHaveProperty('issues');
    expect(client.complete).toHaveBeenCalledOnce();
  });

  it('includes raw_text in the user message', async () => {
    const client = mockClient('{"issues":[],"issue_count":0}');
    const adapter = createSplitterAdapter(client);
    await adapter(VALID_INPUT);

    const call = vi.mocked(client.complete).mock.calls[0][0];
    expect(call.userMessage).toContain('My toilet is leaking');
  });

  it('propagates LLM errors', async () => {
    const client: LlmClient = {
      complete: vi.fn().mockRejectedValue(new Error('API rate limit')),
    };
    const adapter = createSplitterAdapter(client);
    await expect(adapter(VALID_INPUT)).rejects.toThrow('API rate limit');
  });
});

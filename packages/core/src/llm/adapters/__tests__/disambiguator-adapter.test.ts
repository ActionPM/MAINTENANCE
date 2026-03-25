import { describe, it, expect, vi } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import type { DisambiguatorInput } from '@wo-agent/schemas';
import { createDisambiguatorAdapter } from '../disambiguator-adapter.js';
import type { LlmClient } from '../../anthropic-client.js';

const input: DisambiguatorInput = {
  message: 'Also my kitchen sink leaks',
  current_issues: [
    { issue_id: 'i1', summary: 'Broken faucet', raw_excerpt: 'bathroom faucet broken' },
  ],
  pending_questions: null,
  conversation_state: ConversationState.TENANT_CONFIRMATION_PENDING,
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
  conversation_id: 'conv-1',
};

describe('createDisambiguatorAdapter', () => {
  it('calls client.complete and returns parsed JSON', async () => {
    const client: LlmClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          classification: 'new_issue',
          reasoning: 'Kitchen sink is unrelated to bathroom faucet.',
        }),
      ),
    };

    const adapter = createDisambiguatorAdapter(client);
    const result = await adapter(input);

    expect(result.classification).toBe('new_issue');
    expect(result.reasoning).toContain('Kitchen sink');
    expect(client.complete).toHaveBeenCalledOnce();
  });

  it('passes system prompt and formatted user message to client', async () => {
    const client: LlmClient = {
      complete: vi.fn().mockResolvedValue('{"classification":"clarification","reasoning":"test"}'),
    };

    const adapter = createDisambiguatorAdapter(client);
    await adapter(input);

    const call = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toContain('message classifier');
    expect(call.userMessage).toContain('Also my kitchen sink leaks');
    expect(call.userMessage).toContain('Broken faucet');
    expect(call.maxTokens).toBe(256);
  });
});

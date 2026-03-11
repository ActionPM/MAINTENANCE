import { describe, it, expect, vi } from 'vitest';
import { createAnthropicClient } from '../anthropic-client.js';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

describe('createAnthropicClient', () => {
  it('creates a client with required config', () => {
    const client = createAnthropicClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
    expect(client.complete).toBeTypeOf('function');
  });

  it('calls the SDK and returns the text content', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"result": true}' }],
    });
    const client = createAnthropicClient({ apiKey: 'test-key' });
    const result = await client.complete({
      system: 'You are a helper.',
      userMessage: 'Hello',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    });
    expect(result).toBe('{"result": true}');
  });

  it('throws if no text content in response', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });
    const client = createAnthropicClient({ apiKey: 'test-key' });
    await expect(
      client.complete({
        system: 'test',
        userMessage: 'test',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
      }),
    ).rejects.toThrow('No text content');
  });
});

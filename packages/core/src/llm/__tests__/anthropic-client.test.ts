import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAnthropicClient, type LlmClient } from '../anthropic-client.js';

// Mock the SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"result": true}' }],
        }),
      };
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
    const client = createAnthropicClient({ apiKey: 'test-key' });
    // Override the mock for this specific call
    (client as any)._sdk.messages.create = vi.fn().mockResolvedValue({ content: [] });
    await expect(client.complete({
      system: 'test',
      userMessage: 'test',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    })).rejects.toThrow('No text content');
  });
});

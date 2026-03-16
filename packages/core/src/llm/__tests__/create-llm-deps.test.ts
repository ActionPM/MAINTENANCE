import { describe, it, expect, vi } from 'vitest';
import { createLlmDependencies, type LlmDependencies } from '../create-llm-deps.js';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"issues":[],"issue_count":0}' }],
        }),
      };
    },
  };
});

describe('createLlmDependencies', () => {
  it('returns all four LLM dependency functions', () => {
    const deps = createLlmDependencies({
      apiKey: 'test-key',
      taxonomy: { Category: ['maintenance'], Location: ['suite'] } as any,
    });

    expect(deps.issueSplitter).toBeTypeOf('function');
    expect(deps.issueClassifier).toBeTypeOf('function');
    expect(deps.followUpGenerator).toBeTypeOf('function');
    expect(deps.messageDisambiguator).toBeTypeOf('function');
  });

  it('uses provided model as default', () => {
    const deps = createLlmDependencies({
      apiKey: 'test-key',
      taxonomy: {} as any,
      defaultModel: 'claude-haiku-4-5-20251001',
    });

    expect(deps).toBeDefined();
  });
});

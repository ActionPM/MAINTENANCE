// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      }),
    };
  },
}));

describe('orchestrator-factory LLM wiring', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Reset the global singleton between tests
    const g = globalThis as any;
    delete g.__woAgentDeps;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('initializes with stubs when ANTHROPIC_API_KEY is not set', { timeout: 15_000 }, async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { getOrchestrator } = await import('../orchestrator-factory.js');
    const orchestrator = getOrchestrator();
    expect(orchestrator).toBeDefined();
  });

  it('initializes with real LLM when ANTHROPIC_API_KEY is set', { timeout: 15_000 }, async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-smoke-test';
    const { getOrchestrator } = await import('../orchestrator-factory.js');
    const orchestrator = getOrchestrator();
    expect(orchestrator).toBeDefined();
  });
});

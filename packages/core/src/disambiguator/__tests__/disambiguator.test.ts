import { describe, it, expect, vi } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import type { DisambiguatorInput } from '@wo-agent/schemas';
import { callDisambiguator } from '../disambiguator.js';

const input: DisambiguatorInput = {
  message: 'Also the garage door is broken',
  current_issues: [
    { issue_id: 'i1', summary: 'Broken faucet', raw_excerpt: 'bathroom faucet broken' },
  ],
  pending_questions: null,
  conversation_state: ConversationState.TENANT_CONFIRMATION_PENDING,
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
  conversation_id: 'conv-1',
};

describe('callDisambiguator', () => {
  it('returns classification from valid LLM response', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      classification: 'new_issue',
      reasoning: 'Garage door is a different system from bathroom faucet.',
    });

    const result = await callDisambiguator(input, llmCall);

    expect(result.classification).toBe('new_issue');
    expect(result.reasoning).toContain('Garage door');
    expect(result.isFailSafe).toBe(false);
  });

  it('returns clarification from valid LLM response', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      classification: 'clarification',
      reasoning: 'Provides more context about the existing issue.',
    });

    const result = await callDisambiguator(input, llmCall);

    expect(result.classification).toBe('clarification');
    expect(result.isFailSafe).toBe(false);
  });

  it('retries once on schema validation failure then returns valid result', async () => {
    const llmCall = vi.fn().mockResolvedValueOnce({ bad: 'data' }).mockResolvedValueOnce({
      classification: 'new_issue',
      reasoning: 'Second attempt succeeded.',
    });

    const result = await callDisambiguator(input, llmCall);

    expect(result.classification).toBe('new_issue');
    expect(result.isFailSafe).toBe(false);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('returns fail-safe clarification after two schema failures', async () => {
    const llmCall = vi.fn().mockResolvedValue({ bad: 'data' });

    const result = await callDisambiguator(input, llmCall);

    expect(result.classification).toBe('clarification');
    expect(result.isFailSafe).toBe(true);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('returns fail-safe clarification immediately on LLM exception (no retry)', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('API timeout'));

    const result = await callDisambiguator(input, llmCall);

    expect(result.classification).toBe('clarification');
    expect(result.isFailSafe).toBe(true);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('records metric on schema validation failure', async () => {
    const llmCall = vi.fn().mockResolvedValue({ bad: 'data' });
    const metricsRecorder = { record: vi.fn().mockResolvedValue(undefined) };

    await callDisambiguator(input, llmCall, metricsRecorder as any);

    expect(metricsRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metric_name: 'schema_validation_failure_total',
        component: 'disambiguator',
      }),
    );
  });

  it('records metric on LLM exception', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('API error'));
    const metricsRecorder = { record: vi.fn().mockResolvedValue(undefined) };

    await callDisambiguator(input, llmCall, metricsRecorder as any);

    expect(metricsRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metric_name: 'llm_call_failure_total',
        component: 'disambiguator',
      }),
    );
  });

  it('passes observability context to LLM call when provided', async () => {
    const llmCall = vi.fn().mockResolvedValue({
      classification: 'clarification',
      reasoning: 'test',
    });
    const obsCtx = { request_id: 'req-1', timestamp: '2026-01-01T00:00:00Z' };

    await callDisambiguator(input, llmCall, undefined, obsCtx as any);

    expect(llmCall).toHaveBeenCalledWith(input, obsCtx);
  });
});

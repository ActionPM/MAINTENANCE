import { describe, it, expect, vi } from 'vitest';
import {
  callIssueSplitter,
  SplitterError,
  SplitterErrorCode,
} from '../../splitter/issue-splitter.js';
import type { IssueSplitterInput, IssueSplitterOutput } from '@wo-agent/schemas';

const VALID_INPUT: IssueSplitterInput = {
  raw_text: 'My toilet is leaking and the kitchen light is broken',
  conversation_id: 'conv-1',
  taxonomy_version: '1.0.0',
  model_id: 'gpt-4',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

const VALID_OUTPUT: IssueSplitterOutput = {
  issues: [
    { issue_id: 'i1', summary: 'Toilet leaking', raw_excerpt: 'toilet is leaking' },
    { issue_id: 'i2', summary: 'Kitchen light broken', raw_excerpt: 'kitchen light is broken' },
  ],
  issue_count: 2,
};

describe('callIssueSplitter', () => {
  it('returns validated output on success', async () => {
    const llmCall = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const result = await callIssueSplitter(VALID_INPUT, llmCall);
    expect(result).toEqual(VALID_OUTPUT);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries once on schema validation failure then succeeds', async () => {
    const invalidOutput = { issues: [{ summary: 'no id' }], issue_count: 1 };
    const llmCall = vi
      .fn()
      .mockResolvedValueOnce(invalidOutput)
      .mockResolvedValueOnce(VALID_OUTPUT);
    const result = await callIssueSplitter(VALID_INPUT, llmCall);
    expect(result).toEqual(VALID_OUTPUT);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws SplitterError after retry also fails validation', async () => {
    const invalidOutput = { issues: [], issue_count: 0 };
    const llmCall = vi.fn().mockResolvedValue(invalidOutput);
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toThrow(SplitterError);
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toMatchObject({
      code: SplitterErrorCode.SCHEMA_VALIDATION_FAILED,
    });
    expect(llmCall).toHaveBeenCalledTimes(4); // 2 calls per invocation (initial + retry)
  });

  it('throws SplitterError when LLM call throws', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toThrow(SplitterError);
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toMatchObject({
      code: SplitterErrorCode.LLM_CALL_FAILED,
    });
  });

  it('validates issue_count matches issues array length', async () => {
    const mismatch: IssueSplitterOutput = {
      issues: [{ issue_id: 'i1', summary: 'One issue', raw_excerpt: 'one' }],
      issue_count: 5, // mismatch
    };
    const llmCall = vi.fn().mockResolvedValue(mismatch);
    // First call returns mismatch, retry also returns mismatch
    await expect(callIssueSplitter(VALID_INPUT, llmCall)).rejects.toThrow(SplitterError);
  });
});

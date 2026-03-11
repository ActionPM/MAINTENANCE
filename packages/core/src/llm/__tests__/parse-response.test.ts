import { describe, it, expect } from 'vitest';
import { extractJsonFromResponse } from '../parse-response.js';

describe('extractJsonFromResponse', () => {
  it('parses a plain JSON string', () => {
    const input = '{"issues": [], "issue_count": 0}';
    expect(extractJsonFromResponse(input)).toEqual({ issues: [], issue_count: 0 });
  });

  it('extracts JSON from a markdown code block', () => {
    const input = 'Here is the result:\n```json\n{"issues": [], "issue_count": 0}\n```';
    expect(extractJsonFromResponse(input)).toEqual({ issues: [], issue_count: 0 });
  });

  it('extracts JSON from a code block without language tag', () => {
    const input = 'Result:\n```\n{"key": "value"}\n```';
    expect(extractJsonFromResponse(input)).toEqual({ key: 'value' });
  });

  it('extracts the first JSON object when surrounded by text', () => {
    const input =
      'I analyzed the text. {"issue_count": 1, "issues": [{"issue_id": "x", "summary": "leak", "raw_excerpt": "leak"}]} That is my answer.';
    const result = extractJsonFromResponse(input);
    expect(result).toHaveProperty('issue_count', 1);
  });

  it('throws on empty string', () => {
    expect(() => extractJsonFromResponse('')).toThrow('No JSON found');
  });

  it('throws on non-JSON text', () => {
    expect(() => extractJsonFromResponse('I cannot help with that.')).toThrow('No JSON found');
  });
});

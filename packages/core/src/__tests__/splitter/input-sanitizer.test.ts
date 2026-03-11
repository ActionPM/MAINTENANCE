import { describe, it, expect } from 'vitest';
import { sanitizeIssueText, validateIssueConstraints } from '../../splitter/input-sanitizer.js';

describe('sanitizeIssueText', () => {
  it('passes through clean text unchanged', () => {
    expect(sanitizeIssueText('Toilet is leaking')).toBe('Toilet is leaking');
  });

  it('strips control characters', () => {
    expect(sanitizeIssueText('Toilet\x00 is\x07 leaking')).toBe('Toilet is leaking');
  });

  it('preserves newlines and tabs as spaces', () => {
    expect(sanitizeIssueText('Line one\nLine two\tEnd')).toBe('Line one Line two End');
  });

  it('normalizes consecutive whitespace', () => {
    expect(sanitizeIssueText('Too   many    spaces')).toBe('Too many spaces');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeIssueText('  padded  ')).toBe('padded');
  });

  it('escapes HTML angle brackets', () => {
    expect(sanitizeIssueText('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;',
    );
  });

  it('escapes ampersands', () => {
    expect(sanitizeIssueText('R&D department')).toBe('R&amp;D department');
  });

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(600);
    expect(sanitizeIssueText(long, 500).length).toBe(500);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeIssueText('')).toBe('');
  });
});

describe('validateIssueConstraints', () => {
  it('returns valid for normal input', () => {
    const result = validateIssueConstraints('Fix the sink', 3);
    expect(result.valid).toBe(true);
  });

  it('rejects empty text after sanitization', () => {
    const result = validateIssueConstraints('', 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects text exceeding 500 chars', () => {
    const result = validateIssueConstraints('a'.repeat(501), 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
  });

  it('rejects when adding would exceed 10 issues', () => {
    const result = validateIssueConstraints('Valid text', 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10');
  });

  it('allows adding when at 9 issues (reaching 10)', () => {
    const result = validateIssueConstraints('Valid text', 9);
    expect(result.valid).toBe(true);
  });

  it('skips count check when checkCount is false', () => {
    const result = validateIssueConstraints('Valid text', 10, { checkCount: false });
    expect(result.valid).toBe(true);
  });

  it('still validates text when checkCount is false', () => {
    const result = validateIssueConstraints('a'.repeat(501), 10, { checkCount: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
  });
});

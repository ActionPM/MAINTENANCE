import { describe, it, expect } from 'vitest';

/**
 * Tests for the form-decoding logic used by Twilio webhook routes.
 * application/x-www-form-urlencoded encodes spaces as +, but
 * decodeURIComponent does NOT convert + to space — only %20.
 */

/** The decoding logic used in both voice-status and sms-reply routes. */
function decodeFormParam(s: string): string {
  return decodeURIComponent(s.replace(/\+/g, ' '));
}

function parseFormBody(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of text.split('&')) {
    const [key, value] = pair.split('=').map(decodeFormParam);
    if (key) params[key] = value ?? '';
  }
  return params;
}

describe('Twilio form body parsing', () => {
  it('decodes + as space in values', () => {
    const params = parseFormBody('Body=ACCEPT+abcd1234&From=%2B15551234');
    expect(params['Body']).toBe('ACCEPT abcd1234');
    expect(params['From']).toBe('+15551234');
  });

  it('decodes + as space in keys too', () => {
    const params = parseFormBody('Call+Status=completed');
    expect(params['Call Status']).toBe('completed');
  });

  it('handles %20 spaces correctly', () => {
    const params = parseFormBody('Body=ACCEPT%20abcd1234');
    expect(params['Body']).toBe('ACCEPT abcd1234');
  });

  it('handles empty body', () => {
    const params = parseFormBody('Body=&From=%2B15551234');
    expect(params['Body']).toBe('');
    expect(params['From']).toBe('+15551234');
  });

  it('handles special characters', () => {
    const params = parseFormBody('Body=ACCEPT+abc%26def');
    expect(params['Body']).toBe('ACCEPT abc&def');
  });
});

describe('parseReply logic', () => {
  /** Mirrors the parseReply function from sms-reply route. */
  function parseReply(
    body: string,
  ): { action: 'ACCEPT' | 'IGNORE' | 'unknown'; ref: string | null } {
    const parts = body.trim().split(/\s+/);
    const action = parts[0]?.toUpperCase();
    const ref = parts[1] ?? null;

    if (action === 'ACCEPT') return { action: 'ACCEPT', ref };
    if (action === 'IGNORE') return { action: 'IGNORE', ref };
    return { action: 'unknown', ref: null };
  }

  it('parses ACCEPT with ref code', () => {
    const result = parseReply('ACCEPT abcd1234');
    expect(result).toEqual({ action: 'ACCEPT', ref: 'abcd1234' });
  });

  it('parses IGNORE with ref code', () => {
    const result = parseReply('IGNORE abcd1234');
    expect(result).toEqual({ action: 'IGNORE', ref: 'abcd1234' });
  });

  it('parses ACCEPT without ref code', () => {
    const result = parseReply('ACCEPT');
    expect(result).toEqual({ action: 'ACCEPT', ref: null });
  });

  it('is case-insensitive', () => {
    expect(parseReply('accept abcd1234')).toEqual({ action: 'ACCEPT', ref: 'abcd1234' });
    expect(parseReply('Accept ABCD1234')).toEqual({ action: 'ACCEPT', ref: 'ABCD1234' });
  });

  it('rejects unknown replies', () => {
    expect(parseReply('yes')).toEqual({ action: 'unknown', ref: null });
    expect(parseReply('OK')).toEqual({ action: 'unknown', ref: null });
  });

  it('handles leading/trailing whitespace', () => {
    const result = parseReply('  ACCEPT  abcd1234  ');
    expect(result).toEqual({ action: 'ACCEPT', ref: 'abcd1234' });
  });

  it('end-to-end: Twilio form body with + decoded correctly before parsing', () => {
    // Simulates the full path: Twilio sends Body=ACCEPT+abcd1234
    const params = parseFormBody('Body=ACCEPT+abcd1234');
    const result = parseReply(params['Body']);
    expect(result).toEqual({ action: 'ACCEPT', ref: 'abcd1234' });
  });
});

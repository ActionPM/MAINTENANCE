// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { validateTwilioSignature } from '../emergency/twilio-signature.js';

function computeSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
}

describe('validateTwilioSignature', () => {
  const authToken = 'test-auth-token-12345';
  const url = 'https://example.com/api/webhooks/twilio/sms-reply';
  const params = { From: '+15551234567', Body: 'ACCEPT abc12345' };

  it('returns true for a valid signature', () => {
    const signature = computeSignature(authToken, url, params);

    expect(validateTwilioSignature(authToken, signature, url, params)).toBe(true);
  });

  it('returns false for a tampered signature', () => {
    expect(validateTwilioSignature(authToken, 'bad-signature', url, params)).toBe(false);
  });

  it('returns false when params are tampered', () => {
    const signature = computeSignature(authToken, url, params);
    const tampered = { ...params, Body: 'ACCEPT hacked00' };

    expect(validateTwilioSignature(authToken, signature, url, tampered)).toBe(false);
  });

  it('returns false when URL is tampered', () => {
    const signature = computeSignature(authToken, url, params);

    expect(
      validateTwilioSignature(authToken, signature, 'https://evil.com/hook', params),
    ).toBe(false);
  });

  it('sorts params by key for signature computation', () => {
    const paramsA = { Z: '1', A: '2' };
    const paramsB = { A: '2', Z: '1' };
    const sigA = computeSignature(authToken, url, paramsA);

    expect(validateTwilioSignature(authToken, sigA, url, paramsB)).toBe(true);
  });
});

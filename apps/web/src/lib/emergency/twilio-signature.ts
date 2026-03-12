import { createHmac } from 'crypto';

/**
 * Validate Twilio webhook request signature (plan §3.4).
 *
 * Twilio signs requests using HMAC-SHA1 of the full URL + sorted POST params.
 * This prevents spoofed ACCEPT replies.
 *
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  // Build data string: URL + sorted param key-value pairs
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const expected = createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

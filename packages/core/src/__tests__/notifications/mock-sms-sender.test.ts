import { describe, it, expect } from 'vitest';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';

describe('MockSmsSender', () => {
  it('records sent messages and returns success', async () => {
    const sender = new MockSmsSender();
    const result = await sender.send('+14165551234', 'Test message');
    expect(result.success).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toEqual({ phone: '+14165551234', message: 'Test message' });
  });

  it('can be configured to fail', async () => {
    const sender = new MockSmsSender({ shouldFail: true, failureError: 'Service unavailable' });
    const result = await sender.send('+14165551234', 'Test message');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Service unavailable');
    expect(sender.sent).toHaveLength(0);
  });
});

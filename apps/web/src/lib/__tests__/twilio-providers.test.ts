import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwilioSmsProvider } from '../emergency/twilio-sms';
import { TwilioVoiceProvider } from '../emergency/twilio-voice';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('TwilioSmsProvider', () => {
  it('rejects self-targeted SMS before calling Twilio', async () => {
    const provider = new TwilioSmsProvider({
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+15551111111',
    });

    await expect(provider.sendSms('+1 (555) 111-1111', 'test')).rejects.toThrow(
      'Refusing to send Twilio SMS',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('TwilioVoiceProvider', () => {
  it('rejects self-targeted calls before calling Twilio', async () => {
    const provider = new TwilioVoiceProvider({
      accountSid: 'AC123',
      authToken: 'auth-token',
      fromNumber: '+15552222222',
    });

    await expect(
      provider.placeCall('+1 (555) 222-2222', '<Response/>', 'https://example.com/status'),
    ).rejects.toThrow('Refusing to place a Twilio call');
    expect(fetch).not.toHaveBeenCalled();
  });
});

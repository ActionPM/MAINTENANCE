import type { VoiceCallProvider } from '@wo-agent/core';

interface TwilioVoiceConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
}

/**
 * Twilio voice call provider (plan §3.2).
 * Places outbound alerting calls with TwiML <Say> script.
 * Voice calls are alerting only — no DTMF/IVR in Phase 1.
 */
export class TwilioVoiceProvider implements VoiceCallProvider {
  private readonly config: TwilioVoiceConfig;

  constructor(config: TwilioVoiceConfig) {
    this.config = config;
  }

  async placeCall(
    to: string,
    twiml: string,
    statusCallbackUrl: string,
  ): Promise<{ callSid: string }> {
    if (samePhoneNumber(to, this.config.fromNumber)) {
      throw new Error('Refusing to place a Twilio call when To and From resolve to the same number');
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`;

    const body = new URLSearchParams({
      To: to,
      From: this.config.fromNumber,
      Twiml: twiml,
      StatusCallback: statusCallbackUrl,
      StatusCallbackEvent: 'completed',
      Timeout: '60',
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Twilio voice call failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { sid: string };
    return { callSid: data.sid };
  }
}

function samePhoneNumber(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length === 10) return `1${digits}`;
    return digits;
  };

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

import type { SmsProvider } from '@wo-agent/core';

interface TwilioSmsConfig {
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string;
}

/**
 * Twilio SMS provider (plan §3.3).
 * Sends outbound SMS messages for escalation prompts and stand-down notifications.
 */
export class TwilioSmsProvider implements SmsProvider {
  private readonly config: TwilioSmsConfig;

  constructor(config: TwilioSmsConfig) {
    this.config = config;
  }

  async sendSms(to: string, body: string): Promise<{ messageSid: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

    const params = new URLSearchParams({
      To: to,
      From: this.config.fromNumber,
      Body: body,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Twilio SMS send failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { sid: string };
    return { messageSid: data.sid };
  }
}

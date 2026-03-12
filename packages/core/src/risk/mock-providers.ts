import type { VoiceCallProvider, SmsProvider } from './provider-types.js';

/** Recorded call for test inspection. */
export interface RecordedCall {
  readonly to: string;
  readonly twiml: string;
  readonly statusCallbackUrl: string;
  readonly callSid: string;
}

/** Recorded SMS for test inspection. */
export interface RecordedSms {
  readonly to: string;
  readonly body: string;
  readonly messageSid: string;
}

/**
 * Mock voice provider — records calls instead of placing real ones.
 */
export class MockVoiceProvider implements VoiceCallProvider {
  readonly calls: RecordedCall[] = [];
  private callCounter = 0;

  async placeCall(
    to: string,
    twiml: string,
    statusCallbackUrl: string,
  ): Promise<{ callSid: string }> {
    const callSid = `CA-mock-${++this.callCounter}`;
    this.calls.push({ to, twiml, statusCallbackUrl, callSid });
    return { callSid };
  }

  clear(): void {
    this.calls.length = 0;
    this.callCounter = 0;
  }
}

/**
 * Mock SMS provider — records messages instead of sending real ones.
 */
export class MockSmsProvider implements SmsProvider {
  readonly messages: RecordedSms[] = [];
  private msgCounter = 0;

  async sendSms(to: string, body: string): Promise<{ messageSid: string }> {
    const messageSid = `SM-mock-${++this.msgCounter}`;
    this.messages.push({ to, body, messageSid });
    return { messageSid };
  }

  clear(): void {
    this.messages.length = 0;
    this.msgCounter = 0;
  }
}

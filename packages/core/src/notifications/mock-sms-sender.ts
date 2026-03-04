import type { SmsSender } from './types.js';

export interface MockSmsSenderConfig {
  readonly shouldFail?: boolean;
  readonly failureError?: string;
}

/**
 * Mock SMS sender for testing and MVP (spec §20).
 * Records all send attempts for assertion.
 */
export class MockSmsSender implements SmsSender {
  readonly sent: Array<{ phone: string; message: string }> = [];
  private readonly config: MockSmsSenderConfig;

  constructor(config: MockSmsSenderConfig = {}) {
    this.config = config;
  }

  async send(phoneNumber: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (this.config.shouldFail) {
      return { success: false, error: this.config.failureError ?? 'Mock failure' };
    }
    this.sent.push({ phone: phoneNumber, message });
    return { success: true };
  }
}

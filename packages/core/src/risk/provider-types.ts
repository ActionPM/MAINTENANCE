/**
 * Voice call provider interface (plan §3.6).
 * Abstracts placing outbound alerting calls.
 * Phase 1: Twilio. Voice calls are alerting only (no DTMF/IVR).
 */
export interface VoiceCallProvider {
  placeCall(
    to: string,
    twiml: string,
    statusCallbackUrl: string,
  ): Promise<{ callSid: string }>;
}

/**
 * SMS provider interface (plan §3.6).
 * Abstracts sending outbound SMS messages.
 * Phase 1: Twilio.
 */
export interface SmsProvider {
  sendSms(to: string, body: string): Promise<{ messageSid: string }>;
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockValidateTwilioSignature = vi.fn();
const mockProcessCallOutcome = vi.fn();
const mockGetEscalationCoordinatorDeps = vi.fn();
const mockGetEscalationPlans = vi.fn();

vi.mock('@/lib/emergency/twilio-signature', () => ({
  validateTwilioSignature: (...args: unknown[]) => mockValidateTwilioSignature(...args),
}));

vi.mock('@wo-agent/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    processCallOutcome: (...args: unknown[]) => mockProcessCallOutcome(...args),
  };
});

vi.mock('@/lib/orchestrator-factory', () => ({
  getEscalationCoordinatorDeps: () => mockGetEscalationCoordinatorDeps(),
  getEscalationPlans: () => mockGetEscalationPlans(),
}));

import { NextRequest } from 'next/server';
import { POST } from '../voice-status/route.js';

function makeRequest(body: string, query = 'incidentId=inc-1&contactIndex=0') {
  const url = `http://localhost:3000/api/webhooks/twilio/voice-status${query ? `?${query}` : ''}`;
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'test-signature',
    },
    body,
  });
}

describe('POST /api/webhooks/twilio/voice-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    mockValidateTwilioSignature.mockReturnValue(true);
    mockGetEscalationCoordinatorDeps.mockReturnValue({
      incidentStore: {},
      voiceProvider: {},
      smsProvider: {},
      config: {},
      idGenerator: () => 'evt-1',
      clock: () => '2026-03-16T00:00:00.000Z',
      writeRiskEvent: vi.fn(),
    });
    mockGetEscalationPlans.mockReturnValue({ version: '1.0', plans: [] });
  });

  it('returns 403 when Twilio signature is invalid', async () => {
    mockValidateTwilioSignature.mockReturnValue(false);

    const res = await POST(
      makeRequest('CallSid=CA123&CallStatus=completed') as any, // NextRequest satisfies route handler signature
    );

    expect(res.status).toBe(403);
    expect(mockProcessCallOutcome).not.toHaveBeenCalled();
  });

  it('returns 500 when TWILIO_AUTH_TOKEN is not set', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;

    const res = await POST(
      makeRequest('CallSid=CA123&CallStatus=completed') as any, // NextRequest satisfies route handler signature
    );

    expect(res.status).toBe(500);
    expect(mockValidateTwilioSignature).not.toHaveBeenCalled();
  });

  it('calls processCallOutcome and returns 200 TwiML on valid request', async () => {
    mockProcessCallOutcome.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest('CallSid=CA123&CallStatus=completed') as any, // NextRequest satisfies route handler signature
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/xml');
    await expect(res.text()).resolves.toBe('<Response/>');
    expect(mockProcessCallOutcome).toHaveBeenCalledOnce();
    expect(mockProcessCallOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'inc-1',
        callSid: 'CA123',
        callStatus: 'completed',
        contactIndex: 0,
      }),
      expect.any(Object),
    );
  });

  it('returns empty TwiML when incidentId is missing', async () => {
    const res = await POST(
      makeRequest('CallSid=CA123&CallStatus=completed', '') as any, // NextRequest satisfies route handler signature
    );

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('<Response/>');
    expect(mockProcessCallOutcome).not.toHaveBeenCalled();
  });
});

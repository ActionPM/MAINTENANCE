import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockValidateTwilioSignature = vi.fn();
const mockProcessReplyForIncident = vi.fn();
const mockGetEscalationIncidentStore = vi.fn();
const mockGetEscalationCoordinatorDeps = vi.fn();
const mockGetEscalationPlans = vi.fn();

vi.mock('@/lib/emergency/twilio-signature', () => ({
  validateTwilioSignature: (...args: unknown[]) => mockValidateTwilioSignature(...args),
}));

vi.mock('@wo-agent/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    processReplyForIncident: (...args: unknown[]) => mockProcessReplyForIncident(...args),
  };
});

vi.mock('@/lib/orchestrator-factory', () => ({
  getEscalationIncidentStore: () => mockGetEscalationIncidentStore(),
  getEscalationCoordinatorDeps: () => mockGetEscalationCoordinatorDeps(),
  getEscalationPlans: () => mockGetEscalationPlans(),
}));

import { POST } from '../sms-reply/route.js';

function makeRequest(body: string) {
  return new Request('http://localhost:3000/api/webhooks/twilio/sms-reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'test-signature',
    },
    body,
  });
}

describe('POST /api/webhooks/twilio/sms-reply', () => {
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
      clock: () => '2026-03-15T00:00:00.000Z',
      writeRiskEvent: vi.fn(),
    });
    mockGetEscalationPlans.mockReturnValue({ version: '1.0', plans: [] });
  });

  it('returns confirmation TwiML when ACCEPT makes the sender the accepted responder', async () => {
    const incident = {
      incident_id: '2436b467-b19b-4bc5-b8e9-6cbcab635bea',
      conversation_id: 'conv-1',
      summary: 'Gas leak',
      status: 'active',
      contacted_phone_numbers: ['+16479855458'],
    };
    const acceptedIncident = {
      ...incident,
      status: 'accepted',
      accepted_by_phone: '+16479855458',
    };

    mockGetEscalationIncidentStore.mockReturnValue({
      getActiveByContactedPhone: vi.fn().mockResolvedValue([incident]),
      getById: vi.fn().mockResolvedValue(acceptedIncident),
    });

    const res = await POST(
      makeRequest('From=%2B16479855458&Body=ACCEPT') as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/xml');
    await expect(res.text()).resolves.toContain(
      'Accepted. You are now marked as the responder for this emergency.',
    );
    expect(mockProcessReplyForIncident).toHaveBeenCalledOnce();
  });
});

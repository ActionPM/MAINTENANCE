import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EscalationIncident, EscalationPlans, EscalationPlan } from '@wo-agent/schemas';
import type { EscalationCoordinatorDeps } from '../../risk/escalation-coordinator.js';
import {
  startIncident,
  processCallOutcome,
  processReplyForIncident,
  processDue,
  incidentRef,
} from '../../risk/escalation-coordinator.js';
import { InMemoryEscalationIncidentStore } from '../../risk/in-memory-incident-store.js';
import { MockVoiceProvider, MockSmsProvider } from '../../risk/mock-providers.js';

const PLAN: EscalationPlan = {
  plan_id: 'plan-1',
  building_id: 'bldg-1',
  contact_chain: [
    { role: 'super', contact_id: 'c1', name: 'Alice', phone: '+15551111111' },
    { role: 'manager', contact_id: 'c2', name: 'Bob', phone: '+15552222222' },
  ],
  exhaustion_behavior: {
    internal_alert: true,
    tenant_message_template: 'All contacts exhausted',
    retry_after_minutes: 5,
  },
};

const PLANS: EscalationPlans = {
  version: '1.0',
  plans: [PLAN],
};

function createDeps(overrides?: Partial<EscalationCoordinatorDeps>): EscalationCoordinatorDeps {
  const incidentStore = new InMemoryEscalationIncidentStore();
  const voiceProvider = new MockVoiceProvider();
  const smsProvider = new MockSmsProvider();
  return {
    incidentStore,
    voiceProvider,
    smsProvider,
    config: {
      maxCyclesDefault: 3,
      callTimeoutSeconds: 60,
      smsReplyTimeoutSeconds: 120,
      outboundFromNumber: '',
      internalAlertNumber: '',
      webhookBaseUrl: 'https://example.com',
      emergencyRoutingEnabled: true,
      processingLockDurationMs: 90000,
    },
    idGenerator: () => `id-${Math.random().toString(36).slice(2, 10)}`,
    clock: () => '2026-03-12T10:00:00.000Z',
    writeRiskEvent: vi.fn(),
    ...overrides,
  };
}

describe('incidentRef', () => {
  it('returns first 8 chars of incident ID', () => {
    expect(incidentRef('abcdef0123456789')).toBe('abcdef01');
  });
});

describe('startIncident', () => {
  it('creates an incident and places voice call + sends SMS', async () => {
    const deps = createDeps();
    const incident = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Pipe burst in unit 101',
      },
      deps,
    );

    expect(incident.status).toBe('active');
    expect(incident.conversation_id).toBe('conv-1');
    expect(incident.summary).toBe('Pipe burst in unit 101');
    expect(incident.contacted_phone_numbers).toContain('+15551111111');

    // Voice call should have been placed
    const calls = (deps.voiceProvider as MockVoiceProvider).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe('+15551111111');

    // SMS should have been sent inline
    const smsList = (deps.smsProvider as MockSmsProvider).messages;
    expect(smsList).toHaveLength(1);
    expect(smsList[0].to).toBe('+15551111111');
    expect(smsList[0].body).toContain('ACCEPT');
    expect(smsList[0].body).toContain('IGNORE');
  });

  it('rejects when routing is disabled', async () => {
    const deps = createDeps({
      config: {
        maxCyclesDefault: 3,
        callTimeoutSeconds: 60,
        smsReplyTimeoutSeconds: 120,
        outboundFromNumber: '',
        internalAlertNumber: '',
        webhookBaseUrl: 'https://example.com',
        emergencyRoutingEnabled: false,
        processingLockDurationMs: 90000,
      },
    });
    await expect(
      startIncident(
        {
          conversationId: 'conv-1',
          buildingId: 'bldg-1',
          escalationPlans: PLANS,
          summary: 'Test',
        },
        deps,
      ),
    ).rejects.toThrow('Emergency routing is disabled');
  });

  it('rejects when no plan exists for building', async () => {
    const deps = createDeps();
    await expect(
      startIncident(
        {
          conversationId: 'conv-1',
          buildingId: 'bldg-unknown',
          escalationPlans: PLANS,
          summary: 'Test',
        },
        deps,
      ),
    ).rejects.toThrow('No escalation plan found');
  });

  it('skips a contact whose phone matches the outbound sender number', async () => {
    const deps = createDeps({
      config: {
        maxCyclesDefault: 3,
        callTimeoutSeconds: 60,
        smsReplyTimeoutSeconds: 120,
        outboundFromNumber: '+1 (555) 111-1111',
        internalAlertNumber: '',
        webhookBaseUrl: 'https://example.com',
        emergencyRoutingEnabled: true,
        processingLockDurationMs: 90000,
      },
    });

    const incident = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Gas leak',
      },
      deps,
    );

    const calls = (deps.voiceProvider as MockVoiceProvider).calls;
    const smsList = (deps.smsProvider as MockSmsProvider).messages;

    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe('+15552222222');
    expect(smsList).toHaveLength(1);
    expect(smsList[0].to).toBe('+15552222222');
    expect(incident.current_contact_index).toBe(1);
    expect(incident.contacted_phone_numbers).toEqual(['+15552222222']);
  });

  it('skips the internal alert SMS when it matches the outbound sender number', async () => {
    const deps = createDeps({
      config: {
        maxCyclesDefault: 3,
        callTimeoutSeconds: 60,
        smsReplyTimeoutSeconds: 120,
        outboundFromNumber: '+15559999999',
        internalAlertNumber: '+1 (555) 999-9999',
        webhookBaseUrl: 'https://example.com',
        emergencyRoutingEnabled: true,
        processingLockDurationMs: 90000,
      },
    });
    const emptyPlan: EscalationPlan = {
      plan_id: 'plan-empty',
      building_id: 'bldg-empty',
      contact_chain: [],
      exhaustion_behavior: {
        internal_alert: true,
        tenant_message_template: 'All contacts exhausted',
        retry_after_minutes: 5,
      },
    };

    await startIncident(
      {
        conversationId: 'conv-empty',
        buildingId: 'bldg-empty',
        escalationPlans: { version: '1.0', plans: [emptyPlan] },
        summary: 'No one is on the contact chain',
      },
      deps,
    );

    expect((deps.smsProvider as MockSmsProvider).messages).toHaveLength(0);
  });
});

describe('processCallOutcome with contactIndex', () => {
  it('attributes call outcome to the correct contact when contactIndex is provided', async () => {
    const deps = createDeps();

    // Start an incident (contacts contact 0)
    const incident = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Fire in lobby',
      },
      deps,
    );

    // Simulate chain advancement (IGNORE moves to contact 1)
    const stored = await deps.incidentStore.getById(incident.incident_id);
    if (!stored) throw new Error('Incident not found');
    const advanced: EscalationIncident = {
      ...stored,
      current_contact_index: 1,
      updated_at: deps.clock(),
    };
    await deps.incidentStore.update(advanced, stored.row_version);

    // Late voice callback for contact 0 arrives with contactIndex=0
    await processCallOutcome(
      {
        incidentId: incident.incident_id,
        callSid: 'CA-test',
        callStatus: 'completed',
        escalationPlans: PLANS,
        contactIndex: 0,
      },
      deps,
    );

    // The attempt should be attributed to contact c1 (index 0), not c2 (index 1)
    const final = await deps.incidentStore.getById(incident.incident_id);
    expect(final!.attempts).toHaveLength(1);
    expect(final!.attempts[0].contact_id).toBe('c1');
    expect(final!.attempts[0].phone).toBe('+15551111111');
  });

  it('falls back to current_contact_index when contactIndex is omitted', async () => {
    const deps = createDeps();
    const incident = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Leak',
      },
      deps,
    );

    await processCallOutcome(
      {
        incidentId: incident.incident_id,
        callSid: 'CA-test',
        callStatus: 'no-answer',
        escalationPlans: PLANS,
        // contactIndex omitted
      },
      deps,
    );

    const final = await deps.incidentStore.getById(incident.incident_id);
    expect(final!.attempts).toHaveLength(1);
    expect(final!.attempts[0].contact_id).toBe('c1');
  });
});

describe('processReplyForIncident — ACCEPT idempotency', () => {
  it('second ACCEPT is rejected by CAS', async () => {
    const deps = createDeps();
    const incident = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Gas leak',
      },
      deps,
    );

    const stored = await deps.incidentStore.getById(incident.incident_id);
    if (!stored) throw new Error('Incident not found');

    // First ACCEPT succeeds
    await processReplyForIncident(
      {
        incident: stored,
        fromPhone: '+15551111111',
        reply: 'ACCEPT',
        rawBody: `ACCEPT ${incidentRef(stored.incident_id)}`,
        escalationPlans: PLANS,
        summary: stored.summary,
      },
      deps,
    );

    const accepted = await deps.incidentStore.getById(incident.incident_id);
    expect(accepted!.status).toBe('accepted');

    // Second ACCEPT from different phone — CAS conflict, no error thrown
    await processReplyForIncident(
      {
        incident: stored, // stale version
        fromPhone: '+15552222222',
        reply: 'ACCEPT',
        rawBody: `ACCEPT ${incidentRef(stored.incident_id)}`,
        escalationPlans: PLANS,
        summary: stored.summary,
      },
      deps,
    );

    // Still accepted by first responder
    const final = await deps.incidentStore.getById(incident.incident_id);
    expect(final!.accepted_by_phone).toBe('+15551111111');
  });
});

describe('SMS prompt includes ref code', () => {
  it('outbound SMS contains the incident ref code', async () => {
    const deps = createDeps();
    const incident = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Emergency test',
      },
      deps,
    );

    const smsList = (deps.smsProvider as MockSmsProvider).messages;
    const ref = incidentRef(incident.incident_id);
    expect(smsList[0].body).toContain(`Ref: ${ref}`);
    expect(smsList[0].body).toContain(`ACCEPT ${ref}`);
    expect(smsList[0].body).toContain(`IGNORE ${ref}`);
  });
});

describe('voice callback URL includes contactIndex', () => {
  it('callback URL contains incidentId and contactIndex', async () => {
    const deps = createDeps();
    await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Test',
      },
      deps,
    );

    const calls = (deps.voiceProvider as MockVoiceProvider).calls;
    expect(calls[0].statusCallbackUrl).toContain('contactIndex=0');
  });

  it('normalizes a trailing slash in webhookBaseUrl', async () => {
    const deps = createDeps({
      config: {
        maxCyclesDefault: 3,
        callTimeoutSeconds: 60,
        smsReplyTimeoutSeconds: 120,
        outboundFromNumber: '',
        internalAlertNumber: '',
        webhookBaseUrl: 'https://example.com/',
        emergencyRoutingEnabled: true,
        processingLockDurationMs: 90000,
      },
    });

    await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Test',
      },
      deps,
    );

    const calls = (deps.voiceProvider as MockVoiceProvider).calls;
    expect(calls[0].statusCallbackUrl).toContain(
      'https://example.com/api/webhooks/twilio/voice-status?',
    );
    expect(calls[0].statusCallbackUrl).not.toContain('.com//api/');
  });
});

describe('duplicate incident prevention (one-active-per-conversation)', () => {
  it('second startIncident for same conversation returns existing incident without extra calls', async () => {
    const deps = createDeps();

    const first = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Pipe burst',
      },
      deps,
    );

    const calls1 = (deps.voiceProvider as MockVoiceProvider).calls.length;
    const sms1 = (deps.smsProvider as MockSmsProvider).messages.length;

    // Second create for same conversation — should return existing, not create a new one
    const second = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Pipe burst again',
      },
      deps,
    );

    // Should return the same incident
    expect(second.incident_id).toBe(first.incident_id);
    expect(second.conversation_id).toBe('conv-1');

    // No additional voice calls or SMS should have been placed
    expect((deps.voiceProvider as MockVoiceProvider).calls).toHaveLength(calls1);
    expect((deps.smsProvider as MockSmsProvider).messages).toHaveLength(sms1);
  });

  it('allows new incident after previous one is accepted (no longer active)', async () => {
    const deps = createDeps();

    const first = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'Pipe burst',
      },
      deps,
    );

    // Accept the first incident to move it out of 'active' status
    const stored = await deps.incidentStore.getById(first.incident_id);
    if (!stored) throw new Error('not found');
    await deps.incidentStore.update(
      {
        ...stored,
        status: 'accepted',
        accepted_by_phone: '+15551111111',
        updated_at: deps.clock(),
      },
      stored.row_version,
    );

    // Now a new incident for the same conversation should succeed
    const second = await startIncident(
      {
        conversationId: 'conv-1',
        buildingId: 'bldg-1',
        escalationPlans: PLANS,
        summary: 'New emergency',
      },
      deps,
    );

    expect(second.incident_id).not.toBe(first.incident_id);
    expect(second.status).toBe('active');
  });
});

describe('processDue exhaustion transitions', () => {
  it('moves an overdue incident to exhausted_retrying after chain exhaustion', async () => {
    const deps = createDeps();
    const overdue: EscalationIncident = {
      incident_id: 'inc-overdue-retry',
      conversation_id: 'conv-overdue-retry',
      building_id: 'bldg-1',
      plan_id: 'plan-1',
      summary: 'Gas leak',
      status: 'active',
      cycle_number: 1,
      max_cycles: 3,
      current_contact_index: PLAN.contact_chain.length,
      next_action_at: '2026-03-12T09:00:00.000Z',
      processing_lock_until: null,
      last_provider_action: null,
      accepted_by_phone: null,
      accepted_by_contact_id: null,
      accepted_at: null,
      contacted_phone_numbers: ['+15551111111'],
      internal_alert_sent_cycles: [],
      attempts: [],
      row_version: 0,
      created_at: '2026-03-12T09:00:00.000Z',
      updated_at: '2026-03-12T09:00:00.000Z',
    };
    await deps.incidentStore.create(overdue);

    const processed = await processDue(PLANS, deps);
    const updated = await deps.incidentStore.getById(overdue.incident_id);

    expect(processed).toBe(1);
    expect(updated!.status).toBe('exhausted_retrying');
    expect(updated!.cycle_number).toBe(2);
    expect(updated!.current_contact_index).toBe(0);
    expect(updated!.processing_lock_until).toBeNull();
    expect(updated!.internal_alert_sent_cycles).toEqual([1]);
  });

  it('moves an overdue incident to exhausted_final when max cycles are exhausted', async () => {
    const deps = createDeps();
    const overdue: EscalationIncident = {
      incident_id: 'inc-overdue-final',
      conversation_id: 'conv-overdue-final',
      building_id: 'bldg-1',
      plan_id: 'plan-1',
      summary: 'Gas leak',
      status: 'active',
      cycle_number: 1,
      max_cycles: 1,
      current_contact_index: PLAN.contact_chain.length,
      next_action_at: '2026-03-12T09:00:00.000Z',
      processing_lock_until: null,
      last_provider_action: null,
      accepted_by_phone: null,
      accepted_by_contact_id: null,
      accepted_at: null,
      contacted_phone_numbers: ['+15551111111'],
      internal_alert_sent_cycles: [],
      attempts: [],
      row_version: 0,
      created_at: '2026-03-12T09:00:00.000Z',
      updated_at: '2026-03-12T09:00:00.000Z',
    };
    await deps.incidentStore.create(overdue);

    const processed = await processDue(PLANS, deps);
    const updated = await deps.incidentStore.getById(overdue.incident_id);

    expect(processed).toBe(1);
    expect(updated!.status).toBe('exhausted_final');
    expect(updated!.processing_lock_until).toBeNull();
    expect(updated!.internal_alert_sent_cycles).toEqual([1]);
  });
});

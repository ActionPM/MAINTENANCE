import { describe, it, expect, vi } from 'vitest';
import { routeEmergency } from '../../risk/emergency-router.js';
import type { EscalationPlan, EscalationPlans } from '@wo-agent/schemas';

const TEST_PLAN: EscalationPlan = {
  plan_id: 'plan-001',
  building_id: 'bldg-001',
  contact_chain: [
    { role: 'building_manager', contact_id: 'c-1', name: 'BM', phone: '+1111' },
    { role: 'property_manager', contact_id: 'c-2', name: 'PM', phone: '+2222' },
    { role: 'fallback_after_hours', contact_id: 'c-3', name: 'Fallback', phone: '+3333' },
  ],
  exhaustion_behavior: {
    internal_alert: true,
    tenant_message_template: 'Unable to reach management. Call 911 if life-threatening.',
    retry_after_minutes: 15,
  },
};

const TEST_PLANS: EscalationPlans = { version: '1.0.0', plans: [TEST_PLAN] };

describe('routeEmergency', () => {
  it('returns completed when first contact answers', async () => {
    const contactExecutor = vi.fn().mockResolvedValue(true); // answered
    const result = await routeEmergency({
      buildingId: 'bldg-001',
      escalationPlans: TEST_PLANS,
      contactExecutor,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(result.state).toBe('completed');
    expect(result.answered_by).toBeDefined();
    expect(result.answered_by!.contact_id).toBe('c-1');
    expect(contactExecutor).toHaveBeenCalledTimes(1);
    expect(result.exhaustion_message).toBeNull();
  });

  it('iterates chain until someone answers', async () => {
    const contactExecutor = vi.fn()
      .mockResolvedValueOnce(false)  // BM doesn't answer
      .mockResolvedValueOnce(false)  // PM doesn't answer
      .mockResolvedValueOnce(true);  // Fallback answers

    const result = await routeEmergency({
      buildingId: 'bldg-001',
      escalationPlans: TEST_PLANS,
      contactExecutor,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(result.state).toBe('completed');
    expect(result.answered_by!.contact_id).toBe('c-3');
    expect(contactExecutor).toHaveBeenCalledTimes(3);
    expect(result.attempts).toHaveLength(3);
  });

  it('returns exhausted when no one answers', async () => {
    const contactExecutor = vi.fn().mockResolvedValue(false);

    const result = await routeEmergency({
      buildingId: 'bldg-001',
      escalationPlans: TEST_PLANS,
      contactExecutor,
      clock: () => '2026-03-03T00:00:00Z',
    });

    expect(result.state).toBe('exhausted');
    expect(result.answered_by).toBeNull();
    expect(result.exhaustion_message).toBe('Unable to reach management. Call 911 if life-threatening.');
    expect(contactExecutor).toHaveBeenCalledTimes(3);
  });

  it('throws when no plan found for building', async () => {
    const contactExecutor = vi.fn();
    await expect(
      routeEmergency({
        buildingId: 'unknown-building',
        escalationPlans: TEST_PLANS,
        contactExecutor,
        clock: () => '2026-03-03T00:00:00Z',
      }),
    ).rejects.toThrow('No escalation plan found for building: unknown-building');
  });
});

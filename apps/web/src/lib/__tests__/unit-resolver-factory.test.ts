// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createUnitResolver } from '../orchestrator-factory.js';

const testPlans = {
  version: '1.0.0',
  plans: [
    {
      plan_id: 'plan-1',
      building_id: 'building-abc',
      contact_chain: [{ role: 'manager', contact_id: 'c1', name: 'A', phone: '+15550000001' }],
      exhaustion_behavior: {
        internal_alert: true,
        tenant_message_template: '',
        retry_after_minutes: 5,
      },
    },
  ],
};

describe('createUnitResolver', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null for every unit when USE_DEMO_UNIT_RESOLVER is not set', async () => {
    delete process.env.USE_DEMO_UNIT_RESOLVER;

    const resolver = createUnitResolver(testPlans as any);
    const result = await resolver.resolve('unit-123');

    expect(result).toBeNull();
  });

  it('returns null when USE_DEMO_UNIT_RESOLVER is "false"', async () => {
    process.env.USE_DEMO_UNIT_RESOLVER = 'false';

    const resolver = createUnitResolver(testPlans as any);
    const result = await resolver.resolve('unit-123');

    expect(result).toBeNull();
  });

  it('returns demo scope when USE_DEMO_UNIT_RESOLVER is "true"', async () => {
    process.env.USE_DEMO_UNIT_RESOLVER = 'true';
    process.env.DEMO_BUILDING_ID = 'building-abc';

    const resolver = createUnitResolver(testPlans as any);
    const result = await resolver.resolve('unit-456');

    expect(result).toEqual({
      unit_id: 'unit-456',
      property_id: 'prop-unit-456',
      client_id: 'client-unit-456',
      building_id: 'building-abc',
    });
  });

  it('defaults building_id to example-building-001 when DEMO_BUILDING_ID is absent', async () => {
    process.env.USE_DEMO_UNIT_RESOLVER = 'true';
    delete process.env.DEMO_BUILDING_ID;

    const resolver = createUnitResolver(testPlans as any);
    const result = await resolver.resolve('unit-789');

    expect(result).toEqual(expect.objectContaining({ building_id: 'example-building-001' }));
  });
});

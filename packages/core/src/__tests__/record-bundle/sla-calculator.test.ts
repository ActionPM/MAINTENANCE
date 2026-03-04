import { describe, it, expect } from 'vitest';
import { computeSlaMetadata } from '../../record-bundle/sla-calculator.js';

const SLA_POLICIES = {
  version: '1.0.0',
  client_defaults: {
    emergency: { response_hours: 1, resolution_hours: 24 },
    high: { response_hours: 4, resolution_hours: 48 },
    normal: { response_hours: 24, resolution_hours: 168 },
    low: { response_hours: 48, resolution_hours: 336 },
  },
  overrides: [
    { taxonomy_path: 'maintenance.plumbing.flood', response_hours: 1, resolution_hours: 12 },
  ],
};

describe('computeSlaMetadata', () => {
  it('returns SLA for normal priority', () => {
    const result = computeSlaMetadata({
      priority: 'normal',
      classification: { Category: 'maintenance', Maintenance_Category: 'general_maintenance' },
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.priority).toBe('normal');
    expect(result.response_hours).toBe(24);
    expect(result.resolution_hours).toBe(168);
    expect(result.response_due_at).toBe('2026-03-05T12:00:00.000Z');
    expect(result.resolution_due_at).toBe('2026-03-11T12:00:00.000Z');
  });

  it('returns SLA for emergency priority', () => {
    const result = computeSlaMetadata({
      priority: 'emergency',
      classification: {},
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.priority).toBe('emergency');
    expect(result.response_hours).toBe(1);
    expect(result.resolution_hours).toBe(24);
  });

  it('applies taxonomy override when matching', () => {
    const result = computeSlaMetadata({
      priority: 'normal',
      classification: {
        Category: 'maintenance',
        Maintenance_Category: 'plumbing',
        Maintenance_Problem: 'flood',
      },
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.response_hours).toBe(1);
    expect(result.resolution_hours).toBe(12);
  });

  it('falls back to normal when priority unrecognized', () => {
    const result = computeSlaMetadata({
      priority: 'unknown_priority',
      classification: {},
      createdAt: '2026-03-04T12:00:00.000Z',
      slaPolicies: SLA_POLICIES,
    });

    expect(result.priority).toBe('unknown_priority');
    expect(result.response_hours).toBe(24);
    expect(result.resolution_hours).toBe(168);
  });
});

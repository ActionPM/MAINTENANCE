import { describe, it, expect } from 'vitest';
import { validateRecordBundle } from '../validators/record-bundle.js';

describe('validateRecordBundle', () => {
  it('accepts a valid record bundle', () => {
    const bundle = {
      work_order_id: '00000000-0000-0000-0000-000000000001',
      conversation_id: '00000000-0000-0000-0000-000000000002',
      created_at: '2026-03-04T00:00:00.000Z',
      unit_id: '00000000-0000-0000-0000-000000000003',
      summary: 'Leaky faucet in kitchen',
      classification: { Category: 'maintenance', Priority: 'normal' },
      urgency_basis: { has_emergency: false, highest_severity: null, trigger_ids: [] },
      status_history: [
        { status: 'created', changed_at: '2026-03-04T00:00:00.000Z', actor: 'system' },
      ],
      communications: [],
      schedule: {
        priority: 'normal',
        response_hours: 24,
        resolution_hours: 168,
        response_due_at: '2026-03-05T00:00:00.000Z',
        resolution_due_at: '2026-03-11T00:00:00.000Z',
      },
      resolution: { resolved: false, final_status: 'created', resolved_at: null },
      exported_at: '2026-03-04T12:00:00.000Z',
    };
    const result = validateRecordBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual(bundle);
  });

  it('rejects bundle missing required fields', () => {
    const result = validateRecordBundle({ work_order_id: 'not-a-uuid' });
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects bundle with invalid communication entry', () => {
    const bundle = {
      work_order_id: '00000000-0000-0000-0000-000000000001',
      conversation_id: '00000000-0000-0000-0000-000000000002',
      created_at: '2026-03-04T00:00:00.000Z',
      unit_id: '00000000-0000-0000-0000-000000000003',
      summary: 'Test',
      classification: {},
      urgency_basis: { has_emergency: false, highest_severity: null, trigger_ids: [] },
      status_history: [],
      communications: [{ notification_id: 'x', channel: 'pigeon' }],
      schedule: {
        priority: 'normal',
        response_hours: 24,
        resolution_hours: 168,
        response_due_at: '2026-03-05T00:00:00.000Z',
        resolution_due_at: '2026-03-11T00:00:00.000Z',
      },
      resolution: { resolved: false, final_status: 'created', resolved_at: null },
      exported_at: '2026-03-04T12:00:00.000Z',
    };
    const result = validateRecordBundle(bundle);
    expect(result.valid).toBe(false);
  });
});

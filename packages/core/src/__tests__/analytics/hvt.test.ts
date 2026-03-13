import { describe, it, expect } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { computeHvtFlag, HVT_THRESHOLD } from '../../analytics/hvt.js';

function makeWo(status: string, id = 'wo-1'): WorkOrder {
  return {
    work_order_id: id,
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    unit_id: 'u1',
    property_id: 'p1',
    client_id: 'c1',
    issue_group_id: 'g1',
    issue_id: 'iss-1',
    summary: 'Test WO',
    raw_text: 'test',
    classification: { Category: 'maintenance' } as any,
    model_confidence: { Category: 0.9 } as any,
    status: status as any,
    status_history: [],
    photos: [],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'test',
      prompt_version: '1.0.0',
    },
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
    version: 1,
  } as unknown as WorkOrder;
}

describe('computeHvtFlag (S01-07)', () => {
  it('returns is_hvt: false with no work orders', () => {
    const result = computeHvtFlag([]);
    expect(result.is_hvt).toBe(false);
    expect(result.open_wo_count).toBe(0);
  });

  it('returns is_hvt: false with fewer than threshold open WOs', () => {
    const wos = [makeWo('created', 'wo-1'), makeWo('action_required', 'wo-2')];
    const result = computeHvtFlag(wos);
    expect(result.is_hvt).toBe(false);
    expect(result.open_wo_count).toBe(2);
  });

  it('returns is_hvt: true at exactly threshold open WOs', () => {
    const wos = Array.from({ length: HVT_THRESHOLD }, (_, i) => makeWo('created', `wo-${i}`));
    const result = computeHvtFlag(wos);
    expect(result.is_hvt).toBe(true);
    expect(result.open_wo_count).toBe(HVT_THRESHOLD);
  });

  it('does not count resolved or cancelled WOs', () => {
    const wos = [
      makeWo('created', 'wo-1'),
      makeWo('created', 'wo-2'),
      makeWo('resolved', 'wo-3'),
      makeWo('cancelled', 'wo-4'),
    ];
    const result = computeHvtFlag(wos);
    expect(result.is_hvt).toBe(false);
    expect(result.open_wo_count).toBe(2);
  });

  it('counts scheduled WOs as open', () => {
    const wos = [
      makeWo('created', 'wo-1'),
      makeWo('scheduled', 'wo-2'),
      makeWo('action_required', 'wo-3'),
    ];
    const result = computeHvtFlag(wos);
    expect(result.is_hvt).toBe(true);
    expect(result.open_wo_count).toBe(3);
  });
});

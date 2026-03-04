import { describe, it, expect } from 'vitest';
import { buildWorkOrderCreatedEvent } from '../../work-order/event-builder.js';
import type { WorkOrder } from '@wo-agent/schemas';

const makeWO = (): WorkOrder => ({
  work_order_id: 'wo-1',
  issue_group_id: 'ig-1',
  issue_id: 'iss-1',
  conversation_id: 'conv-1',
  client_id: 'c-1',
  property_id: 'p-1',
  unit_id: 'u-1',
  tenant_user_id: 'tu-1',
  tenant_account_id: 'ta-1',
  status: 'created',
  status_history: [{ status: 'created', changed_at: '2026-03-03T12:00:00Z', actor: 'system' }],
  raw_text: 'test',
  summary_confirmed: 'test summary',
  photos: [],
  classification: { category: 'plumbing' },
  confidence_by_field: { category: 0.9 },
  missing_fields: [],
  pets_present: 'unknown',
  needs_human_triage: false,
  pinned_versions: { taxonomy_version: '1', schema_version: '1', model_id: 'm', prompt_version: '1' },
  created_at: '2026-03-03T12:00:00Z',
  updated_at: '2026-03-03T12:00:00Z',
  row_version: 1,
});

describe('buildWorkOrderCreatedEvent', () => {
  it('builds a work_order_created event', () => {
    const wo = makeWO();
    const event = buildWorkOrderCreatedEvent({
      eventId: 'ev-1',
      workOrder: wo,
      conversationId: 'conv-1',
      createdAt: '2026-03-03T14:00:00Z',
    });

    expect(event.event_id).toBe('ev-1');
    expect(event.work_order_id).toBe('wo-1');
    expect(event.event_type).toBe('work_order_created');
    expect(event.payload.issue_group_id).toBe('ig-1');
    expect(event.payload.conversation_id).toBe('conv-1');
    expect(event.payload.classification).toEqual({ category: 'plumbing' });
    expect(event.created_at).toBe('2026-03-03T14:00:00Z');
  });
});

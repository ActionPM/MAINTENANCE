import { describe, it, expect } from 'vitest';
import {
  buildERPCreateEvent,
  buildERPStatusPollEvent,
  buildERPSyncEvent,
} from '../../erp/event-builder.js';

describe('ERP event builders (Phase 12)', () => {
  it('buildERPCreateEvent returns erp_create event', () => {
    const event = buildERPCreateEvent({
      eventId: 'evt-1',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-abc',
      createdAt: '2026-03-04T00:00:00Z',
    });

    expect(event.event_id).toBe('evt-1');
    expect(event.work_order_id).toBe('wo-1');
    expect(event.conversation_id).toBe('conv-1');
    expect(event.event_type).toBe('erp_create');
    expect(event.ext_id).toBe('EXT-abc');
    expect(event.payload).toEqual({});
    expect(event.created_at).toBe('2026-03-04T00:00:00Z');
  });

  it('buildERPStatusPollEvent returns erp_status_poll event', () => {
    const event = buildERPStatusPollEvent({
      eventId: 'evt-2',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-abc',
      status: 'action_required',
      createdAt: '2026-03-04T01:00:00Z',
    });

    expect(event.event_type).toBe('erp_status_poll');
    expect(event.payload).toEqual({ status: 'action_required' });
  });

  it('buildERPSyncEvent returns erp_sync event with status transition', () => {
    const event = buildERPSyncEvent({
      eventId: 'evt-3',
      workOrderId: 'wo-1',
      conversationId: 'conv-1',
      extId: 'EXT-abc',
      previousStatus: 'created',
      newStatus: 'action_required',
      createdAt: '2026-03-04T02:00:00Z',
    });

    expect(event.event_type).toBe('erp_sync');
    expect(event.payload).toEqual({
      previous_status: 'created',
      new_status: 'action_required',
    });
  });
});

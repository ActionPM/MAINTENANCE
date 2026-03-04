import { describe, it, expect } from 'vitest';
import type {
  ERPAdapter,
  ERPCreateResult,
  ERPStatusResult,
  ERPStatusUpdate,
  ERPHealthResult,
  ERPSyncEvent,
} from '../../erp/types.js';

describe('ERP types (Phase 12)', () => {
  it('ERPAdapter interface has all four spec §23 methods', () => {
    // Type-level check: a conforming object must have these methods.
    const adapter: ERPAdapter = {
      createWorkOrder: async () => ({ ext_id: 'EXT-123' }),
      getWorkOrderStatus: async () => ({
        ext_id: 'EXT-123',
        status: 'created',
        updated_at: '2026-03-04T00:00:00Z',
      }),
      syncUpdates: async () => [],
      healthCheck: async () => ({ healthy: true }),
    };
    expect(adapter).toBeDefined();
  });

  it('ERPCreateResult has ext_id', () => {
    const result: ERPCreateResult = { ext_id: 'EXT-abc' };
    expect(result.ext_id).toBe('EXT-abc');
  });

  it('ERPStatusResult has ext_id, status, updated_at', () => {
    const result: ERPStatusResult = {
      ext_id: 'EXT-abc',
      status: 'action_required',
      updated_at: '2026-03-04T00:00:00Z',
    };
    expect(result.status).toBe('action_required');
  });

  it('ERPStatusUpdate includes work_order_id and status transition', () => {
    const update: ERPStatusUpdate = {
      ext_id: 'EXT-abc',
      work_order_id: 'wo-1',
      previous_status: 'created',
      new_status: 'action_required',
      updated_at: '2026-03-04T00:00:00Z',
    };
    expect(update.previous_status).not.toBe(update.new_status);
  });

  it('ERPHealthResult has healthy flag', () => {
    const result: ERPHealthResult = { healthy: true };
    expect(result.healthy).toBe(true);
  });

  it('ERPSyncEvent follows append-only pattern', () => {
    const event: ERPSyncEvent = {
      event_id: 'evt-1',
      work_order_id: 'wo-1',
      conversation_id: 'conv-1',
      event_type: 'erp_create',
      ext_id: 'EXT-abc',
      payload: { status: 'created' },
      created_at: '2026-03-04T00:00:00Z',
    };
    expect(event.event_type).toBe('erp_create');
  });
});

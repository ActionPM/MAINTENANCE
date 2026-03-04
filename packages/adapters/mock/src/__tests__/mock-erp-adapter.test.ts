import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { MockERPAdapter } from '../mock-erp-adapter.js';

function makeWorkOrder(id: string = 'wo-1'): WorkOrder {
  return {
    work_order_id: id,
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    status: WorkOrderStatus.CREATED,
    status_history: [{ status: WorkOrderStatus.CREATED, changed_at: '2026-03-04T00:00:00Z', actor: ActorType.SYSTEM }],
    raw_text: 'Leaking faucet',
    summary_confirmed: 'Leaking faucet in kitchen',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: { taxonomy_version: '1.0.0', schema_version: '1.0.0', model_id: 'test', prompt_version: '1.0.0' },
    created_at: '2026-03-04T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    row_version: 1,
  };
}

describe('MockERPAdapter (Phase 12)', () => {
  let adapter: MockERPAdapter;

  beforeEach(() => {
    adapter = new MockERPAdapter();
  });

  describe('createWorkOrder', () => {
    it('returns EXT- prefixed external ID', async () => {
      const result = await adapter.createWorkOrder(makeWorkOrder());
      expect(result.ext_id).toMatch(/^EXT-/);
    });

    it('stores the mapping for later retrieval', async () => {
      const wo = makeWorkOrder();
      const { ext_id } = await adapter.createWorkOrder(wo);
      const status = await adapter.getWorkOrderStatus(ext_id);
      expect(status.ext_id).toBe(ext_id);
      expect(status.status).toBe('created');
    });

    it('rejects duplicate work_order_id', async () => {
      const wo = makeWorkOrder();
      await adapter.createWorkOrder(wo);
      await expect(adapter.createWorkOrder(wo)).rejects.toThrow('already registered');
    });

    it('records the call for assertion', async () => {
      const wo = makeWorkOrder();
      await adapter.createWorkOrder(wo);
      expect(adapter.calls.createWorkOrder).toHaveLength(1);
      expect(adapter.calls.createWorkOrder[0].work_order_id).toBe('wo-1');
    });
  });

  describe('getWorkOrderStatus', () => {
    it('returns current status', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      const result = await adapter.getWorkOrderStatus(ext_id);
      expect(result.status).toBe('created');
    });

    it('rejects unknown ext_id', async () => {
      await expect(adapter.getWorkOrderStatus('EXT-nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('advanceStatus (test helper)', () => {
    it('advances created → action_required', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      const update = adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');

      expect(update.previous_status).toBe('created');
      expect(update.new_status).toBe('action_required');

      const status = await adapter.getWorkOrderStatus(ext_id);
      expect(status.status).toBe('action_required');
    });

    it('advances action_required → scheduled', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      const update = adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');

      expect(update.previous_status).toBe('action_required');
      expect(update.new_status).toBe('scheduled');
    });

    it('advances scheduled → resolved', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');
      const update = adapter.advanceStatus(ext_id, '2026-03-04T03:00:00Z');

      expect(update.previous_status).toBe('scheduled');
      expect(update.new_status).toBe('resolved');
    });

    it('throws on terminal status (resolved)', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T03:00:00Z');

      expect(() => adapter.advanceStatus(ext_id, '2026-03-04T04:00:00Z')).toThrow('terminal');
    });
  });

  describe('syncUpdates', () => {
    it('returns empty when no changes since timestamp', async () => {
      await adapter.createWorkOrder(makeWorkOrder());
      const updates = await adapter.syncUpdates('2026-03-05T00:00:00Z');
      expect(updates).toHaveLength(0);
    });

    it('returns status changes after given timestamp', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');

      const updates = await adapter.syncUpdates('2026-03-04T00:30:00Z');
      expect(updates).toHaveLength(1);
      expect(updates[0].ext_id).toBe(ext_id);
      expect(updates[0].new_status).toBe('action_required');
    });

    it('excludes changes before the since timestamp', async () => {
      const { ext_id } = await adapter.createWorkOrder(makeWorkOrder());
      adapter.advanceStatus(ext_id, '2026-03-04T01:00:00Z');
      adapter.advanceStatus(ext_id, '2026-03-04T02:00:00Z');

      const updates = await adapter.syncUpdates('2026-03-04T01:30:00Z');
      expect(updates).toHaveLength(1);
      expect(updates[0].new_status).toBe('scheduled');
    });
  });

  describe('healthCheck', () => {
    it('returns healthy by default', async () => {
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('returns unhealthy when configured to fail', async () => {
      const failing = new MockERPAdapter({ shouldFail: true });
      const result = await failing.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });

  describe('shouldFail mode', () => {
    it('createWorkOrder rejects when shouldFail is true', async () => {
      const failing = new MockERPAdapter({ shouldFail: true });
      await expect(failing.createWorkOrder(makeWorkOrder())).rejects.toThrow('Mock ERP failure');
    });
  });
});

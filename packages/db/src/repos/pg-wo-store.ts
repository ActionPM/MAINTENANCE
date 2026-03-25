import type { Pool } from '@neondatabase/serverless';
import type { WorkOrder, WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import { normalizePinnedVersions } from '@wo-agent/schemas';
import type { WorkOrderRepository, WorkOrderListFilters } from '@wo-agent/core';

export class PostgresWorkOrderStore implements WorkOrderRepository {
  constructor(private readonly pool: Pool) {}

  async insertBatch(workOrders: readonly WorkOrder[]): Promise<void> {
    await this.pool.query('BEGIN');
    try {
      for (const wo of workOrders) {
        await this.pool.query(
          `INSERT INTO work_orders
            (work_order_id, issue_group_id, issue_id, conversation_id, client_id, property_id, unit_id,
             tenant_user_id, tenant_account_id, status, status_history, raw_text, summary_confirmed,
             photos, classification, confidence_by_field, missing_fields, pets_present,
             risk_flags, needs_human_triage, pinned_versions, created_at, updated_at, row_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
          [
            wo.work_order_id,
            wo.issue_group_id,
            wo.issue_id,
            wo.conversation_id,
            wo.client_id,
            wo.property_id,
            wo.unit_id,
            wo.tenant_user_id,
            wo.tenant_account_id,
            wo.status,
            JSON.stringify(wo.status_history),
            wo.raw_text,
            wo.summary_confirmed,
            JSON.stringify(wo.photos),
            JSON.stringify(wo.classification),
            JSON.stringify(wo.confidence_by_field),
            JSON.stringify(wo.missing_fields),
            wo.pets_present,
            wo.risk_flags ? JSON.stringify(wo.risk_flags) : null,
            wo.needs_human_triage,
            JSON.stringify(wo.pinned_versions),
            wo.created_at,
            wo.updated_at,
            wo.row_version,
          ],
        );
      }
      await this.pool.query('COMMIT');
    } catch (err) {
      await this.pool.query('ROLLBACK');
      throw err;
    }
  }

  async getById(workOrderId: string): Promise<WorkOrder | null> {
    const result = await this.pool.query('SELECT * FROM work_orders WHERE work_order_id = $1', [
      workOrderId,
    ]);
    return result.rows.length > 0 ? mapRowToWorkOrder(result.rows[0]) : null;
  }

  async getByIssueGroup(issueGroupId: string): Promise<readonly WorkOrder[]> {
    const result = await this.pool.query('SELECT * FROM work_orders WHERE issue_group_id = $1', [
      issueGroupId,
    ]);
    return result.rows.map(mapRowToWorkOrder);
  }

  async listAll(filters?: WorkOrderListFilters): Promise<readonly WorkOrder[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.tenant_user_id) {
      conditions.push(`tenant_user_id = $${idx++}`);
      values.push(filters.tenant_user_id);
    }
    if (filters?.client_id) {
      conditions.push(`client_id = $${idx++}`);
      values.push(filters.client_id);
    }
    if (filters?.property_id) {
      conditions.push(`property_id = $${idx++}`);
      values.push(filters.property_id);
    }
    if (filters?.unit_id) {
      conditions.push(`unit_id = $${idx++}`);
      values.push(filters.unit_id);
    }
    if (filters?.unit_ids) {
      if (filters.unit_ids.length === 0) return [];
      conditions.push(`unit_id = ANY($${idx++})`);
      values.push([...filters.unit_ids]);
    }
    if (filters?.from) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters?.to) {
      conditions.push(`created_at < $${idx++}`);
      values.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM work_orders ${where} ORDER BY created_at`,
      values,
    );
    return result.rows.map(mapRowToWorkOrder);
  }

  async updateStatus(
    workOrderId: string,
    newStatus: WorkOrderStatus,
    actor: ActorType,
    changedAt: string,
    expectedVersion: number,
  ): Promise<WorkOrder> {
    const result = await this.pool.query(
      `UPDATE work_orders
       SET status = $1,
           status_history = status_history || $2::jsonb,
           updated_at = $3,
           row_version = row_version + 1
       WHERE work_order_id = $4 AND row_version = $5
       RETURNING *`,
      [
        newStatus,
        JSON.stringify({ status: newStatus, changed_at: changedAt, actor }),
        changedAt,
        workOrderId,
        expectedVersion,
      ],
    );

    if (result.rowCount === 0) {
      throw new Error(`Version mismatch or not found: ${workOrderId}`);
    }

    return mapRowToWorkOrder(result.rows[0]);
  }
}

function mapRowToWorkOrder(row: Record<string, unknown>): WorkOrder {
  return {
    work_order_id: row.work_order_id as string,
    issue_group_id: row.issue_group_id as string,
    issue_id: row.issue_id as string,
    conversation_id: row.conversation_id as string,
    client_id: row.client_id as string,
    property_id: row.property_id as string,
    unit_id: row.unit_id as string,
    tenant_user_id: row.tenant_user_id as string,
    tenant_account_id: row.tenant_account_id as string,
    status: row.status as WorkOrderStatus,
    status_history: row.status_history as WorkOrder['status_history'],
    raw_text: row.raw_text as string,
    summary_confirmed: row.summary_confirmed as string,
    photos: row.photos as WorkOrder['photos'],
    classification: row.classification as Record<string, string>,
    confidence_by_field: row.confidence_by_field as Record<string, number>,
    missing_fields: row.missing_fields as readonly string[],
    pets_present: row.pets_present as WorkOrder['pets_present'],
    risk_flags: row.risk_flags as Record<string, unknown> | undefined,
    needs_human_triage: row.needs_human_triage as boolean,
    pinned_versions: normalizePinnedVersions(row.pinned_versions as Record<string, unknown>),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at as string),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at as string),
    row_version: row.row_version as number,
  };
}

import type { WorkOrder } from '@wo-agent/schemas';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';
import type { ConversationSession, IssueClassificationResult } from '../session/types.js';

export interface CreateWorkOrdersInput {
  readonly session: ConversationSession;
  readonly idGenerator: () => string;
  readonly clock: () => string;
}

/**
 * Pure factory: given a confirmed session, produce one WorkOrder per split issue.
 * All WOs share an issue_group_id (spec §1.4, §18 — linkage only, no aggregate status).
 * Throws if required scope fields are missing.
 */
export function createWorkOrders(input: CreateWorkOrdersInput): WorkOrder[] {
  const { session, idGenerator, clock } = input;

  if (!session.unit_id) {
    throw new Error('Cannot create WOs: session has no unit_id');
  }
  if (!session.property_id) {
    throw new Error('Cannot create WOs: session has no property_id');
  }
  if (!session.client_id) {
    throw new Error('Cannot create WOs: session has no client_id');
  }
  if (!session.split_issues || session.split_issues.length === 0) {
    throw new Error('Cannot create WOs: session has no split_issues');
  }
  if (!session.classification_results || session.classification_results.length === 0) {
    throw new Error('Cannot create WOs: session has no classification_results');
  }

  const now = clock();
  const issueGroupId = idGenerator();
  const resultMap = new Map<string, IssueClassificationResult>(
    session.classification_results.map(r => [r.issue_id, r]),
  );

  // Photos are NOT attached at creation time. Draft photo IDs on the session
  // lack the storage_key and sha256 required by the schema. Photo attachment
  // is a separate post-creation enrichment step once upload metadata is available.

  return session.split_issues.map(issue => {
    const classResult = resultMap.get(issue.issue_id);

    const wo: WorkOrder = {
      work_order_id: idGenerator(),
      issue_group_id: issueGroupId,
      issue_id: issue.issue_id,
      client_id: session.client_id!,
      property_id: session.property_id!,
      unit_id: session.unit_id!,
      tenant_user_id: session.tenant_user_id,
      tenant_account_id: session.tenant_account_id,
      status: WorkOrderStatus.CREATED,
      status_history: [{
        status: WorkOrderStatus.CREATED,
        changed_at: now,
        actor: ActorType.SYSTEM,
      }],
      raw_text: issue.raw_excerpt,
      summary_confirmed: issue.summary,
      photos: [],
      classification: classResult ? { ...classResult.classifierOutput.classification } : {},
      confidence_by_field: classResult ? { ...classResult.computedConfidence } : {},
      missing_fields: classResult ? [...classResult.classifierOutput.missing_fields] : [],
      pets_present: 'unknown',
      needs_human_triage: classResult?.classifierOutput.needs_human_triage ?? true,
      pinned_versions: { ...session.pinned_versions },
      created_at: now,
      updated_at: now,
      row_version: 1,
    };

    return wo;
  });
}

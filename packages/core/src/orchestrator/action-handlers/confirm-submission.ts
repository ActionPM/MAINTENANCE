import { ConversationState, DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult, SideEffectInput } from '../types.js';
import {
  buildConfirmationPayload,
  computeContentHash,
} from '../../confirmation/payload-builder.js';
import { checkStaleness } from '../../confirmation/staleness.js';
import { buildConfirmationEvent, buildStalenessEvent } from '../../confirmation/event-builder.js';
import { classifyConfidenceBand } from '../../classifier/confidence.js';
import type { ConfidenceBand } from '../../classifier/confidence.js';
import { SystemEvent } from '../../state-machine/system-events.js';
import { createWorkOrders } from '../../work-order/wo-creator.js';

const BAND_SEVERITY: Record<ConfidenceBand, number> = { low: 0, medium: 1, high: 2 };

/**
 * Handle CONFIRM_SUBMISSION (spec §16, non-negotiable #4, §18 WO creation).
 *
 * Flow:
 * 1. Guard: idempotency key required (irreversible side effects)
 * 2. Guard: session must have split_issues and classification_results
 * 3. Build confirmation payload
 * 4. Run staleness check
 * 5. If stale: record staleness event, re-route to split_finalized (triggers re-classification)
 * 6. Reserve idempotency key atomically (if already reserved → replay cached result)
 * 7. If fresh: record confirmation event, create WOs, complete idempotency, transition to submitted
 */
export async function handleConfirmSubmission(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;

  // Guard: idempotency key is required — CONFIRM_SUBMISSION has irreversible side effects
  const idempotencyKey = request.idempotency_key;
  if (!idempotencyKey) {
    return {
      newState: session.state,
      session,
      uiMessages: [],
      errors: [
        {
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: 'CONFIRM_SUBMISSION requires an idempotency_key',
        },
      ],
    };
  }

  // Guard: must have split issues
  if (!session.split_issues || session.split_issues.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [],
      errors: [{ code: 'NO_ISSUES', message: 'Cannot confirm: no issues on session' }],
    };
  }

  // Guard: must have classification results
  if (!session.classification_results || session.classification_results.length === 0) {
    return {
      newState: session.state,
      session,
      uiMessages: [],
      errors: [
        {
          code: 'NO_CLASSIFICATION',
          message: 'Cannot confirm: no classification results on session',
        },
      ],
    };
  }

  // Build confirmation payload
  const confirmationPayload = buildConfirmationPayload(
    session.split_issues,
    session.classification_results,
  );

  // Compute current content hashes
  const currentSourceHash = computeContentHash(
    session.split_issues.map((i) => i.raw_excerpt).join('|'),
  );
  const currentSplitHash = computeContentHash(
    JSON.stringify(session.split_issues.map((i) => ({ id: i.issue_id, summary: i.summary }))),
  );

  // Staleness check (only if we have stored hashes to compare against)
  if (session.source_text_hash || session.split_hash) {
    const confidenceConfig: ConfidenceConfig = deps.confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;

    // Build confidence bands from classification results.
    // When multiple issues share a field name, keep the WORST (lowest) band
    // so that a low-confidence field on one issue isn't hidden by a
    // high-confidence field on another.
    const confidenceBands: Record<string, ConfidenceBand> = {};
    for (const result of session.classification_results) {
      for (const [field, conf] of Object.entries(result.computedConfidence)) {
        const band = classifyConfidenceBand(conf, confidenceConfig);
        const existing = confidenceBands[field];
        if (!existing || BAND_SEVERITY[band] < BAND_SEVERITY[existing]) {
          confidenceBands[field] = band;
        }
      }
    }

    const stalenessResult = checkStaleness({
      confirmationEnteredAt: session.confirmation_entered_at ?? session.last_activity_at,
      currentTime: deps.clock(),
      sourceTextHash: currentSourceHash,
      originalSourceTextHash: session.source_text_hash ?? currentSourceHash,
      splitHash: currentSplitHash,
      originalSplitHash: session.split_hash ?? currentSplitHash,
      artifactPresentedToTenant: session.confirmation_presented,
      confidenceBands,
    });

    if (stalenessResult.isStale) {
      // Record staleness event
      const stalenessEvent = buildStalenessEvent({
        eventId: deps.idGenerator(),
        conversationId: session.conversation_id,
        stalenessResult,
        createdAt: deps.clock(),
      });
      await deps.eventRepo.insert(stalenessEvent);

      // Re-route to split_finalized to trigger re-classification via auto-fire.
      // Uses STALENESS_DETECTED system event so the transition is in-matrix.
      return {
        newState: ConversationState.SPLIT_FINALIZED,
        session: {
          ...session,
          confirmation_entered_at: null,
          source_text_hash: null,
          split_hash: null,
          confirmation_presented: false,
        },
        finalSystemAction: SystemEvent.STALENESS_DETECTED,
        uiMessages: [
          {
            role: 'agent',
            content:
              'Some information has changed since your last visit. Let me re-verify your issue details.',
          },
        ],
        eventPayload: {
          staleness_detected: true,
          reasons: stalenessResult.reasons,
        },
        eventType: 'staleness_reclassification',
      };
    }
  }

  // Atomic idempotency reservation — claim the key before creating WOs
  const reservation = await deps.idempotencyStore.tryReserve(idempotencyKey);
  if (!reservation.reserved) {
    // Key already claimed — return cached result
    return {
      newState: ConversationState.SUBMITTED,
      session,
      uiMessages: [
        { role: 'agent', content: "Your request has been submitted. We'll be in touch." },
      ],
      sideEffects: [
        {
          effect_type: 'create_work_orders',
          status: 'completed',
          idempotency_key: idempotencyKey,
        },
      ],
      eventPayload: {
        confirmed: true,
        confirmation_payload: confirmationPayload,
        work_order_ids: reservation.existing.work_order_ids,
      },
      eventType: 'confirmation_accepted',
    };
  }

  // Fresh — record confirmation event
  const confirmationEvent = buildConfirmationEvent({
    eventId: deps.idGenerator(),
    conversationId: session.conversation_id,
    confirmationPayload,
    createdAt: deps.clock(),
  });
  await deps.eventRepo.insert(confirmationEvent);

  // Create work orders (spec §18 — one WO per split issue, atomic batch)
  const workOrders = createWorkOrders({
    session,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });

  // Persist atomically
  await deps.workOrderRepo.insertBatch(workOrders);

  // Register with ERP (best-effort — failures do not roll back WO creation)
  if (deps.erpAdapter) {
    for (const wo of workOrders) {
      try {
        await deps.erpAdapter.createWorkOrder(wo);
      } catch (err) {
        // ERP registration failure is non-fatal but must be logged for diagnosis.
        // There is no automatic retry — unregistered WOs need manual reconciliation.
        console.error('[ERP] registration failed', {
          work_order_id: wo.work_order_id,
          conversation_id: wo.conversation_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Complete idempotency record with the created WO IDs
  const woIds = workOrders.map((wo) => wo.work_order_id);
  await deps.idempotencyStore.complete(idempotencyKey, {
    work_order_ids: woIds,
  });

  // Dispatch notifications (spec §20 — batch multi-issue into one notification)
  // Notifications are best-effort: failures do not roll back WO creation.
  const notifSideEffects: SideEffectInput[] = [];
  if (deps.notificationService) {
    try {
      const notifResult = await deps.notificationService.notifyWorkOrdersCreated({
        conversationId: session.conversation_id,
        tenantUserId: session.tenant_user_id,
        tenantAccountId: session.tenant_account_id,
        workOrderIds: woIds,
        issueGroupId: workOrders[0].issue_group_id,
        idempotencyKey: `${idempotencyKey}-notif`,
      });
      notifSideEffects.push({
        effect_type: 'send_notifications',
        status: notifResult.in_app_sent || notifResult.sms_sent ? 'completed' : 'pending',
        idempotency_key: `${idempotencyKey}-notif`,
      });
    } catch {
      notifSideEffects.push({
        effect_type: 'send_notifications',
        status: 'failed',
        idempotency_key: `${idempotencyKey}-notif`,
      });
    }
  }

  return {
    newState: ConversationState.SUBMITTED,
    session,
    uiMessages: [{ role: 'agent', content: "Your request has been submitted. We'll be in touch." }],
    sideEffects: [
      {
        effect_type: 'create_work_orders',
        status: 'completed',
        idempotency_key: idempotencyKey,
      },
      ...notifSideEffects,
    ],
    eventPayload: {
      confirmed: true,
      confirmation_payload: confirmationPayload,
      work_order_ids: woIds,
    },
    eventType: 'confirmation_accepted',
  };
}

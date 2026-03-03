import { ConversationState, DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import type { ConfidenceConfig } from '@wo-agent/schemas';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { buildConfirmationPayload, computeContentHash } from '../../confirmation/payload-builder.js';
import { checkStaleness } from '../../confirmation/staleness.js';
import { buildConfirmationEvent, buildStalenessEvent } from '../../confirmation/event-builder.js';
import { classifyConfidenceBand } from '../../classifier/confidence.js';
import type { ConfidenceBand } from '../../classifier/confidence.js';
import { SystemEvent } from '../../state-machine/system-events.js';

const BAND_SEVERITY: Record<ConfidenceBand, number> = { low: 0, medium: 1, high: 2 };

/**
 * Handle CONFIRM_SUBMISSION (spec §16, non-negotiable #4).
 *
 * Flow:
 * 1. Guard: session must have split_issues and classification_results
 * 2. Build confirmation payload
 * 3. Run staleness check
 * 4. If stale: record staleness event, re-route to split_finalized (triggers re-classification)
 * 5. If fresh: record confirmation event, transition to submitted
 *
 * WO creation is NOT done here — that's Phase 8.
 */
export async function handleConfirmSubmission(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;

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
      errors: [{ code: 'NO_CLASSIFICATION', message: 'Cannot confirm: no classification results on session' }],
    };
  }

  // Build confirmation payload
  const confirmationPayload = buildConfirmationPayload(
    session.split_issues,
    session.classification_results,
  );

  // Compute current content hashes
  const currentSourceHash = computeContentHash(
    session.split_issues.map(i => i.raw_excerpt).join('|'),
  );
  const currentSplitHash = computeContentHash(
    JSON.stringify(session.split_issues.map(i => ({ id: i.issue_id, summary: i.summary }))),
  );

  // Staleness check (only if we have stored hashes to compare against)
  if (session.source_text_hash || session.split_hash) {
    const confidenceConfig: ConfidenceConfig =
      deps.confidenceConfig ?? DEFAULT_CONFIDENCE_CONFIG;

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
        uiMessages: [{
          role: 'agent',
          content: 'Some information has changed since your last visit. Let me re-verify your issue details.',
        }],
        eventPayload: {
          staleness_detected: true,
          reasons: stalenessResult.reasons,
        },
        eventType: 'staleness_reclassification',
      };
    }
  }

  // Fresh — record confirmation event
  const confirmationEvent = buildConfirmationEvent({
    eventId: deps.idGenerator(),
    conversationId: session.conversation_id,
    confirmationPayload,
    createdAt: deps.clock(),
  });
  await deps.eventRepo.insert(confirmationEvent);

  return {
    newState: ConversationState.SUBMITTED,
    session,
    uiMessages: [{ role: 'agent', content: 'Your request has been submitted. We\'ll be in touch.' }],
    sideEffects: [{ effect_type: 'create_work_orders', status: 'pending' }],
    eventPayload: {
      confirmed: true,
      confirmation_payload: confirmationPayload,
    },
    eventType: 'confirmation_accepted',
  };
}

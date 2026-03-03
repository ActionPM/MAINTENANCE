import type { ConfirmationPayload } from './payload-builder.js';
import type { StalenessResult } from './staleness.js';

export interface ConfirmationEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly confirmationPayload: ConfirmationPayload;
  readonly createdAt: string;
}

export interface StalenessEventInput {
  readonly eventId: string;
  readonly conversationId: string;
  readonly stalenessResult: StalenessResult;
  readonly createdAt: string;
}

export interface ConfirmationEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: 'confirmation_accepted';
  readonly payload: {
    readonly confirmation_payload: ConfirmationPayload;
  };
  readonly created_at: string;
}

export interface StalenessEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: 'staleness_detected';
  readonly payload: {
    readonly staleness_result: StalenessResult;
  };
  readonly created_at: string;
}

/**
 * Build an append-only confirmation event (spec §7 — INSERT only).
 */
export function buildConfirmationEvent(input: ConfirmationEventInput): ConfirmationEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'confirmation_accepted',
    payload: {
      confirmation_payload: input.confirmationPayload,
    },
    created_at: input.createdAt,
  };
}

/**
 * Build an append-only staleness detection event (spec §7 — INSERT only).
 */
export function buildStalenessEvent(input: StalenessEventInput): StalenessEvent {
  return {
    event_id: input.eventId,
    conversation_id: input.conversationId,
    event_type: 'staleness_detected',
    payload: {
      staleness_result: input.stalenessResult,
    },
    created_at: input.createdAt,
  };
}

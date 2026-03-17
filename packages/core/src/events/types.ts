import type { ActorType, PinnedVersions } from '@wo-agent/schemas';

/**
 * Event types for conversation_events table (spec §7, append-only-events skill).
 */
export type EventType =
  | 'state_transition'
  | 'message_received'
  | 'action_executed'
  | 'photo_attached'
  | 'emergency_action'
  | 'error_occurred'
  | 'confirmation_accepted'
  | 'staleness_reclassification';

/**
 * Conversation event — append-only row in conversation_events (spec §7).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export interface ConversationEvent {
  readonly event_id: string;
  readonly conversation_id: string;
  readonly event_type: EventType;
  readonly prior_state: string | null;
  readonly new_state: string | null;
  readonly action_type: string | null;
  readonly actor: ActorType;
  readonly payload: Record<string, unknown> | null;
  readonly pinned_versions: PinnedVersions | null;
  readonly created_at: string;
}

/**
 * Query filters for reading events. SELECT only.
 */
export interface EventQuery {
  readonly conversation_id: string;
  readonly event_type?: EventType;
  readonly limit?: number;
  readonly order?: 'asc' | 'desc';
}

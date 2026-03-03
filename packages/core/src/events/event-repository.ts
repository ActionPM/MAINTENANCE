import type { FollowUpEvent, NotificationEvent } from '@wo-agent/schemas';
import type { ConversationEvent, EventQuery } from './types.js';
import type { ConfirmationEvent, StalenessEvent } from '../confirmation/event-builder.js';
import type { RiskEvent } from '../risk/event-builder.js';

/**
 * Append-only event repository (spec §7, append-only-events skill).
 * INSERT + SELECT only. No UPDATE. No DELETE. Ever.
 *
 * Implementations:
 * - InMemoryEventStore (testing)
 * - PostgresEventStore (production, Phase 8+)
 */
export interface EventRepository {
  /** Append a single event (conversation, follow-up, confirmation, staleness, risk, or notification). */
  insert(event: ConversationEvent | FollowUpEvent | ConfirmationEvent | StalenessEvent | RiskEvent | NotificationEvent): Promise<void>;
  /** Query conversation events by filters. Returns in order specified. */
  query(filters: EventQuery): Promise<readonly ConversationEvent[]>;
}

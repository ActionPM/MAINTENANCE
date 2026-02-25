import type { FollowUpEvent } from '@wo-agent/schemas';
import type { ConversationEvent, EventQuery } from './types.js';

/**
 * Append-only event repository (spec §7, append-only-events skill).
 * INSERT + SELECT only. No UPDATE. No DELETE. Ever.
 *
 * Implementations:
 * - InMemoryEventStore (testing)
 * - PostgresEventStore (production, Phase 8+)
 */
export interface EventRepository {
  /** Append a single event (conversation or follow-up). */
  insert(event: ConversationEvent | FollowUpEvent): Promise<void>;
  /** Query conversation events by filters. Returns in order specified. */
  query(filters: EventQuery): Promise<readonly ConversationEvent[]>;
}

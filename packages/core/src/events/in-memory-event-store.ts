import type { FollowUpEvent } from '@wo-agent/schemas';
import type { EventRepository } from './event-repository.js';
import type { ConversationEvent, EventQuery } from './types.js';

type AnyEvent = ConversationEvent | FollowUpEvent;

/**
 * In-memory event store for testing (append-only-events skill).
 * INSERT + SELECT only. No UPDATE. No DELETE.
 */
export class InMemoryEventStore implements EventRepository {
  private readonly events: AnyEvent[] = [];
  private readonly ids = new Set<string>();

  async insert(event: AnyEvent): Promise<void> {
    if (this.ids.has(event.event_id)) {
      throw new Error(`Duplicate event_id: ${event.event_id}`);
    }
    this.ids.add(event.event_id);
    this.events.push(event);
  }

  async query(filters: EventQuery): Promise<readonly ConversationEvent[]> {
    let results = this.events.filter(
      (e): e is ConversationEvent => e.conversation_id === filters.conversation_id && 'event_type' in e,
    );

    if (filters.event_type) {
      results = results.filter((e) => e.event_type === filters.event_type);
    }

    results.sort((a, b) => {
      const cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return filters.order === 'desc' ? -cmp : cmp;
    });

    if (filters.limit !== undefined) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /** Query all events (conversation + follow-up). For testing only. */
  async queryAll(conversationId: string): Promise<readonly AnyEvent[]> {
    return this.events
      .filter((e) => e.conversation_id === conversationId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
}

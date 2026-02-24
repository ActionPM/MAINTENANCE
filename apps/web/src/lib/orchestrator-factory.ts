import { randomUUID } from 'crypto';
import { createDispatcher, InMemoryEventStore } from '@wo-agent/core';
import type { SessionStore, OrchestratorDependencies } from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';

// In-memory session store for MVP — PostgreSQL in Phase 8
class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();

  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

let dispatcher: ReturnType<typeof createDispatcher> | null = null;

export function getOrchestrator() {
  if (!dispatcher) {
    const deps: OrchestratorDependencies = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => randomUUID(),
      clock: () => new Date().toISOString(),
      issueSplitter: async (input) => ({
        issues: [{ issue_id: randomUUID(), summary: input.raw_text.slice(0, 200), raw_excerpt: input.raw_text }],
        issue_count: 1,
      }),
    };
    dispatcher = createDispatcher(deps);
  }
  return dispatcher;
}

import type { ConversationState, IssueSplitterInput, IssueSplitterOutput, OrchestratorActionRequest, OrchestratorActionResponse } from '@wo-agent/schemas';
import type { EventRepository } from '../events/event-repository.js';
import type { ConversationSession } from '../session/types.js';
import type { TransitionContext } from '../state-machine/guards.js';

/**
 * Dependencies injected into the orchestrator.
 * Follows dependency inversion — no concrete implementations here.
 */
export interface OrchestratorDependencies {
  readonly eventRepo: EventRepository;
  readonly sessionStore: SessionStore;
  readonly idGenerator: () => string;
  readonly clock: () => string; // ISO 8601
  readonly issueSplitter: (input: IssueSplitterInput) => Promise<IssueSplitterOutput>;
}

/**
 * Session store abstraction — the orchestrator reads/writes sessions through this.
 * Mutable table with optimistic locking (row_version).
 */
export interface SessionStore {
  get(conversationId: string): Promise<ConversationSession | null>;
  getByTenantUser(tenantUserId: string): Promise<readonly ConversationSession[]>;
  save(session: ConversationSession): Promise<void>;
}

/**
 * Result of dispatching an action through the orchestrator.
 */
export interface DispatchResult {
  readonly response: OrchestratorActionResponse;
  readonly session: ConversationSession;
}

/**
 * Context passed to individual action handlers.
 */
export interface ActionHandlerContext {
  readonly session: ConversationSession;
  readonly request: OrchestratorActionRequest;
  readonly deps: OrchestratorDependencies;
}

/**
 * Return type from an action handler.
 */
export interface ActionHandlerResult {
  readonly newState: ConversationState;
  readonly session: ConversationSession;
  readonly transitionContext?: TransitionContext;
  readonly uiMessages: readonly UIMessageInput[];
  readonly quickReplies?: readonly QuickReplyInput[];
  readonly sideEffects?: readonly SideEffectInput[];
  readonly errors?: readonly ErrorInput[];
  readonly eventPayload?: Record<string, unknown>;
  readonly eventType?: string;
}

export interface UIMessageInput {
  readonly role: 'system' | 'agent' | 'tenant';
  readonly content: string;
}

export interface QuickReplyInput {
  readonly label: string;
  readonly value: string;
  readonly action_type?: string;
}

export interface SideEffectInput {
  readonly effect_type: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly idempotency_key?: string;
}

export interface ErrorInput {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

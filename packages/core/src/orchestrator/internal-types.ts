import type { SystemEvent } from '../state-machine/system-events.js';
import type { ActorType, AuthContext } from '@wo-agent/schemas';

/**
 * Internal request type for the dispatcher's recursive auto-fire path.
 *
 * Public dispatch() still only accepts OrchestratorActionRequest.
 * Internally, when AUTO_FIRE_MAP triggers a SystemEvent (e.g.
 * START_CLASSIFICATION after split_finalized), the dispatcher builds
 * a request whose action_type is a SystemEvent, not an ActionType.
 *
 * This type makes that contract explicit instead of hiding it with
 * `as any`.
 */
export interface SystemEventRequest {
  readonly conversation_id: string | null;
  readonly actor: ActorType;
  readonly idempotency_key?: string;
  readonly request_id?: string;
  readonly auth_context: AuthContext;
  readonly action_type: SystemEvent;
  readonly tenant_input?: Record<string, unknown>;
}

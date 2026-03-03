import { ActionType, ActorType, ConversationState } from '@wo-agent/schemas';
import type { OrchestratorActionRequest } from '@wo-agent/schemas';
import { isValidTransition, isPhotoAction, ALL_SYSTEM_EVENTS } from '../state-machine/index.js';
import { SystemEvent } from '../state-machine/system-events.js';
import { updateSessionState, touchActivity, createSession } from '../session/session.js';
import type { ConversationEvent } from '../events/types.js';
import { buildResponse } from './response-builder.js';
import { getActionHandler } from './action-handlers/index.js';
import type { OrchestratorDependencies, ActionHandlerResult, DispatchResult } from './types.js';

const SYSTEM_EVENT_SET = new Set<string>(ALL_SYSTEM_EVENTS);

/**
 * Auto-fire map: when a handler lands in one of these states,
 * the dispatcher automatically fires the associated system event.
 * This implements spec §11.2 chaining (e.g., split_finalized -> START_CLASSIFICATION).
 */
const AUTO_FIRE_MAP: Partial<Record<ConversationState, string>> = {
  [ConversationState.SPLIT_FINALIZED]: SystemEvent.START_CLASSIFICATION,
};

/**
 * Create the orchestrator dispatcher.
 * The orchestrator is the ONLY component that transitions state,
 * calls LLM tools, creates WOs, sends notifications, and writes events (spec §10.1).
 */
export function createDispatcher(deps: OrchestratorDependencies) {
  return async function dispatch(request: OrchestratorActionRequest): Promise<DispatchResult> {
    const { action_type, auth_context } = request;

    // Guard: reject system events from client-facing requests (spec §11.2)
    if (SYSTEM_EVENT_SET.has(action_type)) {
      const errorSession = createSession({
        conversation_id: request.conversation_id ?? 'unknown',
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: { taxonomy_version: '', schema_version: '', model_id: '', prompt_version: '' },
      });
      return {
        response: buildResponse({
          newState: errorSession.state,
          session: errorSession,
          uiMessages: [],
          errors: [{ code: 'SYSTEM_EVENT_REJECTED', message: 'System events cannot be submitted by clients' }],
        }),
        session: errorSession,
      };
    }

    // For CREATE_CONVERSATION, create a new session
    if (action_type === ActionType.CREATE_CONVERSATION) {
      const conversationId = deps.idGenerator();
      const session = createSession({
        conversation_id: conversationId,
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: {
          taxonomy_version: '1.0.0',
          schema_version: '1.0.0',
          model_id: 'default',
          prompt_version: '1.0.0',
        },
      });

      const handler = getActionHandler(action_type);
      const handlerResult = await handler({
        session,
        request: { ...request, conversation_id: conversationId },
        deps,
      });

      // Write event
      const event: ConversationEvent = {
        event_id: deps.idGenerator(),
        conversation_id: conversationId,
        event_type: 'state_transition',
        prior_state: null,
        new_state: handlerResult.newState,
        action_type,
        actor: request.actor,
        payload: handlerResult.eventPayload ?? null,
        pinned_versions: session.pinned_versions,
        created_at: deps.clock(),
      };
      await deps.eventRepo.insert(event);

      await deps.sessionStore.save(handlerResult.session);

      return {
        response: buildResponse(handlerResult),
        session: handlerResult.session,
      };
    }

    // For all other actions, load existing session
    const session = await deps.sessionStore.get(request.conversation_id!);
    if (!session) {
      const errorSession = createSession({
        conversation_id: request.conversation_id!,
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: { taxonomy_version: '', schema_version: '', model_id: '', prompt_version: '' },
      });
      return {
        response: buildResponse({
          newState: errorSession.state,
          session: errorSession,
          uiMessages: [],
          errors: [{ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' }],
        }),
        session: errorSession,
      };
    }

    // Photo actions: valid from any state, no state change
    if (isPhotoAction(action_type)) {
      const handler = getActionHandler(action_type);
      const handlerResult = await handler({ session, request, deps });

      const event: ConversationEvent = {
        event_id: deps.idGenerator(),
        conversation_id: session.conversation_id,
        event_type: 'photo_attached',
        prior_state: session.state,
        new_state: session.state,
        action_type,
        actor: request.actor,
        payload: handlerResult.eventPayload ?? null,
        pinned_versions: null,
        created_at: deps.clock(),
      };
      await deps.eventRepo.insert(event);

      const updatedSession = touchActivity(session);
      await deps.sessionStore.save(updatedSession);

      return {
        response: buildResponse({ ...handlerResult, session: updatedSession }),
        session: updatedSession,
      };
    }

    // Validate transition
    if (!isValidTransition(session.state, action_type)) {
      return {
        response: buildResponse({
          newState: session.state,
          session,
          uiMessages: [],
          errors: [{
            code: 'INVALID_TRANSITION',
            message: `Action ${action_type} is not valid from state ${session.state}`,
          }],
        }),
        session,
      };
    }

    // Dispatch to handler
    const handler = getActionHandler(action_type);
    const handlerResult = await handler({ session, request, deps });

    // Write events and apply state for the initial handler result
    let currentResult = handlerResult;
    let currentSession = session;
    let latestUpdatedSession = writeHandlerEvents(
      currentResult,
      currentSession,
      action_type,
      request.actor,
    );

    // Auto-chain: if the handler landed in a state that has a registered
    // system event (e.g., split_finalized -> START_CLASSIFICATION), fire it
    // automatically. This implements spec §11.2 chaining.
    const autoFireEvent = AUTO_FIRE_MAP[currentResult.newState as ConversationState];
    if (autoFireEvent) {
      const chainHandler = getActionHandler(autoFireEvent);
      const chainSession = await latestUpdatedSession;
      const chainResult = await chainHandler({
        session: chainSession,
        request: { ...request, action_type: autoFireEvent as any },
        deps,
      });

      // Write events for the chained handler result.
      // The prior state for the chain starts at the newState of the initial result.
      latestUpdatedSession = writeHandlerEvents(
        chainResult,
        chainSession,
        autoFireEvent,
        request.actor,
      );

      // The chained result becomes the final result returned to the caller
      currentResult = chainResult;
    }

    const finalSession = await latestUpdatedSession;
    await deps.sessionStore.save(finalSession);

    return {
      response: buildResponse({ ...currentResult, session: finalSession }),
      session: finalSession,
    };
  };

  /**
   * Write events for a handler result (intermediate steps + final event)
   * and return the updated session with the new state applied.
   */
  async function writeHandlerEvents(
    handlerResult: ActionHandlerResult,
    priorSession: { conversation_id: string; state: ConversationState },
    actionType: string,
    actor: ActorType,
  ) {
    let priorState = priorSession.state;
    const conversationId = priorSession.conversation_id;
    const versions = handlerResult.session.pinned_versions;

    if (handlerResult.intermediateSteps?.length) {
      for (const step of handlerResult.intermediateSteps) {
        const intermediateEvent: ConversationEvent = {
          event_id: deps.idGenerator(),
          conversation_id: conversationId,
          event_type: (step.eventType as any) ?? 'state_transition',
          prior_state: priorState,
          new_state: step.state,
          action_type: actionType,
          actor,
          payload: step.eventPayload ?? null,
          pinned_versions: versions,
          created_at: deps.clock(),
        };
        await deps.eventRepo.insert(intermediateEvent);
        priorState = step.state;
      }
    }

    // Write final event (uses finalSystemAction as action_type when present)
    const event: ConversationEvent = {
      event_id: deps.idGenerator(),
      conversation_id: conversationId,
      event_type: (handlerResult.eventType as any) ?? 'state_transition',
      prior_state: priorState,
      new_state: handlerResult.newState,
      action_type: handlerResult.finalSystemAction ?? actionType,
      actor,
      payload: handlerResult.eventPayload ?? null,
      pinned_versions: versions,
      created_at: deps.clock(),
    };
    await deps.eventRepo.insert(event);

    // Apply state change
    return handlerResult.newState !== priorSession.state
      ? updateSessionState(handlerResult.session, handlerResult.newState)
      : touchActivity(handlerResult.session);
  }
}

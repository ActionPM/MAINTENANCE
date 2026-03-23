import {
  ActionType,
  ActorType,
  ConversationState,
  resolveCurrentVersions,
} from '@wo-agent/schemas';
import type { OrchestratorActionRequest } from '@wo-agent/schemas';
import {
  isValidTransition,
  isPhotoAction,
  isEmergencyAction,
  ALL_SYSTEM_EVENTS,
} from '../state-machine/index.js';
import { SystemEvent } from '../state-machine/system-events.js';
import {
  updateSessionState,
  touchActivity,
  createSession,
  markConfirmationPresented,
} from '../session/session.js';
import type { ConversationEvent } from '../events/types.js';
import { buildResponse } from './response-builder.js';
import { getActionHandler } from './action-handlers/index.js';
import type { SystemEventRequest } from './internal-types.js';
import type { OrchestratorDependencies, ActionHandlerResult, DispatchResult } from './types.js';

const SYSTEM_EVENT_SET = new Set<string>(ALL_SYSTEM_EVENTS);

/**
 * Auto-fire map: when a handler lands in one of these states,
 * the dispatcher automatically fires the associated system event.
 * This implements spec §11.2 chaining (e.g., split_finalized -> START_CLASSIFICATION).
 */
const AUTO_FIRE_MAP: Partial<Record<ConversationState, SystemEvent>> = {
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
    const request_id = request.request_id ?? deps.idGenerator();
    const startTime = Date.now();
    const logger = deps.logger;
    const timestamp = deps.clock();
    const conversation_id = request.conversation_id ?? undefined;

    logger?.log({
      component: 'dispatcher',
      event: 'action_received',
      action_type,
      conversation_id,
      request_id,
      severity: 'info',
      timestamp,
    });

    // Guard: reject system events from client-facing requests (spec §11.2)
    if (SYSTEM_EVENT_SET.has(action_type)) {
      const errorSession = createSession({
        conversation_id: request.conversation_id ?? 'unknown',
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: {
          taxonomy_version: '',
          schema_version: '',
          model_id: '',
          prompt_version: '',
          cue_version: '',
        },
      });
      logger?.log({
        component: 'dispatcher',
        event: 'action_rejected',
        action_type,
        request_id,
        error_code: 'SYSTEM_EVENT_REJECTED',
        severity: 'warn',
        duration_ms: Date.now() - startTime,
        timestamp: deps.clock(),
      });
      return {
        response: buildResponse({
          newState: errorSession.state,
          session: errorSession,
          uiMessages: [],
          errors: [
            {
              code: 'SYSTEM_EVENT_REJECTED',
              message: 'System events cannot be submitted by clients',
            },
          ],
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
        pinned_versions: resolveCurrentVersions(deps.modelId),
      });

      const handler = getActionHandler(action_type);
      const handlerResult = await handler({
        session,
        request: { ...request, conversation_id: conversationId },
        deps,
        request_id,
        logger: deps.logger,
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

      const createDuration = Date.now() - startTime;
      logger?.log({
        component: 'dispatcher',
        event: 'action_completed',
        action_type,
        conversation_id: conversationId,
        request_id,
        state_after: handlerResult.newState,
        severity: 'info',
        duration_ms: createDuration,
        timestamp: deps.clock(),
      });
      await deps.metricsRecorder?.record({
        metric_name: 'orchestrator_action_latency_ms',
        metric_value: createDuration,
        component: 'dispatcher',
        action_type,
        request_id,
        conversation_id: conversationId,
        timestamp: deps.clock(),
      });

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
        pinned_versions: {
          taxonomy_version: '',
          schema_version: '',
          model_id: '',
          prompt_version: '',
          cue_version: '',
        },
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

    // Ownership guard: reject if the authenticated tenant does not own this session.
    // Returns NOT_FOUND (not FORBIDDEN) to avoid leaking record existence.
    // Positioned after session load and before any handler dispatch so that
    // all code paths — including photo actions and auto-fired chained events —
    // are covered by a single enforcement point.
    if (session.tenant_user_id !== auth_context.tenant_user_id) {
      const errorSession = createSession({
        conversation_id: request.conversation_id!,
        tenant_user_id: auth_context.tenant_user_id,
        tenant_account_id: auth_context.tenant_account_id,
        authorized_unit_ids: auth_context.authorized_unit_ids,
        pinned_versions: {
          taxonomy_version: '',
          schema_version: '',
          model_id: '',
          prompt_version: '',
          cue_version: '',
        },
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
      const handlerResult = await handler({
        session,
        request,
        deps,
        request_id,
        logger: deps.logger,
      });

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

    // Emergency sidecar actions: valid from any non-terminal state,
    // guarded by escalation_state === 'pending_confirmation' (plan §3.1, §3.9)
    if (isEmergencyAction(action_type)) {
      const TERMINAL_STATES: ReadonlySet<ConversationState> = new Set([
        ConversationState.SUBMITTED,
        ConversationState.INTAKE_EXPIRED,
      ]);

      if (TERMINAL_STATES.has(session.state)) {
        return {
          response: buildResponse({
            newState: session.state,
            session,
            uiMessages: [],
            errors: [
              {
                code: 'INVALID_TRANSITION',
                message: `Action ${action_type} is not valid from terminal state ${session.state}`,
              },
            ],
          }),
          session,
        };
      }

      if (session.escalation_state !== 'pending_confirmation') {
        return {
          response: buildResponse({
            newState: session.state,
            session,
            uiMessages: [],
            errors: [
              {
                code: 'ESCALATION_STATE_MISMATCH',
                message: `Action ${action_type} requires escalation_state 'pending_confirmation', got '${session.escalation_state}'`,
              },
            ],
          }),
          session,
        };
      }

      const handler = getActionHandler(action_type);
      const handlerResult = await handler({
        session,
        request,
        deps,
        request_id,
        logger: deps.logger,
      });

      const event: ConversationEvent = {
        event_id: deps.idGenerator(),
        conversation_id: session.conversation_id,
        event_type: handlerResult.eventType ?? 'emergency_action',
        prior_state: session.state,
        new_state: session.state, // sidecar — state does not change
        action_type,
        actor: request.actor,
        payload: handlerResult.eventPayload ?? null,
        pinned_versions: null,
        created_at: deps.clock(),
      };
      await deps.eventRepo.insert(event);

      const updatedSession = touchActivity(handlerResult.session);
      await deps.sessionStore.save(updatedSession);

      return {
        response: buildResponse({ ...handlerResult, session: updatedSession }),
        session: updatedSession,
      };
    }

    // Validate transition
    if (!isValidTransition(session.state, action_type)) {
      logger?.log({
        component: 'dispatcher',
        event: 'action_rejected',
        action_type,
        conversation_id: session.conversation_id,
        request_id,
        state_before: session.state,
        error_code: 'INVALID_TRANSITION',
        severity: 'warn',
        duration_ms: Date.now() - startTime,
        timestamp: deps.clock(),
      });
      return {
        response: buildResponse({
          newState: session.state,
          session,
          uiMessages: [],
          errors: [
            {
              code: 'INVALID_TRANSITION',
              message: `Action ${action_type} is not valid from state ${session.state}`,
            },
          ],
        }),
        session,
      };
    }

    // Dispatch to handler
    const handler = getActionHandler(action_type);
    const handlerResult = await handler({
      session,
      request,
      deps,
      request_id,
      logger: deps.logger,
    });

    // Write events and apply state for the initial handler result
    let currentResult = handlerResult;
    const currentSession = session;
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
      logger?.log({
        component: 'dispatcher',
        event: 'auto_fire_triggered',
        action_type: autoFireEvent,
        conversation_id: session.conversation_id,
        request_id,
        state_before: currentResult.newState,
        severity: 'info',
        timestamp: deps.clock(),
      });
      const chainHandler = getActionHandler(autoFireEvent);
      const chainSession = await latestUpdatedSession;
      const chainResult = await chainHandler({
        session: chainSession,
        request: {
          conversation_id: request.conversation_id,
          actor: request.actor,
          auth_context: request.auth_context,
          idempotency_key: request.idempotency_key,
          request_id: request.request_id,
          action_type: autoFireEvent,
        } satisfies SystemEventRequest,
        deps,
        request_id,
        logger: deps.logger,
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

    let finalSession = await latestUpdatedSession;

    // When entering tenant_confirmation_pending the response will include
    // the confirmation payload, so mark it as presented on the persisted
    // session. This ensures the staleness checker uses the
    // "seen_artifact_borderline_expired" path (confidence-aware) instead of
    // the unconditional "unseen_artifact_expired" path.
    if (finalSession.state === ConversationState.TENANT_CONFIRMATION_PENDING) {
      finalSession = markConfirmationPresented(finalSession);
    }

    await deps.sessionStore.save(finalSession);

    const actionDuration = Date.now() - startTime;
    logger?.log({
      component: 'dispatcher',
      event: 'action_completed',
      action_type,
      conversation_id: session.conversation_id,
      request_id,
      state_before: session.state,
      state_after: finalSession.state,
      severity: 'info',
      duration_ms: actionDuration,
      timestamp: deps.clock(),
    });
    await deps.metricsRecorder?.record({
      metric_name: 'orchestrator_action_latency_ms',
      metric_value: actionDuration,
      component: 'dispatcher',
      action_type,
      request_id,
      conversation_id: session.conversation_id,
      timestamp: deps.clock(),
    });

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
          event_type: step.eventType ?? 'state_transition',
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
      event_type: handlerResult.eventType ?? 'state_transition',
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

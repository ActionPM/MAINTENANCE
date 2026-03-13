import { setEscalationState } from '../../session/session.js';
import { startIncident } from '../../risk/escalation-coordinator.js';
import { DEFAULT_COORDINATOR_CONFIG } from '../../risk/escalation-coordinator.js';
import { renderMitigationMessages } from '../../risk/mitigation.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handle CONFIRM_EMERGENCY (plan §5.1).
 *
 * Sidecar action — does not change conversation state.
 * Guards: escalation_state must be 'pending_confirmation' (enforced by dispatcher).
 * Logic: look up plan by building_id, create incident via coordinator,
 * set escalation_state to 'routing'.
 */
export async function handleConfirmEmergency(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, deps } = ctx;

  // Guard: feature flag fail-closed (plan §6.2)
  // The dispatcher writes the audit event via the returned eventType/eventPayload.
  if (!deps.emergencyRoutingEnabled) {
    return {
      newState: session.state,
      session, // leave escalation_state at pending_confirmation
      uiMessages: [
        {
          role: 'system',
          content:
            'Emergency routing is not currently available. If this is a life-threatening emergency, please call 911.',
        },
      ],
      errors: [
        {
          code: 'EMERGENCY_ROUTING_UNAVAILABLE',
          message: 'Emergency routing is disabled by feature flag',
        },
      ],
      eventType: 'emergency_action',
      eventPayload: { reason: 'emergency_routing_disabled' },
    };
  }

  // Guard: building_id must be available
  if (!session.building_id) {
    return {
      newState: session.state,
      session,
      uiMessages: [
        {
          role: 'system',
          content:
            'Unable to route emergency — building information is not available. If this is a life-threatening emergency, please call 911.',
        },
      ],
      errors: [
        {
          code: 'BUILDING_ID_MISSING',
          message: 'building_id is not set on the session — cannot select escalation plan',
        },
      ],
      eventType: 'emergency_action',
      eventPayload: { reason: 'building_id_missing' },
    };
  }

  // Guard: escalation incident store must be available
  if (!deps.escalationIncidentStore) {
    return {
      newState: session.state,
      session,
      uiMessages: [
        {
          role: 'system',
          content:
            'Emergency routing is not currently available. If this is a life-threatening emergency, please call 911.',
        },
      ],
      errors: [
        {
          code: 'EMERGENCY_ROUTING_UNAVAILABLE',
          message: 'Escalation incident store is not configured',
        },
      ],
      eventType: 'emergency_action',
      eventPayload: { reason: 'incident_store_missing' },
    };
  }

  // Guard: voice and SMS providers must be available when routing is enabled
  if (!deps.voiceProvider || !deps.smsProvider) {
    return {
      newState: session.state,
      session,
      uiMessages: [
        {
          role: 'system',
          content:
            'Emergency routing is not currently available. If this is a life-threatening emergency, please call 911.',
        },
      ],
      errors: [
        {
          code: 'EMERGENCY_ROUTING_UNAVAILABLE',
          message: 'Voice/SMS providers are not configured',
        },
      ],
      eventType: 'emergency_action',
      eventPayload: { reason: 'providers_missing' },
    };
  }

  // Look up plan
  const plan = deps.escalationPlans.plans.find((p) => p.building_id === session.building_id);
  if (!plan) {
    const updatedSession = setEscalationState(session, 'none');
    return {
      newState: session.state,
      session: updatedSession,
      uiMessages: [
        {
          role: 'system',
          content:
            'No emergency escalation plan is configured for this building. If this is a life-threatening emergency, please call 911.',
        },
      ],
      errors: [
        {
          code: 'NO_ESCALATION_PLAN',
          message: `No escalation plan found for building: ${session.building_id}`,
        },
      ],
      eventType: 'emergency_action',
      eventPayload: { reason: 'no_plan', building_id: session.building_id },
    };
  }

  // Guard: check for existing active incident (idempotency — prevents double-click)
  const existingIncident = await deps.escalationIncidentStore.getActiveByConversation(
    session.conversation_id,
  );
  if (existingIncident) {
    // Already routing — return success with existing incident info
    const updatedSession = setEscalationState(session, 'routing', existingIncident.plan_id);
    return {
      newState: session.state,
      session: updatedSession,
      uiMessages: [
        {
          role: 'system',
          content:
            'Emergency escalation is already in progress for this conversation. The response team is being contacted.',
        },
      ],
      eventType: 'emergency_action',
      eventPayload: {
        incident_id: existingIncident.incident_id,
        reason: 'already_active',
      },
    };
  }

  // Build coordinator config from typed deps (no silent no-op fallbacks)
  const config = deps.escalationConfig ?? {
    ...DEFAULT_COORDINATOR_CONFIG,
    emergencyRoutingEnabled: true,
  };

  // Create the incident and start escalation
  try {
    const incident = await startIncident(
      {
        conversationId: session.conversation_id,
        buildingId: session.building_id,
        escalationPlans: deps.escalationPlans,
        summary: session.split_issues?.[0]?.summary ?? 'Emergency reported',
      },
      {
        incidentStore: deps.escalationIncidentStore,
        voiceProvider: deps.voiceProvider,
        smsProvider: deps.smsProvider,
        config,
        idGenerator: deps.idGenerator,
        clock: deps.clock,
        writeRiskEvent: async (event) => {
          await deps.eventRepo.insert({
            event_id: event.event_id,
            conversation_id: event.conversation_id,
            event_type: 'emergency_action' as any,
            prior_state: session.state,
            new_state: session.state,
            action_type: 'CONFIRM_EMERGENCY',
            actor: 'system',
            payload: event.payload,
            pinned_versions: null,
            created_at: event.created_at,
          });
        },
      },
    );

    const updatedSession = setEscalationState(session, 'routing', plan.plan_id);

    // S17-04: Now that the tenant has confirmed the emergency, render
    // previously-suppressed mitigation messages for requires_confirmation triggers.
    const confirmedTriggers = (session.risk_triggers ?? []).filter(
      (m) => m.trigger.requires_confirmation,
    );
    const mitigationMsgs =
      confirmedTriggers.length > 0
        ? renderMitigationMessages(confirmedTriggers, deps.riskProtocols).map((msg) => ({
            role: 'system' as const,
            content: msg,
          }))
        : [];

    return {
      newState: session.state,
      session: updatedSession,
      uiMessages: [
        {
          role: 'system',
          content:
            'Emergency confirmed. We are contacting the emergency response team for your building now. You will be notified when someone accepts responsibility.',
        },
        ...mitigationMsgs,
      ],
      eventType: 'emergency_action',
      eventPayload: {
        incident_id: incident.incident_id,
        plan_id: plan.plan_id,
        building_id: session.building_id,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error starting escalation';
    return {
      newState: session.state,
      session,
      uiMessages: [
        {
          role: 'system',
          content:
            'Emergency routing encountered an error. If this is a life-threatening emergency, please call 911.',
        },
      ],
      errors: [{ code: 'ESCALATION_START_FAILED', message }],
      eventType: 'emergency_action',
    };
  }
}

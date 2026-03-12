import { setEscalationState } from '../../session/session.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

/**
 * Handle DECLINE_EMERGENCY (plan §5.2).
 *
 * Sidecar action — does not change conversation state.
 * Sets escalation_state from 'pending_confirmation' to 'none'.
 * Returns safety messaging. No escalation incident is created.
 *
 * The dispatcher writes the audit event via the returned eventType/eventPayload.
 */
export async function handleDeclineEmergency(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session } = ctx;

  const updatedSession = setEscalationState(session, 'none');

  return {
    newState: session.state,
    session: updatedSession,
    uiMessages: [
      {
        role: 'system',
        content:
          'Understood. If the situation changes and you need emergency assistance, please let us know. If this becomes a life-threatening emergency, call 911.',
      },
    ],
    eventType: 'emergency_action',
    eventPayload: { action: 'decline_emergency' },
  };
}

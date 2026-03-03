import { ConversationState } from '@wo-agent/schemas';
import type { TenantInputSelectUnit } from '@wo-agent/schemas';
import { resolveSelectUnit } from '../../state-machine/guards.js';
import { setSessionUnit, setSessionScope } from '../../session/session.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleSelectUnit(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;
  const input = request.tenant_input as TenantInputSelectUnit;
  const unitId = input.unit_id;

  const targetState = resolveSelectUnit(session.state, {
    authorized_unit_ids: request.auth_context.authorized_unit_ids,
    selected_unit_id: unitId,
  });

  if (targetState === null) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'That unit is not available. Please select from your authorized units.' }],
      errors: [{ code: 'UNIT_NOT_AUTHORIZED', message: `Unit ${unitId} is not in your authorized list` }],
    };
  }

  // Resolve property/client scope from unit
  const unitInfo = await deps.unitResolver.resolve(unitId);
  if (!unitInfo) {
    return {
      newState: session.state,
      session,
      uiMessages: [{ role: 'agent', content: 'Unable to resolve unit information. Please try again.' }],
      errors: [{ code: 'UNIT_NOT_FOUND', message: 'Unit not found in property database' }],
    };
  }

  let updatedSession = setSessionUnit(session, unitId);
  updatedSession = setSessionScope(updatedSession, {
    property_id: unitInfo.property_id,
    client_id: unitInfo.client_id,
  });

  return {
    newState: targetState,
    session: updatedSession,
    uiMessages: [{ role: 'agent', content: 'Unit selected. How can we help you today?' }],
    eventPayload: { unit_id: unitId },
  };
}

import { ActionType, ConversationState } from '@wo-agent/schemas';
import {
  setSessionUnit,
  setSessionScope,
  setBuildingId,
  updateSessionState,
} from '../../session/session.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';

export async function handleCreateConversation(
  ctx: ActionHandlerContext,
): Promise<ActionHandlerResult> {
  const { session, request, deps } = ctx;
  const unitCount = request.auth_context.authorized_unit_ids.length;

  if (unitCount === 1) {
    const autoUnitId = request.auth_context.authorized_unit_ids[0];
    const unitInfo = await deps.unitResolver.resolve(autoUnitId);

    if (!unitInfo) {
      // Resolver failed — fall to unit_selection_required so the UnitSelector renders.
      // Do NOT fall back to intake_started — it is removed from INPUT_STATES and
      // would be a silent dead-end (no MessageInput, no UnitSelector).
      // Note: The CREATE_CONVERSATION dispatcher path does not call updateSessionState,
      // so we must set the state on the session explicitly.
      return {
        newState: ConversationState.UNIT_SELECTION_REQUIRED,
        session: updateSessionState(session, ConversationState.UNIT_SELECTION_REQUIRED),
        uiMessages: [
          {
            role: 'agent' as const,
            content: 'Welcome! Please select your unit to get started.',
          },
        ],
        quickReplies: [
          {
            label: `Unit ${autoUnitId}`,
            value: autoUnitId,
            action_type: ActionType.SELECT_UNIT,
          },
        ],
        errors: [
          {
            code: 'UNIT_RESOLVE_FAILED',
            message: 'Auto-resolution failed, manual selection required',
          },
        ],
        eventPayload: {
          authorized_unit_ids: request.auth_context.authorized_unit_ids,
          auto_resolve_failed: true,
        },
      };
    }

    let updatedSession = setSessionUnit(session, autoUnitId);
    updatedSession = setSessionScope(updatedSession, {
      property_id: unitInfo.property_id,
      client_id: unitInfo.client_id,
    });
    updatedSession = setBuildingId(updatedSession, unitInfo.building_id);
    updatedSession = updateSessionState(updatedSession, ConversationState.UNIT_SELECTED);

    return {
      newState: ConversationState.UNIT_SELECTED,
      session: updatedSession,
      uiMessages: [{ role: 'agent' as const, content: 'Welcome! How can we help you today?' }],
      eventPayload: {
        authorized_unit_ids: request.auth_context.authorized_unit_ids,
        auto_selected_unit: autoUnitId,
      },
    };
  }

  // Multi-unit: present unit selector
  return {
    newState: ConversationState.UNIT_SELECTION_REQUIRED,
    session: updateSessionState(session, ConversationState.UNIT_SELECTION_REQUIRED),
    uiMessages: [
      {
        role: 'agent' as const,
        content: 'Welcome! Please select which unit this request is for.',
      },
    ],
    quickReplies: request.auth_context.authorized_unit_ids.map((id) => ({
      label: `Unit ${id}`,
      value: id,
      action_type: ActionType.SELECT_UNIT,
    })),
    eventPayload: { authorized_unit_ids: request.auth_context.authorized_unit_ids },
  };
}

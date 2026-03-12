import { ActionType } from '@wo-agent/schemas';
import { SystemEvent } from '../../state-machine/system-events.js';
import type { ActionHandlerContext, ActionHandlerResult } from '../types.js';
import { handleCreateConversation } from './create-conversation.js';
import { handleSelectUnit } from './select-unit.js';
import { handleSubmitInitialMessage } from './submit-initial-message.js';
import { handleSubmitAdditionalMessage } from './submit-additional-message.js';
import { handleSplitAction } from './split-actions.js';
import { handleStartClassification } from './start-classification.js';
import { handleAnswerFollowups } from './answer-followups.js';
import { handleConfirmSubmission } from './confirm-submission.js';
import { handlePhotoUpload } from './photo-upload.js';
import { handleConfirmEmergency } from './confirm-emergency.js';
import { handleDeclineEmergency } from './decline-emergency.js';
import { handleResume } from './resume.js';
import { handleAbandon } from './abandon.js';

type ActionHandler = (ctx: ActionHandlerContext) => Promise<ActionHandlerResult>;

const HANDLER_MAP: Record<string, ActionHandler> = {
  [ActionType.CREATE_CONVERSATION]: handleCreateConversation,
  [ActionType.SELECT_UNIT]: handleSelectUnit,
  [ActionType.SUBMIT_INITIAL_MESSAGE]: handleSubmitInitialMessage,
  [ActionType.SUBMIT_ADDITIONAL_MESSAGE]: handleSubmitAdditionalMessage,
  [ActionType.CONFIRM_SPLIT]: handleSplitAction,
  [ActionType.MERGE_ISSUES]: handleSplitAction,
  [ActionType.EDIT_ISSUE]: handleSplitAction,
  [ActionType.ADD_ISSUE]: handleSplitAction,
  [ActionType.REJECT_SPLIT]: handleSplitAction,
  [ActionType.ANSWER_FOLLOWUPS]: handleAnswerFollowups,
  [ActionType.CONFIRM_SUBMISSION]: handleConfirmSubmission,
  [ActionType.UPLOAD_PHOTO_INIT]: handlePhotoUpload,
  [ActionType.UPLOAD_PHOTO_COMPLETE]: handlePhotoUpload,
  [ActionType.CONFIRM_EMERGENCY]: handleConfirmEmergency,
  [ActionType.DECLINE_EMERGENCY]: handleDeclineEmergency,
  [ActionType.RESUME]: handleResume,
  [ActionType.ABANDON]: handleAbandon,
  [SystemEvent.START_CLASSIFICATION]: handleStartClassification,
};

export function getActionHandler(actionType: string): ActionHandler {
  const handler = HANDLER_MAP[actionType];
  if (!handler) {
    throw new Error(`No handler registered for action type: ${actionType}`);
  }
  return handler;
}

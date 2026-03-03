export type { ConversationSession, CreateSessionInput, IssueClassificationResult } from './types.js';
export {
  createSession,
  updateSessionState,
  touchActivity,
  setSessionUnit,
  setSplitIssues,
  setClassificationResults,
  updateFollowUpTracking,
  setPendingFollowUpQuestions,
  markAbandoned,
  markExpired,
  isExpired,
  setConfirmationTracking,
  markConfirmationPresented,
  type ExpirationConfig,
  type ConfirmationTrackingInput,
} from './session.js';
export { filterResumableDrafts } from './draft-discovery.js';

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
  setSessionScope,
  type ExpirationConfig,
  type ConfirmationTrackingInput,
  type ScopeInput,
} from './session.js';
export { filterResumableDrafts } from './draft-discovery.js';

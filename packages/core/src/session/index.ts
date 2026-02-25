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
  type ExpirationConfig,
} from './session.js';
export { filterResumableDrafts } from './draft-discovery.js';

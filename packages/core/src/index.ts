// @wo-agent/core — barrel export
// Phase 2: Auth/Session Scaffolding + Conversation State Machine

// --- State Machine ---
export {
  SystemEvent,
  ALL_SYSTEM_EVENTS,
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  isValidTransition,
  getPossibleTargets,
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
} from './state-machine/index.js';
export type { TransitionTrigger, TransitionContext } from './state-machine/index.js';

// --- Auth ---
export {
  toAuthContext,
  createTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  extractAuthFromHeader,
  validateUnitAccess,
} from './auth/index.js';
export type {
  JwtPayload,
  JwtConfig,
  TokenPair,
  TokenVerifyResult,
  AuthErrorCode,
  AuthError,
  AuthExtractionResult,
} from './auth/index.js';

// --- Session ---
export {
  createSession,
  updateSessionState,
  touchActivity,
  setSessionUnit,
  markAbandoned,
  markExpired,
  isExpired,
  filterResumableDrafts,
} from './session/index.js';
export type {
  ConversationSession,
  CreateSessionInput,
  ExpirationConfig,
} from './session/index.js';

/**
 * Internal system events triggered by the orchestrator (spec §11.2).
 * These are NOT tenant actions — they represent LLM outcomes,
 * auto-classification triggers, retries, and expiration.
 */
export const SystemEvent = {
  LLM_SPLIT_SUCCESS: 'LLM_SPLIT_SUCCESS',
  LLM_CLASSIFY_SUCCESS: 'LLM_CLASSIFY_SUCCESS',
  LLM_FAIL: 'LLM_FAIL',
  START_CLASSIFICATION: 'START_CLASSIFICATION',
  STALENESS_DETECTED: 'STALENESS_DETECTED',
  RETRY_LLM: 'RETRY_LLM',
  EXPIRE: 'EXPIRE',
} as const;

export type SystemEvent = (typeof SystemEvent)[keyof typeof SystemEvent];

export const ALL_SYSTEM_EVENTS: readonly SystemEvent[] = Object.values(SystemEvent);

import { randomUUID } from 'crypto';

/**
 * Request context for structured logging (spec §25).
 */
export interface RequestContext {
  readonly request_id: string;
  readonly timestamp: string;
}

export function createRequestContext(): RequestContext {
  return {
    request_id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

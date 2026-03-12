import { randomUUID } from 'crypto';
import type { ObservabilityContext } from '@wo-agent/core';

/**
 * Request context for structured logging (spec §25).
 * Returns an ObservabilityContext that can be passed to dispatch calls
 * and LLM adapter invocations for request correlation.
 */
export type RequestContext = ObservabilityContext;

export function createRequestContext(): RequestContext {
  return {
    request_id: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

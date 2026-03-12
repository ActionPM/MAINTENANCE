import type { Logger, MetricsRecorder, ObservabilityContext } from '../observability/types.js';

/**
 * Wraps an LLM adapter function with structured logging.
 * Logs llm_call_started, llm_call_completed, and llm_call_failed events.
 *
 * The wrapper preserves the original adapter's signature and adds an
 * optional trailing ObservabilityContext parameter for request_id correlation.
 */
export function withObservedLlmCall<TInput, TOutput>(
  adapter: (input: TInput, ...rest: unknown[]) => Promise<TOutput>,
  logger: Logger | undefined,
  metricsRecorder: MetricsRecorder | undefined,
  toolName: string,
): (input: TInput, ...rest: unknown[]) => Promise<TOutput> {
  return async (input: TInput, ...rest: unknown[]): Promise<TOutput> => {
    // Extract ObservabilityContext if last arg matches the shape
    let ctx: ObservabilityContext | undefined;
    if (rest.length > 0) {
      const lastArg = rest[rest.length - 1];
      if (lastArg && typeof lastArg === 'object' && 'request_id' in lastArg) {
        ctx = lastArg as ObservabilityContext;
        rest = rest.slice(0, -1);
      }
    }

    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    logger?.log({
      component: toolName,
      event: 'llm_call_started',
      request_id: ctx?.request_id,
      severity: 'info',
      timestamp,
      tool_name: toolName,
    });

    try {
      const result = await adapter(input, ...rest);
      const duration_ms = Date.now() - startTime;

      logger?.log({
        component: toolName,
        event: 'llm_call_completed',
        request_id: ctx?.request_id,
        severity: 'info',
        timestamp: new Date().toISOString(),
        tool_name: toolName,
        duration_ms,
      });

      await metricsRecorder?.record({
        metric_name: 'llm_call_latency_ms',
        metric_value: duration_ms,
        component: toolName,
        request_id: ctx?.request_id,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const duration_ms = Date.now() - startTime;
      const error_code = error instanceof Error ? error.constructor.name : 'UnknownError';

      logger?.log({
        component: toolName,
        event: 'llm_call_failed',
        request_id: ctx?.request_id,
        severity: 'error',
        timestamp: new Date().toISOString(),
        tool_name: toolName,
        duration_ms,
        error_code,
        error_message: error instanceof Error ? error.message : String(error),
      });

      await metricsRecorder?.record({
        metric_name: 'llm_call_error_total',
        metric_value: 1,
        component: toolName,
        request_id: ctx?.request_id,
        error_code,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  };
}

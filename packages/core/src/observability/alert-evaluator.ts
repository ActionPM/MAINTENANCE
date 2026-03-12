import type { EscalationIncidentStore } from '../risk/escalation-incident-store.js';
import type {
  MetricsQueryStore,
  AlertSink,
  AlertPayload,
  AlertCooldownStore,
  Logger,
} from './types.js';

export interface AlertEvaluatorConfig {
  readonly llmErrorSpikeThreshold: number;
  readonly schemaFailureSpikeThreshold: number;
  readonly asyncBacklogThreshold: number;
  readonly cooldownMinutes: number;
  readonly windowMinutes: number;
}

export const DEFAULT_ALERT_EVALUATOR_CONFIG: AlertEvaluatorConfig = {
  llmErrorSpikeThreshold: 10,
  schemaFailureSpikeThreshold: 5,
  asyncBacklogThreshold: 3,
  cooldownMinutes: 30,
  windowMinutes: 15,
};

export interface AlertEvaluatorDeps {
  readonly metricsQuery: MetricsQueryStore;
  readonly escalationIncidentStore: EscalationIncidentStore;
  readonly alertSink: AlertSink;
  readonly cooldownStore: AlertCooldownStore;
  readonly logger: Logger;
  readonly config: AlertEvaluatorConfig;
  readonly clock?: () => string;
}

export interface AlertEvaluationResult {
  readonly alertsEmitted: string[];
  readonly alertsSuppressed: string[];
  readonly alertsFailed: string[];
  readonly checks: number;
}

/**
 * Try to emit an alert and record cooldown. If the sink throws
 * (e.g. AlertDeliveryError when all SMS recipients fail), skip cooldown
 * so the alert is retried on the next evaluation cycle.
 */
async function tryEmitAlert(
  alertName: string,
  scope: string,
  payload: AlertPayload,
  deps: Pick<AlertEvaluatorDeps, 'alertSink' | 'cooldownStore' | 'logger'>,
  cooldownMinutes: number,
): Promise<'emitted' | 'suppressed' | 'delivery_failed'> {
  if (!(await deps.cooldownStore.shouldAlert(alertName, scope, cooldownMinutes))) {
    return 'suppressed';
  }
  try {
    await deps.alertSink.emit(payload);
    await deps.cooldownStore.recordAlert(alertName, scope);
    return 'emitted';
  } catch (err) {
    // Delivery failed — do NOT record cooldown so the alert retries next cycle
    deps.logger.log({
      component: 'alert_evaluator',
      event: 'alert_delivery_failed',
      severity: 'error',
      alert_name: alertName,
      error_code: err instanceof Error ? err.message : 'unknown',
      timestamp: payload.timestamp,
    });
    return 'delivery_failed';
  }
}

/**
 * Evaluate windowed metrics and live operational state to emit alerts.
 * Called from a cron route on a 5-minute schedule (spec §25, S25-04).
 */
export async function evaluateAlerts(deps: AlertEvaluatorDeps): Promise<AlertEvaluationResult> {
  const { metricsQuery, escalationIncidentStore, logger, config, clock } = deps;
  const now = clock?.() ?? new Date().toISOString();
  const emitted: string[] = [];
  const suppressed: string[] = [];
  const failed: string[] = [];

  // 1. LLM error spike
  const llmErrors = await metricsQuery.queryCount('llm_call_error_total', config.windowMinutes);
  if (llmErrors >= config.llmErrorSpikeThreshold) {
    const alertName = 'llm_error_spike';
    const scope = '_global';
    const result = await tryEmitAlert(
      alertName,
      scope,
      {
        alert_name: alertName,
        severity: 'critical',
        message: `LLM error count ${llmErrors} exceeds threshold ${config.llmErrorSpikeThreshold} in ${config.windowMinutes}m window`,
        component: 'alert_evaluator',
        scope,
        timestamp: now,
      },
      deps,
      config.cooldownMinutes,
    );
    if (result === 'emitted') emitted.push(alertName);
    else if (result === 'suppressed') suppressed.push(alertName);
    else failed.push(alertName);
  }

  // 2. Schema validation failure spike
  const schemaFailures = await metricsQuery.queryCount(
    'schema_validation_failure_total',
    config.windowMinutes,
  );
  if (schemaFailures >= config.schemaFailureSpikeThreshold) {
    const alertName = 'schema_failure_spike';
    const scope = '_global';
    const result = await tryEmitAlert(
      alertName,
      scope,
      {
        alert_name: alertName,
        severity: 'warning',
        message: `Schema validation failures ${schemaFailures} exceeds threshold ${config.schemaFailureSpikeThreshold} in ${config.windowMinutes}m window`,
        component: 'alert_evaluator',
        scope,
        timestamp: now,
      },
      deps,
      config.cooldownMinutes,
    );
    if (result === 'emitted') emitted.push(alertName);
    else if (result === 'suppressed') suppressed.push(alertName);
    else failed.push(alertName);
  }

  // 3. Async backlog (live operational query, not metric window)
  const overdueCount = await escalationIncidentStore.countOverdue();
  if (overdueCount >= config.asyncBacklogThreshold) {
    const alertName = 'async_backlog_threshold_exceeded';
    const scope = '_global';
    const result = await tryEmitAlert(
      alertName,
      scope,
      {
        alert_name: alertName,
        severity: 'critical',
        message: `${overdueCount} overdue escalation incidents exceeds threshold ${config.asyncBacklogThreshold}`,
        component: 'alert_evaluator',
        scope,
        timestamp: now,
      },
      deps,
      config.cooldownMinutes,
    );
    if (result === 'emitted') emitted.push(alertName);
    else if (result === 'suppressed') suppressed.push(alertName);
    else failed.push(alertName);
  }

  logger.log({
    component: 'alert_evaluator',
    event: 'evaluation_completed',
    severity: 'info',
    timestamp: now,
    alerts_emitted: emitted.length,
    alerts_suppressed: suppressed.length,
    alerts_failed: failed.length,
  });

  return {
    alertsEmitted: emitted,
    alertsSuppressed: suppressed,
    alertsFailed: failed,
    checks: 3,
  };
}

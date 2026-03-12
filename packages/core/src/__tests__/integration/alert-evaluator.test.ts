/**
 * Integration test: alert evaluator with seeded metrics (spec §25, S25-04).
 * Verifies windowed metric alerts, live backlog alerts, and cooldown behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateAlerts,
  InMemoryMetricsRecorder,
  InMemoryAlertSink,
  InMemoryAlertCooldownStore,
  InMemoryLogger,
  MisconfiguredAlertSink,
  DEFAULT_ALERT_EVALUATOR_CONFIG,
} from '../../observability/index.js';
import { SmsAlertSink, AlertDeliveryError } from '../../observability/sms-alert-sink.js';
import { InMemoryEscalationIncidentStore } from '../../risk/in-memory-incident-store.js';
import type { AlertEvaluatorDeps } from '../../observability/alert-evaluator.js';
import type { EscalationIncident } from '@wo-agent/schemas';

/** Use real current time so windowed queries in InMemoryMetricsRecorder match. */
function now(): string {
  return new Date().toISOString();
}

function makeDeps(overrides?: Partial<AlertEvaluatorDeps>): AlertEvaluatorDeps {
  return {
    metricsQuery: new InMemoryMetricsRecorder(),
    escalationIncidentStore: new InMemoryEscalationIncidentStore(),
    alertSink: new InMemoryAlertSink(),
    cooldownStore: new InMemoryAlertCooldownStore(),
    logger: new InMemoryLogger(),
    config: { ...DEFAULT_ALERT_EVALUATOR_CONFIG },
    clock: now,
    ...overrides,
  };
}

function makeOverdueIncident(id: string, status: 'active' | 'exhausted_retrying' = 'active'): EscalationIncident {
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 7200_000).toISOString();
  return {
    incident_id: id,
    conversation_id: `conv-${id}`,
    building_id: 'bldg-1',
    plan_id: 'plan-1',
    summary: 'Test emergency',
    status,
    cycle_number: 1,
    max_cycles: 3,
    current_contact_index: 0,
    next_action_at: oneHourAgo,
    processing_lock_until: null,
    last_provider_action: null,
    accepted_by_phone: null,
    accepted_by_contact_id: null,
    accepted_at: null,
    contacted_phone_numbers: [],
    internal_alert_sent_cycles: [],
    attempts: [],
    row_version: 0,
    created_at: twoHoursAgo,
    updated_at: twoHoursAgo,
  };
}

describe('Alert Evaluator', () => {
  it('emits no alerts when metrics are below threshold', async () => {
    const alertSink = new InMemoryAlertSink();
    const deps = makeDeps({ alertSink });
    const result = await evaluateAlerts(deps);

    expect(result.alertsEmitted).toEqual([]);
    expect(result.alertsSuppressed).toEqual([]);
    expect(alertSink.alerts).toHaveLength(0);
  });

  it('emits llm_error_spike alert when LLM errors exceed threshold', async () => {
    const metricsQuery = new InMemoryMetricsRecorder();
    const alertSink = new InMemoryAlertSink();

    // Seed LLM error metrics above threshold
    for (let i = 0; i < 12; i++) {
      await metricsQuery.record({
        metric_name: 'llm_call_error_total',
        metric_value: 1,
        component: 'classifier',
        timestamp: now(),
      });
    }

    const deps = makeDeps({ metricsQuery, alertSink });
    const result = await evaluateAlerts(deps);

    expect(result.alertsEmitted).toContain('llm_error_spike');
    expect(alertSink.alerts).toHaveLength(1);
    expect(alertSink.alerts[0].alert_name).toBe('llm_error_spike');
    expect(alertSink.alerts[0].severity).toBe('critical');
  });

  it('emits schema_failure_spike alert when schema failures exceed threshold', async () => {
    const metricsQuery = new InMemoryMetricsRecorder();
    const alertSink = new InMemoryAlertSink();

    for (let i = 0; i < 6; i++) {
      await metricsQuery.record({
        metric_name: 'schema_validation_failure_total',
        metric_value: 1,
        component: 'splitter',
        timestamp: now(),
      });
    }

    const deps = makeDeps({ metricsQuery, alertSink });
    const result = await evaluateAlerts(deps);

    expect(result.alertsEmitted).toContain('schema_failure_spike');
    expect(alertSink.alerts.find(a => a.alert_name === 'schema_failure_spike')).toBeDefined();
  });

  it('emits async_backlog alert when overdue incidents exceed threshold', async () => {
    const incidentStore = new InMemoryEscalationIncidentStore();
    const alertSink = new InMemoryAlertSink();

    // Seed 3 overdue incidents (threshold is 3)
    await incidentStore.create(makeOverdueIncident('inc-1', 'active'));
    await incidentStore.create(makeOverdueIncident('inc-2', 'active'));
    await incidentStore.create(makeOverdueIncident('inc-3', 'exhausted_retrying'));

    const deps = makeDeps({ escalationIncidentStore: incidentStore, alertSink });
    const result = await evaluateAlerts(deps);

    expect(result.alertsEmitted).toContain('async_backlog_threshold_exceeded');
    expect(alertSink.alerts.find(a => a.alert_name === 'async_backlog_threshold_exceeded')).toBeDefined();
  });

  it('suppresses duplicate alerts within cooldown window', async () => {
    const metricsQuery = new InMemoryMetricsRecorder();
    const alertSink = new InMemoryAlertSink();
    const cooldownStore = new InMemoryAlertCooldownStore();

    for (let i = 0; i < 12; i++) {
      await metricsQuery.record({
        metric_name: 'llm_call_error_total',
        metric_value: 1,
        component: 'classifier',
        timestamp: now(),
      });
    }

    const deps = makeDeps({ metricsQuery, alertSink, cooldownStore });

    // First evaluation: alert fires
    const result1 = await evaluateAlerts(deps);
    expect(result1.alertsEmitted).toContain('llm_error_spike');

    // Second evaluation: alert suppressed by cooldown
    const result2 = await evaluateAlerts(deps);
    expect(result2.alertsSuppressed).toContain('llm_error_spike');
    expect(result2.alertsEmitted).not.toContain('llm_error_spike');

    // Only 1 alert should have been emitted total
    expect(alertSink.alerts).toHaveLength(1);
  });

  it('does not emit backlog alert when incidents are below threshold', async () => {
    const incidentStore = new InMemoryEscalationIncidentStore();
    const alertSink = new InMemoryAlertSink();

    // Only 2 overdue (threshold is 3)
    await incidentStore.create(makeOverdueIncident('inc-1'));
    await incidentStore.create(makeOverdueIncident('inc-2'));

    const deps = makeDeps({ escalationIncidentStore: incidentStore, alertSink });
    const result = await evaluateAlerts(deps);

    expect(result.alertsEmitted).not.toContain('async_backlog_threshold_exceeded');
  });

  it('logs evaluation summary', async () => {
    const logger = new InMemoryLogger();
    const deps = makeDeps({ logger });
    await evaluateAlerts(deps);

    const summary = logger.entries.find(e => e.event === 'evaluation_completed');
    expect(summary).toBeDefined();
    expect(summary!.component).toBe('alert_evaluator');
  });

  it('skips cooldown when alert sink throws AlertDeliveryError (total delivery failure)', async () => {
    const metricsQuery = new InMemoryMetricsRecorder();
    const cooldownStore = new InMemoryAlertCooldownStore();
    const logger = new InMemoryLogger();

    // Seed LLM errors above threshold
    for (let i = 0; i < 12; i++) {
      await metricsQuery.record({
        metric_name: 'llm_call_error_total',
        metric_value: 1,
        component: 'classifier',
        timestamp: now(),
      });
    }

    // Use SmsAlertSink with a provider that always throws
    const failingProvider = {
      sendSms: async () => { throw new Error('Twilio unreachable'); },
    };
    const failingSink = new SmsAlertSink({
      smsProvider: failingProvider,
      phoneNumbers: ['+1555000111'],
      logger,
    });

    const deps = makeDeps({ metricsQuery, alertSink: failingSink, cooldownStore, logger });

    // First evaluation: delivery fails, cooldown NOT recorded
    const result1 = await evaluateAlerts(deps);
    expect(result1.alertsFailed).toContain('llm_error_spike');
    expect(result1.alertsEmitted).not.toContain('llm_error_spike');

    // Second evaluation: alert is NOT suppressed (cooldown was not recorded)
    const result2 = await evaluateAlerts(deps);
    expect(result2.alertsFailed).toContain('llm_error_spike');
    expect(result2.alertsSuppressed).not.toContain('llm_error_spike');

    // Verify delivery failure was logged
    const failureLogs = logger.entries.filter(e => e.event === 'alert_delivery_failed');
    expect(failureLogs.length).toBeGreaterThanOrEqual(2);
  });

  it('MisconfiguredAlertSink throws on every emit and evaluator skips cooldown', async () => {
    const metricsQuery = new InMemoryMetricsRecorder();
    const cooldownStore = new InMemoryAlertCooldownStore();
    const logger = new InMemoryLogger();

    for (let i = 0; i < 12; i++) {
      await metricsQuery.record({
        metric_name: 'llm_call_error_total',
        metric_value: 1,
        component: 'classifier',
        timestamp: now(),
      });
    }

    const misconfiguredSink = new MisconfiguredAlertSink(logger);
    const deps = makeDeps({ metricsQuery, alertSink: misconfiguredSink, cooldownStore, logger });

    // First evaluation: delivery impossible, cooldown NOT recorded
    const result1 = await evaluateAlerts(deps);
    expect(result1.alertsFailed).toContain('llm_error_spike');
    expect(result1.alertsEmitted).not.toContain('llm_error_spike');

    // Verify MisconfiguredAlertSink logged the delivery impossibility
    const impossibleLogs = logger.entries.filter(e => e.event === 'alert_delivery_impossible');
    expect(impossibleLogs).toHaveLength(1);
    expect(impossibleLogs[0].error_code).toBe('TWILIO_CREDENTIALS_MISSING');

    // Second evaluation: still NOT suppressed by cooldown
    const result2 = await evaluateAlerts(deps);
    expect(result2.alertsFailed).toContain('llm_error_spike');
    expect(result2.alertsSuppressed).not.toContain('llm_error_spike');
  });

  it('SmsAlertSink succeeds when at least one recipient delivers', async () => {
    const logger = new InMemoryLogger();
    let callCount = 0;
    const partialProvider = {
      sendSms: async () => {
        callCount++;
        if (callCount === 1) throw new Error('First recipient failed');
        return { messageSid: 'msg-ok' };
      },
    };

    const metricsRecorder = new InMemoryMetricsRecorder();
    const sink = new SmsAlertSink({
      smsProvider: partialProvider,
      phoneNumbers: ['+1555000111', '+1555000222'],
      logger,
      metricsRecorder,
    });

    // Should NOT throw — one of two recipients succeeded
    await expect(
      sink.emit({
        alert_name: 'test_alert',
        severity: 'critical',
        message: 'test',
        component: 'test',
        timestamp: now(),
      }),
    ).resolves.toBeUndefined();

    // Metric should be recorded (delivery partially succeeded)
    expect(metricsRecorder.observations).toHaveLength(1);
    expect(metricsRecorder.observations[0].metric_name).toBe('alert_emitted_total');
  });
});

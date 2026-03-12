import type { AlertSink, AlertPayload, Logger } from './types.js';
import { AlertDeliveryError } from './sms-alert-sink.js';

/**
 * Discards all alerts. Used when alerting is not configured.
 */
export class NoopAlertSink implements AlertSink {
  async emit(_alert: AlertPayload): Promise<void> {
    // intentionally empty
  }
}

/**
 * Collects alerts in memory for test assertions.
 */
export class InMemoryAlertSink implements AlertSink {
  readonly alerts: AlertPayload[] = [];

  async emit(alert: AlertPayload): Promise<void> {
    this.alerts.push(alert);
  }
}

/**
 * Throws on every emit. Used when the operator has configured ops alert
 * phone numbers but the SMS delivery channel is not available (e.g. missing
 * Twilio credentials). This ensures the alert evaluator:
 * 1. Does NOT record cooldown (so the alert is retried next cycle)
 * 2. Logs the delivery failure every cycle (surfacing the misconfiguration)
 */
export class MisconfiguredAlertSink implements AlertSink {
  private readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  async emit(alert: AlertPayload): Promise<void> {
    this.logger?.log({
      component: 'misconfigured_alert_sink',
      event: 'alert_delivery_impossible',
      severity: 'error',
      alert_name: alert.alert_name,
      error_code: 'TWILIO_CREDENTIALS_MISSING',
      timestamp: alert.timestamp,
    });
    throw new AlertDeliveryError(alert.alert_name, 0);
  }
}

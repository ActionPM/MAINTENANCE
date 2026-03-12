import type { SmsProvider } from '../risk/provider-types.js';
import type { AlertSink, AlertPayload, Logger, MetricsRecorder } from './types.js';

export interface SmsAlertSinkConfig {
  readonly smsProvider: SmsProvider;
  readonly phoneNumbers: readonly string[];
  readonly logger?: Logger;
  readonly metricsRecorder?: MetricsRecorder;
  readonly clock?: () => string;
}

/**
 * Thrown when every SMS recipient fails delivery.
 * The evaluator catches this to skip cooldown registration so the alert
 * is retried on the next evaluation cycle instead of being suppressed.
 */
export class AlertDeliveryError extends Error {
  constructor(
    public readonly alertName: string,
    public readonly failedRecipients: number,
  ) {
    super(`Alert ${alertName}: all ${failedRecipients} SMS recipient(s) failed`);
    this.name = 'AlertDeliveryError';
  }
}

/**
 * AlertSink that sends SMS to configured ops phone numbers.
 * Logs every emission and records a metric observation for audit (spec §25).
 *
 * Throws AlertDeliveryError when ALL recipients fail, so the caller
 * (alert evaluator) can skip cooldown and retry on the next cycle.
 */
export class SmsAlertSink implements AlertSink {
  private readonly config: SmsAlertSinkConfig;

  constructor(config: SmsAlertSinkConfig) {
    this.config = config;
  }

  async emit(alert: AlertPayload): Promise<void> {
    const { smsProvider, phoneNumbers, logger, metricsRecorder, clock } = this.config;
    const now = clock?.() ?? new Date().toISOString();

    const body = `[${alert.severity.toUpperCase()}] ${alert.alert_name}: ${alert.message}`;

    let successCount = 0;
    for (const phone of phoneNumbers) {
      try {
        await smsProvider.sendSms(phone, body);
        successCount++;
        logger?.log({
          component: 'sms_alert_sink',
          event: 'alert_sms_sent',
          alert_name: alert.alert_name,
          severity: 'info',
          phone_target: phone,
          alert_severity: alert.severity,
          timestamp: now,
        });
      } catch (err) {
        logger?.log({
          component: 'sms_alert_sink',
          event: 'alert_sms_failed',
          alert_name: alert.alert_name,
          severity: 'error',
          phone_target: phone,
          error_code: err instanceof Error ? err.message : 'unknown',
          timestamp: now,
        });
      }
    }

    if (successCount === 0 && phoneNumbers.length > 0) {
      // Total delivery failure — throw so evaluator skips cooldown
      throw new AlertDeliveryError(alert.alert_name, phoneNumbers.length);
    }

    await metricsRecorder?.record({
      metric_name: 'alert_emitted_total',
      metric_value: 1,
      component: 'sms_alert_sink',
      tags: { alert_name: alert.alert_name, severity: alert.severity },
      timestamp: now,
    });
  }
}

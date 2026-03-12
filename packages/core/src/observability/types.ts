/**
 * Observability contract — shared types for structured logging, metrics, and alerts.
 * Spec §25: S25-01 (logging), S25-02 (metrics), S25-04 (alerting).
 */

// --- Context ---

export interface ObservabilityContext {
  readonly request_id: string;
  readonly timestamp: string;
}

// --- Logging ---

export interface LogEntry {
  readonly component: string;
  readonly event: string;
  readonly request_id?: string;
  readonly conversation_id?: string;
  readonly action_type?: string;
  readonly state_before?: string;
  readonly state_after?: string;
  readonly duration_ms?: number;
  readonly error_code?: string;
  readonly severity: 'debug' | 'info' | 'warn' | 'error';
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  log(entry: LogEntry): void;
}

// --- Metrics ---

export interface MetricObservation {
  readonly metric_name: string;
  readonly metric_value: number;
  readonly component: string;
  readonly request_id?: string;
  readonly conversation_id?: string;
  readonly action_type?: string;
  readonly error_code?: string;
  readonly tags?: Record<string, string>;
  readonly timestamp: string;
}

export interface MetricsRecorder {
  record(obs: MetricObservation): Promise<void>;
}

export interface MetricsQueryStore {
  queryWindow(metricName: string, windowMinutes: number): Promise<number>;
  queryCount(metricName: string, windowMinutes: number): Promise<number>;
}

// --- Alerting ---

export interface AlertPayload {
  readonly alert_name: string;
  readonly severity: 'warning' | 'critical';
  readonly message: string;
  readonly component: string;
  readonly scope?: string;
  readonly tags?: Record<string, string>;
  readonly timestamp: string;
}

export interface AlertSink {
  emit(alert: AlertPayload): Promise<void>;
}

// --- Alert Cooldown ---

export interface AlertCooldownStore {
  shouldAlert(alertName: string, scope: string, cooldownMinutes: number): Promise<boolean>;
  recordAlert(alertName: string, scope: string): Promise<void>;
}

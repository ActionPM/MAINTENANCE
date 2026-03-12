import type { MetricsRecorder, MetricsQueryStore, MetricObservation } from './types.js';

/**
 * Discards all metric observations. Used when metrics are not configured.
 */
export class NoopMetricsRecorder implements MetricsRecorder {
  async record(_obs: MetricObservation): Promise<void> {
    // intentionally empty
  }
}

/**
 * Collects metric observations in memory for test assertions.
 * Implements both MetricsRecorder (write) and MetricsQueryStore (read).
 */
export class InMemoryMetricsRecorder implements MetricsRecorder, MetricsQueryStore {
  readonly observations: MetricObservation[] = [];

  async record(obs: MetricObservation): Promise<void> {
    this.observations.push(obs);
  }

  async queryWindow(metricName: string, windowMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    return this.observations
      .filter((o) => o.metric_name === metricName && o.timestamp >= cutoff)
      .reduce((sum, o) => sum + o.metric_value, 0);
  }

  async queryCount(metricName: string, windowMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
    return this.observations.filter((o) => o.metric_name === metricName && o.timestamp >= cutoff)
      .length;
  }
}

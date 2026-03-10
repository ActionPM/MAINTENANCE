import { describe, it, expect } from 'vitest';
import { compareRuns } from '../../reporters/compare-runs.js';

describe('compareRuns', () => {
  it('detects a regression on a critical slice (emergency)', () => {
    const baseline = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { emergency: { field_accuracy: 0.90 } },
    };
    const candidate = {
      metrics: { field_accuracy: 0.87 },
      slice_metrics: { emergency: { field_accuracy: 0.80 } },
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.some((r) => r.slice === 'emergency')).toBe(true);
    expect(report.gate_passed).toBe(false);
  });

  it('detects regressions on building_access and pest_control (correct slice names)', () => {
    const baseline = {
      metrics: {},
      slice_metrics: {
        building_access: { field_accuracy: 0.90 },
        pest_control: { field_accuracy: 0.85 },
      },
    };
    const candidate = {
      metrics: {},
      slice_metrics: {
        building_access: { field_accuracy: 0.80 },
        pest_control: { field_accuracy: 0.75 },
      },
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.some((r) => r.slice === 'building_access')).toBe(true);
    expect(report.regressions.some((r) => r.slice === 'pest_control')).toBe(true);
    expect(report.gate_passed).toBe(false);
  });

  it('passes when all slices improve or hold', () => {
    const baseline = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { emergency: { field_accuracy: 0.90 } },
    };
    const candidate = {
      metrics: { field_accuracy: 0.87 },
      slice_metrics: { emergency: { field_accuracy: 0.92 } },
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.length).toBe(0);
    expect(report.gate_passed).toBe(true);
  });

  it('flags regression only when drop exceeds threshold', () => {
    const baseline = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { emergency: { field_accuracy: 0.90 } },
    };
    const candidate = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { emergency: { field_accuracy: 0.89 } }, // only 1% drop
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.length).toBe(0);
    expect(report.gate_passed).toBe(true);
  });

  it('detects improvements', () => {
    const baseline = {
      metrics: { field_accuracy: 0.80 },
      slice_metrics: { plumbing: { field_accuracy: 0.75 } },
    };
    const candidate = {
      metrics: { field_accuracy: 0.88 },
      slice_metrics: { plumbing: { field_accuracy: 0.85 } },
    };

    const report = compareRuns(baseline, candidate);
    expect(report.improvements.length).toBeGreaterThan(0);
  });

  it('gate passes when regressions are on non-critical slices only', () => {
    const baseline = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { plumbing: { field_accuracy: 0.90 } },
    };
    const candidate = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { plumbing: { field_accuracy: 0.70 } },
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.length).toBeGreaterThan(0);
    expect(report.gate_passed).toBe(true);
  });

  it('handles empty slice metrics', () => {
    const baseline = { metrics: { field_accuracy: 0.85 }, slice_metrics: {} };
    const candidate = { metrics: { field_accuracy: 0.85 }, slice_metrics: {} };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.length).toBe(0);
    expect(report.gate_passed).toBe(true);
  });

  // --- Blocking rate metric gates (governance §6) ---

  it('blocks on schema_invalid_rate increase even on non-critical slice', () => {
    const baseline = {
      metrics: { schema_invalid_rate: 0.02 },
      slice_metrics: {},
    };
    const candidate = {
      metrics: { schema_invalid_rate: 0.08 }, // +6% increase
      slice_metrics: {},
    };

    const report = compareRuns(baseline, candidate);
    expect(report.gate_passed).toBe(false);
    expect(report.regressions.some((r) => r.metric === 'schema_invalid_rate')).toBe(true);
  });

  it('blocks on taxonomy_invalid_rate increase', () => {
    const baseline = {
      metrics: { taxonomy_invalid_rate: 0.01 },
      slice_metrics: {},
    };
    const candidate = {
      metrics: { taxonomy_invalid_rate: 0.05 },
      slice_metrics: {},
    };

    const report = compareRuns(baseline, candidate);
    expect(report.gate_passed).toBe(false);
  });

  it('blocks on contradiction_after_retry_rate increase', () => {
    const baseline = {
      metrics: { contradiction_after_retry_rate: 0.00 },
      slice_metrics: {},
    };
    const candidate = {
      metrics: { contradiction_after_retry_rate: 0.05 },
      slice_metrics: {},
    };

    const report = compareRuns(baseline, candidate);
    expect(report.gate_passed).toBe(false);
    expect(report.regressions.some((r) => r.metric === 'contradiction_after_retry_rate')).toBe(true);
  });

  it('blocks on any increase in blocking rate metrics, even below 2% threshold', () => {
    const baseline = {
      metrics: { schema_invalid_rate: 0.02 },
      slice_metrics: {},
    };
    const candidate = {
      metrics: { schema_invalid_rate: 0.021 }, // +0.1% — below normal threshold but still blocks
      slice_metrics: {},
    };

    const report = compareRuns(baseline, candidate);
    expect(report.gate_passed).toBe(false);
    expect(report.regressions.some((r) => r.metric === 'schema_invalid_rate')).toBe(true);
  });

  it('passes when blocking rate metrics stay flat or improve', () => {
    const baseline = {
      metrics: { schema_invalid_rate: 0.05, taxonomy_invalid_rate: 0.03 },
      slice_metrics: {},
    };
    const candidate = {
      metrics: { schema_invalid_rate: 0.04, taxonomy_invalid_rate: 0.02 },
      slice_metrics: {},
    };

    const report = compareRuns(baseline, candidate);
    expect(report.gate_passed).toBe(true);
  });
});

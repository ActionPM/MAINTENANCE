import { describe, it, expect } from 'vitest';
import { compareRuns } from '../../reporters/compare-runs.js';

describe('compareRuns', () => {
  it('detects a regression on a critical slice', () => {
    const baseline = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: { emergency: { field_accuracy: 0.90 } },
    };
    const candidate = {
      metrics: { field_accuracy: 0.87 },
      slice_metrics: { emergency: { field_accuracy: 0.80 } },
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.length).toBeGreaterThan(0);
    expect(report.regressions.some((r) => r.slice === 'emergency')).toBe(true);
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
      slice_metrics: { emergency: { field_accuracy: 0.89 } }, // only 1% drop, below 2% threshold
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
    const baseline = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: {},
    };
    const candidate = {
      metrics: { field_accuracy: 0.85 },
      slice_metrics: {},
    };

    const report = compareRuns(baseline, candidate);
    expect(report.regressions.length).toBe(0);
    expect(report.improvements.length).toBe(0);
    expect(report.gate_passed).toBe(true);
  });
});

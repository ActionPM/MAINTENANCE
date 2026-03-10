import { describe, it, expect } from 'vitest';
import {
  validateEvalExample,
  validateEvalManifest,
  validateEvalRun,
  validateEvalReport,
} from '../validators/eval-validators.js';

const NOW = '2026-03-10T12:00:00.000Z';

function validGoldExample(): Record<string, unknown> {
  return {
    example_id: 'ex-001',
    dataset_type: 'gold',
    source_type: 'fixture',
    conversation_text: 'My toilet is leaking in the bathroom.',
    split_issues_expected: [{ issue_text: 'toilet leak in bathroom' }],
    expected_classification_by_issue: [
      {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
        Priority: 'high',
      },
    ],
    expected_missing_fields: [],
    expected_followup_fields: [],
    expected_needs_human_triage: false,
    expected_risk_flags: [],
    slice_tags: ['plumbing', 'bathroom'],
    taxonomy_version: '1.1.0',
    schema_version: '1.0.0',
    review_status: 'approved_for_gate',
    reviewed_by: 'test-author',
    created_at: NOW,
  };
}

// --- EvalExample ---

describe('validateEvalExample', () => {
  it('accepts a valid gold example', () => {
    const result = validateEvalExample(validGoldExample());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects when required fields are missing', () => {
    const { example_id, dataset_type, ...rest } = validGoldExample();
    const result = validateEvalExample(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects mismatched split/classification counts', () => {
    const example = validGoldExample();
    // Two splits but only one classification
    (example.split_issues_expected as unknown[]).push({ issue_text: 'second issue' });
    const result = validateEvalExample(example);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('1:1 aligned'))).toBe(true);
  });

  it('rejects invalid taxonomy values in expected classification', () => {
    const example = validGoldExample();
    (example.expected_classification_by_issue as Record<string, string>[])[0].Category = 'BOGUS_CATEGORY';
    const result = validateEvalExample(example);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('BOGUS_CATEGORY'))).toBe(true);
  });

  it('rejects invalid dataset_type', () => {
    const example = validGoldExample();
    example.dataset_type = 'nonexistent';
    const result = validateEvalExample(example);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// --- EvalDatasetManifest ---

describe('validateEvalManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateEvalManifest({
      manifest_id: 'mf-001',
      dataset_type: 'gold',
      taxonomy_version: '1.1.0',
      schema_version: '1.0.0',
      example_count: 10,
      created_at: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = validateEvalManifest({ manifest_id: 'mf-001' });
    expect(result.valid).toBe(false);
  });
});

// --- EvalRun ---

describe('validateEvalRun', () => {
  it('accepts a valid run', () => {
    const result = validateEvalRun({
      run_id: 'run-001',
      runner_type: 'issue_level',
      dataset_manifest_id: 'mf-001',
      taxonomy_version: '1.1.0',
      schema_version: '1.0.0',
      cue_dict_version: '1.0.0',
      prompt_version: 'v1',
      model_id: 'claude-3-haiku',
      started_at: NOW,
      completed_at: NOW,
      results: [
        { example_id: 'ex-001', status: 'ok' },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = validateEvalRun({ run_id: 'run-001' });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid taxonomy values in result classifications', () => {
    const result = validateEvalRun({
      run_id: 'run-002',
      runner_type: 'issue_level',
      dataset_manifest_id: 'mf-001',
      taxonomy_version: '1.1.0',
      schema_version: '1.0.0',
      cue_dict_version: '1.0.0',
      prompt_version: 'v1',
      model_id: 'claude-3-haiku',
      started_at: NOW,
      completed_at: NOW,
      results: [
        {
          example_id: 'ex-001',
          status: 'ok',
          classification: {
            Category: 'BOGUS_CATEGORY',
            Location: 'suite',
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('BOGUS_CATEGORY'))).toBe(true);
  });

  it('skips domain validation for non-ok results', () => {
    const result = validateEvalRun({
      run_id: 'run-003',
      runner_type: 'issue_level',
      dataset_manifest_id: 'mf-001',
      taxonomy_version: '1.1.0',
      schema_version: '1.0.0',
      cue_dict_version: '1.0.0',
      prompt_version: 'v1',
      model_id: 'claude-3-haiku',
      started_at: NOW,
      completed_at: NOW,
      results: [
        {
          example_id: 'ex-001',
          status: 'taxonomy_fail',
          classification: {
            Category: 'BOGUS_CATEGORY',
          },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

// --- EvalReport ---

describe('validateEvalReport', () => {
  it('accepts a valid report', () => {
    const result = validateEvalReport({
      report_id: 'rpt-001',
      baseline_run_id: 'run-001',
      candidate_run_id: 'run-002',
      metrics: { accuracy: 0.95 },
      slice_metrics: { plumbing: { accuracy: 0.92 } },
      regressions: [],
      created_at: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = validateEvalReport({ report_id: 'rpt-001' });
    expect(result.valid).toBe(false);
  });
});

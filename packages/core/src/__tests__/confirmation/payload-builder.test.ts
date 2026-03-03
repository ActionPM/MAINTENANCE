import { describe, it, expect } from 'vitest';
import {
  buildConfirmationPayload,
  computeContentHash,
  type ConfirmationPayload,
  type ConfirmationIssue,
} from '../../confirmation/payload-builder.js';
import type { IssueClassificationResult } from '../../session/types.js';
import type { SplitIssue } from '@wo-agent/schemas';

const SPLIT_ISSUES: readonly SplitIssue[] = [
  { issue_id: 'issue-1', summary: 'Leaking toilet', raw_excerpt: 'My toilet is leaking badly' },
  { issue_id: 'issue-2', summary: 'Broken window', raw_excerpt: 'The bedroom window is cracked' },
];

const CLASSIFICATION_RESULTS: readonly IssueClassificationResult[] = [
  {
    issue_id: 'issue-1',
    classifierOutput: {
      issue_id: 'issue-1',
      classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
      model_confidence: { Category: 0.95, Maintenance_Category: 0.88 },
      missing_fields: [],
      needs_human_triage: false,
    },
    computedConfidence: { Category: 0.92, Maintenance_Category: 0.85 },
    fieldsNeedingInput: [],
  },
  {
    issue_id: 'issue-2',
    classifierOutput: {
      issue_id: 'issue-2',
      classification: { Category: 'maintenance', Maintenance_Category: 'general' },
      model_confidence: { Category: 0.70, Maintenance_Category: 0.50 },
      missing_fields: ['Maintenance_Object'],
      needs_human_triage: true,
    },
    computedConfidence: { Category: 0.72, Maintenance_Category: 0.55 },
    fieldsNeedingInput: [],
  },
];

describe('buildConfirmationPayload', () => {
  it('builds a payload with one entry per issue', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    expect(payload.issues).toHaveLength(2);
  });

  it('maps split issue fields to confirmation issue', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    const first = payload.issues[0];
    expect(first.issue_id).toBe('issue-1');
    expect(first.summary).toBe('Leaking toilet');
    expect(first.raw_excerpt).toBe('My toilet is leaking badly');
  });

  it('includes classification labels and confidence', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    const first = payload.issues[0];
    expect(first.classification).toEqual({ Category: 'maintenance', Maintenance_Category: 'plumbing' });
    expect(first.confidence_by_field).toEqual({ Category: 0.92, Maintenance_Category: 0.85 });
  });

  it('flags issues that need human triage', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    expect(payload.issues[0].needs_human_triage).toBe(false);
    expect(payload.issues[1].needs_human_triage).toBe(true);
  });

  it('includes missing fields from classifier output', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    expect(payload.issues[0].missing_fields).toEqual([]);
    expect(payload.issues[1].missing_fields).toEqual(['Maintenance_Object']);
  });

  it('handles missing classification result for an issue gracefully', () => {
    const partial = CLASSIFICATION_RESULTS.filter(r => r.issue_id === 'issue-1');
    const payload = buildConfirmationPayload(SPLIT_ISSUES, partial);
    expect(payload.issues[1].needs_human_triage).toBe(true);
    expect(payload.issues[1].classification).toEqual({});
  });
});

describe('computeContentHash', () => {
  it('returns the same hash for identical input', () => {
    const hash1 = computeContentHash('hello world');
    const hash2 = computeContentHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different input', () => {
    const hash1 = computeContentHash('hello');
    const hash2 = computeContentHash('world');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a hex string', () => {
    const hash = computeContentHash('test');
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});

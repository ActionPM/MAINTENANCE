import { describe, it, expect } from 'vitest';
import {
  buildConfirmationPayload,
  computeContentHash,
  type ConfirmationPayload,
  type ConfirmationIssue,
  type DisplayField,
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
    shouldAskFollowup: false,
    followupTypes: {},
    constraintPassed: true,
    recoverable_via_followup: false,
  },
  {
    issue_id: 'issue-2',
    classifierOutput: {
      issue_id: 'issue-2',
      classification: { Category: 'maintenance', Maintenance_Category: 'general' },
      model_confidence: { Category: 0.7, Maintenance_Category: 0.5 },
      missing_fields: ['Maintenance_Object'],
      needs_human_triage: true,
    },
    computedConfidence: { Category: 0.72, Maintenance_Category: 0.55 },
    fieldsNeedingInput: [],
    shouldAskFollowup: false,
    followupTypes: {},
    constraintPassed: true,
    recoverable_via_followup: false,
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
    expect(first.classification).toEqual({
      Category: 'maintenance',
      Maintenance_Category: 'plumbing',
    });
    expect(first.confidence_by_field).toEqual({ Category: 0.92, Maintenance_Category: 0.85 });
  });

  it('flags issues that need human triage', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    expect(payload.issues[0].needs_human_triage).toBe(false);
    expect(payload.issues[1].needs_human_triage).toBe(true);
  });

  it('propagates recoverable_via_followup to confirmation issues', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    expect(payload.issues[0].recoverable_via_followup).toBe(false);
    expect(payload.issues[1].recoverable_via_followup).toBe(false);
  });

  it('includes missing fields from classifier output', () => {
    const payload = buildConfirmationPayload(SPLIT_ISSUES, CLASSIFICATION_RESULTS);
    expect(payload.issues[0].missing_fields).toEqual([]);
    expect(payload.issues[1].missing_fields).toEqual(['Maintenance_Object']);
  });

  it('handles missing classification result for an issue gracefully', () => {
    const partial = CLASSIFICATION_RESULTS.filter((r) => r.issue_id === 'issue-1');
    const payload = buildConfirmationPayload(SPLIT_ISSUES, partial);
    expect(payload.issues[1].needs_human_triage).toBe(true);
    expect(payload.issues[1].classification).toEqual({});
  });
});

const PEST_CONTROL_ISSUES: readonly SplitIssue[] = [
  {
    issue_id: 'issue-pest',
    summary: 'Cockroaches in kitchen',
    raw_excerpt: 'I keep seeing cockroaches in the kitchen',
  },
];

const PEST_CONTROL_RESULTS: readonly IssueClassificationResult[] = [
  {
    issue_id: 'issue-pest',
    classifierOutput: {
      issue_id: 'issue-pest',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'pest_control',
        Maintenance_Object: 'insect',
        Maintenance_Problem: 'infestation',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
        Priority: 'normal',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.9,
        Sub_Location: 0.9,
        Maintenance_Category: 0.95,
        Maintenance_Object: 0.9,
        Maintenance_Problem: 0.9,
        Management_Category: 0.0,
        Management_Object: 0.0,
        Priority: 0.85,
      },
      missing_fields: [],
      needs_human_triage: false,
    },
    computedConfidence: {
      Category: 0.95,
      Location: 0.9,
      Sub_Location: 0.9,
      Maintenance_Category: 0.95,
      Maintenance_Object: 0.9,
      Maintenance_Problem: 0.9,
      Management_Category: 0.0,
      Management_Object: 0.0,
      Priority: 0.85,
    },
    fieldsNeedingInput: [],
    shouldAskFollowup: false,
    followupTypes: {},
    constraintPassed: true,
    recoverable_via_followup: false,
  },
];

describe('display_fields in buildConfirmationPayload', () => {
  it('display_fields are ordered per TAXONOMY_FIELD_NAMES and exclude not_applicable', () => {
    const payload = buildConfirmationPayload(PEST_CONTROL_ISSUES, PEST_CONTROL_RESULTS);
    const issue = payload.issues[0];
    expect(issue.display_fields).toBeDefined();
    const fields = issue.display_fields!.map((df) => df.field);

    // Should include maintenance fields but NOT Management_Category or Management_Object
    expect(fields).toContain('Category');
    expect(fields).toContain('Location');
    expect(fields).toContain('Sub_Location');
    expect(fields).toContain('Maintenance_Category');
    expect(fields).toContain('Maintenance_Object');
    expect(fields).toContain('Maintenance_Problem');
    expect(fields).toContain('Priority');
    expect(fields).not.toContain('Management_Category');
    expect(fields).not.toContain('Management_Object');

    // Verify canonical order (Category < Location < Sub_Location < ... < Priority)
    const expectedOrder = [
      'Category',
      'Location',
      'Sub_Location',
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
      'Priority',
    ];
    expect(fields).toEqual(expectedOrder);
  });

  it('display_fields use human-readable field and value labels', () => {
    const payload = buildConfirmationPayload(PEST_CONTROL_ISSUES, PEST_CONTROL_RESULTS);
    const issue = payload.issues[0];
    const df = issue.display_fields!;

    const catField = df.find((d) => d.field === 'Category');
    expect(catField?.field_label).toBe('Category');
    expect(catField?.value_label).toBe('Maintenance');

    const maintCat = df.find((d) => d.field === 'Maintenance_Category');
    expect(maintCat?.field_label).toBe('Maintenance type');
    expect(maintCat?.value_label).toBe('Pest control');

    const subLoc = df.find((d) => d.field === 'Sub_Location');
    expect(subLoc?.field_label).toBe('Sub-location');
    expect(subLoc?.value_label).toBe('Kitchen');
  });

  it('classification record is preserved with not_applicable entries', () => {
    const payload = buildConfirmationPayload(PEST_CONTROL_ISSUES, PEST_CONTROL_RESULTS);
    const issue = payload.issues[0];

    // Classification still has not_applicable
    expect(issue.classification.Management_Category).toBe('not_applicable');
    expect(issue.classification.Management_Object).toBe('not_applicable');

    // But display_fields does not
    const dfFields = issue.display_fields!.map((d) => d.field);
    expect(dfFields).not.toContain('Management_Category');
    expect(dfFields).not.toContain('Management_Object');
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

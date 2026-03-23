import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  transpileRows,
  buildManifest,
  normalizeTaxonomyVersion,
} from '../../datasets/csv-transpiler.js';

const HEADER_ROW =
  'source_message_id,issue_text,conversation_text,Category,Location,Sub_Location,Maintenance_Category,Maintenance_Object,Maintenance_Problem,Management_Category,Management_Object,Priority,should_ask_followup,followup_type,taxonomy_version';

function makeCsv(dataRows: string[]): string {
  return ['Gold Set Title Row', HEADER_ROW, ...dataRows].join('\n');
}

describe('parseCsv', () => {
  it('skips title row and uses row 2 as headers', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,My toilet is leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_message_id).toBe('msg-001');
    expect(rows[0].Category).toBe('maintenance');
  });

  it('handles quoted fields with commas', () => {
    const csv = makeCsv([
      'msg-001,"Toilet, sink both leaking","My toilet, and also my sink, are leaking",maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].issue_text).toBe('Toilet, sink both leaking');
  });

  it('handles multiline quoted fields', () => {
    const csv = makeCsv([
      'msg-001,"Line one\nLine two",My toilet is leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].issue_text).toBe('Line one\nLine two');
  });

  it('throws for CSV with fewer than 3 rows', () => {
    expect(() => parseCsv('Title\nHeaders')).toThrow('at least a title row');
  });
});

describe('transpileRows — blank vs omitted key handling', () => {
  it('blank taxonomy cells become omitted keys', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,My toilet is leaking,maintenance,,,,,,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    const cls = examples[0].expected_classification_by_issue[0];

    expect(cls.Category).toBe('maintenance');
    expect(cls.Priority).toBe('normal');
    // Blank fields should be omitted (not present as empty strings)
    expect('Location' in cls).toBe(false);
    expect('Sub_Location' in cls).toBe(false);
    expect('Maintenance_Category' in cls).toBe(false);
  });

  it('not_applicable is preserved as literal string', () => {
    const csv = makeCsv([
      'msg-001,Rent question,Rent question,management,,,not_applicable,not_applicable,not_applicable,accounting,rent_receipt,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    const cls = examples[0].expected_classification_by_issue[0];

    expect(cls.Maintenance_Category).toBe('not_applicable');
    expect(cls.Maintenance_Object).toBe('not_applicable');
    expect(cls.Maintenance_Problem).toBe('not_applicable');
  });

  it('needs_object is preserved as literal string', () => {
    const csv = makeCsv([
      'msg-001,Plumbing issue,Something plumbing,maintenance,suite,bathroom,plumbing,needs_object,leak,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    const cls = examples[0].expected_classification_by_issue[0];

    expect(cls.Maintenance_Object).toBe('needs_object');
  });
});

describe('transpileRows — grouping by source_message_id', () => {
  it('groups rows with same source_message_id into one example', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,Two issues here,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
      'msg-001,Light broken,Two issues here,maintenance,suite,bedroom,electrical,light,not_working,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples).toHaveLength(1);
    expect(examples[0].split_issues_expected).toHaveLength(2);
    expect(examples[0].expected_classification_by_issue).toHaveLength(2);
    expect(examples[0].slice_tags).toContain('multi_issue');
  });

  it('creates separate examples for different source_message_ids', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,Toilet issue,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
      'msg-002,Light broken,Light issue,maintenance,suite,bedroom,electrical,light,not_working,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples).toHaveLength(2);
    expect(examples[0].split_issues_expected).toHaveLength(1);
    expect(examples[1].split_issues_expected).toHaveLength(1);
  });
});

describe('transpileRows — needs_object follow-up override (Decision 2)', () => {
  it('adds Maintenance_Object to expected_followup_fields when needs_object present', () => {
    const csv = makeCsv([
      'msg-001,Plumbing issue,Something plumbing,maintenance,suite,,plumbing,needs_object,leak,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_followup_fields).toContain('Maintenance_Object');
  });

  it('adds Management_Object to expected_followup_fields when needs_object present', () => {
    const csv = makeCsv([
      'msg-001,Mgmt issue,Some management issue,management,,,,,,,needs_object,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_followup_fields).toContain('Management_Object');
  });

  it('overrides CSV should_ask_followup=false when needs_object is present', () => {
    const csv = makeCsv([
      'msg-001,Plumbing issue,Something plumbing,maintenance,suite,,plumbing,needs_object,leak,,,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    // Even though should_ask_followup=false, needs_object triggers follow-up
    expect(examples[0].expected_followup_fields).toContain('Maintenance_Object');
  });
});

describe('transpileRows — expected_needs_human_triage', () => {
  it('sets expected_needs_human_triage to false for all rows', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,My toilet,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
      'msg-002,Rent question,My rent,management,,,,,,,rent_receipt,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    for (const ex of examples) {
      expect(ex.expected_needs_human_triage).toBe(false);
    }
  });
});

describe('normalizeTaxonomyVersion', () => {
  it('converts "1" to "1.0.0"', () => {
    expect(normalizeTaxonomyVersion('1')).toBe('1.0.0');
  });

  it('converts "1.0" to "1.0.0"', () => {
    expect(normalizeTaxonomyVersion('1.0')).toBe('1.0.0');
  });

  it('keeps "1.0.0" as-is', () => {
    expect(normalizeTaxonomyVersion('1.0.0')).toBe('1.0.0');
  });

  it('throws for non-numeric version', () => {
    expect(() => normalizeTaxonomyVersion('abc')).toThrow('Cannot normalize');
  });
});

describe('transpileRows — slice tags', () => {
  it('includes Category, Maintenance_Category, Priority in slice tags', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,My toilet,maintenance,suite,bathroom,plumbing,toilet,leak,,,high,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].slice_tags).toContain('gold');
    expect(examples[0].slice_tags).toContain('maintenance');
    expect(examples[0].slice_tags).toContain('plumbing');
    expect(examples[0].slice_tags).toContain('high');
  });
});

describe('buildManifest', () => {
  it('produces valid manifest with slice coverage', () => {
    const csv = makeCsv([
      'msg-001,Toilet leaking,My toilet,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0',
      'msg-002,Rent question,My rent,management,,,,,,,rent_receipt,normal,false,,1.0.0',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    const manifest = buildManifest(examples);

    expect(manifest.manifest_id).toBe('gold-v1');
    expect(manifest.dataset_type).toBe('gold');
    expect(manifest.example_count).toBe(2);
    expect(manifest.policy_overrides).toHaveLength(2);
    expect(manifest.slice_coverage['maintenance']).toBe(1);
    expect(manifest.slice_coverage['management']).toBe(1);
  });
});

describe('transpileRows — eval-only columns discarded', () => {
  it('does not include gold_rationale in output', () => {
    const headerWithExtra = HEADER_ROW + ',gold_rationale,evidence_notes';
    const csv = [
      'Gold Set Title Row',
      headerWithExtra,
      'msg-001,Toilet leaking,My toilet,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,Some rationale,Some evidence',
    ].join('\n');
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    // The example should not contain eval-only columns
    const json = JSON.stringify(examples[0]);
    expect(json).not.toContain('gold_rationale');
    expect(json).not.toContain('evidence_notes');
  });
});

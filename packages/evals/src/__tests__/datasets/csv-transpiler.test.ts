import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  transpileRows,
  buildManifest,
  normalizeTaxonomyVersion,
} from '../../datasets/csv-transpiler.js';

const HEADER_ROW =
  'record_id,source_message_id,raw_intake,atomic_issue,Category,Location,Sub_Location,Maintenance_Category,Maintenance_Object,Maintenance_Problem,Management_Category,Management_Object,Priority,should_ask_followup,followup_type,taxonomy_version,emergency,safety_flag';

function makeCsv(dataRows: string[]): string {
  return ['Gold Set Title Row', HEADER_ROW, ...dataRows].join('\n');
}

describe('parseCsv', () => {
  it('skips title row and uses row 2 as headers', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet is leaking,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_message_id).toBe('msg-001');
    expect(rows[0].Category).toBe('maintenance');
  });

  it('handles quoted fields with commas', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,"My toilet, and also my sink, are leaking","Toilet, sink both leaking",maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].atomic_issue).toBe('Toilet, sink both leaking');
  });

  it('handles multiline quoted fields', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet is leaking,"Line one\nLine two",maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].atomic_issue).toBe('Line one\nLine two');
  });

  it('throws for CSV with fewer than 3 rows', () => {
    expect(() => parseCsv('Title\nHeaders')).toThrow('at least a title row');
  });
});

describe('transpileRows — column mapping', () => {
  it('maps raw_intake to conversation_text', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet is leaking,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    expect(examples[0].conversation_text).toBe('My toilet is leaking');
  });

  it('maps atomic_issue to issue_text in split_issues_expected', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet is leaking,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    expect(examples[0].split_issues_expected[0].issue_text).toBe('Toilet leaking');
  });

  it('derives example_id from source_message_id', () => {
    const csv = makeCsv([
      'GCS-0001,SR-1018,My toilet is leaking,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    expect(examples[0].example_id).toBe('gold-v1-SR-1018');
  });

  it('record_id does not appear in output', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet is leaking,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    const json = JSON.stringify(examples[0]);
    expect(json).not.toContain('GCS-0001');
    expect(json).not.toContain('record_id');
  });
});

describe('transpileRows — blank vs omitted key handling', () => {
  it('blank taxonomy cells become omitted keys', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet is leaking,Toilet leaking,maintenance,,,,,,,,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,Rent question,Rent question,management,,,not_applicable,not_applicable,not_applicable,accounting,rent_receipt,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,Something plumbing,Plumbing issue,maintenance,suite,bathroom,plumbing,needs_object,leak,,,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,Two issues here,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
      'GCS-0002,msg-001,Two issues here,Light broken,maintenance,suite,bedroom,electrical,light,not_working,,,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,Toilet issue,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
      'GCS-0002,msg-002,Light issue,Light broken,maintenance,suite,bedroom,electrical,light,not_working,,,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,Something plumbing,Plumbing issue,maintenance,suite,,plumbing,needs_object,leak,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_followup_fields).toContain('Maintenance_Object');
  });

  it('adds Management_Object to expected_followup_fields when needs_object present', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Some management issue,Mgmt issue,management,,,,,,,needs_object,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_followup_fields).toContain('Management_Object');
  });

  it('overrides CSV should_ask_followup=false when needs_object is present', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Something plumbing,Plumbing issue,maintenance,suite,,plumbing,needs_object,leak,,,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,My toilet,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
      'GCS-0002,msg-002,My rent,Rent question,management,,,,,,,rent_receipt,normal,false,,1.0.0,no,no',
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

  it('maps maintenance_taxonomy_v1 to 1.0.0', () => {
    expect(normalizeTaxonomyVersion('maintenance_taxonomy_v1')).toBe('1.0.0');
  });
});

describe('transpileRows — other_issue normalization (Task C)', () => {
  it('maps other_issue to other_maintenance_category', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Mold on wall,Mold issue,maintenance,suite,bathroom,other_issue,,,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);
    const cls = examples[0].expected_classification_by_issue[0];

    expect(cls.Maintenance_Category).toBe('other_maintenance_category');
  });
});

describe('transpileRows — expected_risk_flags (Task D)', () => {
  it('populates emergency flag when emergency=yes', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Water flooding,Water flood,maintenance,suite,bathroom,plumbing,pipe,burst,,,high,false,,1.0.0,yes,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_risk_flags).toEqual(['emergency']);
  });

  it('populates safety flag when safety_flag=yes', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Exposed wire,Exposed wire,maintenance,suite,bedroom,electrical,wire,exposed,,,high,false,,1.0.0,no,yes',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_risk_flags).toEqual(['safety']);
  });

  it('populates both flags when both are yes', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Gas leak,Gas leak,maintenance,suite,kitchen,plumbing,pipe,leak,,,high,false,,1.0.0,yes,yes',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_risk_flags).toEqual(['emergency', 'safety']);
  });

  it('returns empty array when both are no', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Drip,Drip,maintenance,suite,bathroom,plumbing,faucet,drip,,,normal,false,,1.0.0,no,no',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_risk_flags).toEqual([]);
  });

  it('merges risk flags across multi-issue group', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,Two issues,Water flood,maintenance,suite,bathroom,plumbing,pipe,burst,,,high,false,,1.0.0,yes,no',
      'GCS-0002,msg-001,Two issues,Exposed wire,maintenance,suite,bedroom,electrical,wire,exposed,,,high,false,,1.0.0,no,yes',
    ]);
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    expect(examples[0].expected_risk_flags).toEqual(['emergency', 'safety']);
  });
});

describe('transpileRows — slice tags', () => {
  it('includes Category, Maintenance_Category, Priority in slice tags', () => {
    const csv = makeCsv([
      'GCS-0001,msg-001,My toilet,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,high,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,My toilet,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no',
      'GCS-0002,msg-002,My rent,Rent question,management,,,,,,,rent_receipt,normal,false,,1.0.0,no,no',
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
      'GCS-0001,msg-001,My toilet,Toilet leaking,maintenance,suite,bathroom,plumbing,toilet,leak,,,normal,false,,1.0.0,no,no,Some rationale,Some evidence',
    ].join('\n');
    const rows = parseCsv(csv);
    const examples = transpileRows(rows);

    // The example should not contain eval-only columns
    const json = JSON.stringify(examples[0]);
    expect(json).not.toContain('gold_rationale');
    expect(json).not.toContain('evidence_notes');
  });
});

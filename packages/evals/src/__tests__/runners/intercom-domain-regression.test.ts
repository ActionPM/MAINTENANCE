import { describe, it, expect } from 'vitest';
import { runIssueReplay } from '../../runners/issue-replay.js';
import { FixtureClassifierAdapter } from '../../runners/classifier-adapters.js';

/**
 * reg-007 regression: intercom classified as maintenance/electrical/intercom.
 * "intercom" is NOT a valid Maintenance_Object in the taxonomy.
 * The correct domain is management/general/intercom.
 *
 * These tests validate at the issue-replay pipeline level (taxonomy validation,
 * constraint checking, cross-domain normalization) — the actual failing layer.
 */
describe('reg-007: intercom domain regression', () => {
  const CORRECT_FIXTURE = {
    classification: {
      Category: 'management',
      Management_Category: 'general',
      Management_Object: 'intercom',
      Maintenance_Category: 'not_applicable',
      Maintenance_Object: 'not_applicable',
      Maintenance_Problem: 'not_applicable',
      Priority: 'normal',
    },
    model_confidence: {
      Category: 0.85,
      Management_Category: 0.8,
      Management_Object: 0.9,
      Maintenance_Category: 0.9,
      Maintenance_Object: 0.9,
      Maintenance_Problem: 0.9,
      Priority: 0.7,
    },
    missing_fields: [] as string[],
    needs_human_triage: false,
  };

  const INCORRECT_FIXTURE = {
    classification: {
      Category: 'maintenance',
      Location: 'building_interior',
      Sub_Location: 'entrance_lobby',
      Maintenance_Category: 'electrical',
      Maintenance_Object: 'intercom', // NOT a valid Maintenance_Object
      Maintenance_Problem: 'not_working',
      Management_Category: 'not_applicable',
      Management_Object: 'not_applicable',
      Priority: 'normal',
    },
    model_confidence: {
      Category: 0.7,
      Location: 0.6,
      Sub_Location: 0.5,
      Maintenance_Category: 0.7,
      Maintenance_Object: 0.6,
      Maintenance_Problem: 0.7,
      Management_Category: 0.9,
      Management_Object: 0.9,
      Priority: 0.7,
    },
    missing_fields: [] as string[],
    needs_human_triage: false,
  };

  it('correct management/general/intercom classification succeeds', async () => {
    const adapter = new FixtureClassifierAdapter({
      'reg-007-issue-0': CORRECT_FIXTURE,
    });

    const result = await runIssueReplay({
      example_id: 'reg-007',
      issue_index: 0,
      issue_text: "The intercom at the front door isn't working",
      expected_classification: CORRECT_FIXTURE.classification,
      classifierAdapter: adapter,
      taxonomyVersion: '1.0.0',
    });

    expect(result.status).toBe('ok');
    expect(result.hierarchyValid).toBe(true);
    expect(result.classification?.Management_Object).toBe('intercom');
  });

  it('paraphrase: buzzer at entrance produces same outcome', async () => {
    const adapter = new FixtureClassifierAdapter({
      'reg-007-issue-0': CORRECT_FIXTURE,
    });

    const result = await runIssueReplay({
      example_id: 'reg-007',
      issue_index: 0,
      issue_text: "The buzzer at the front entrance doesn't ring",
      expected_classification: CORRECT_FIXTURE.classification,
      classifierAdapter: adapter,
      taxonomyVersion: '1.0.0',
    });

    expect(result.status).toBe('ok');
    expect(result.hierarchyValid).toBe(true);
  });

  it('regression guard: maintenance/electrical/intercom is rejected as taxonomy_fail', async () => {
    const adapter = new FixtureClassifierAdapter({
      'reg-007-issue-0': INCORRECT_FIXTURE,
    });

    const result = await runIssueReplay({
      example_id: 'reg-007',
      issue_index: 0,
      issue_text: "The intercom at the front door isn't working",
      expected_classification: INCORRECT_FIXTURE.classification,
      classifierAdapter: adapter,
      taxonomyVersion: '1.0.0',
    });

    // The pipeline should catch intercom as an invalid Maintenance_Object
    expect(result.status).toBe('taxonomy_fail');
    expect(result.hierarchyValid).toBe(false);
  });
});

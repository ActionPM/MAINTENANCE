import { describe, it, expect } from 'vitest';
import { runIssueReplay } from '../../runners/issue-replay.js';
import { FixtureClassifierAdapter } from '../../runners/classifier-adapters.js';

describe('runIssueReplay', () => {
  it('returns structured results for a single issue', async () => {
    const adapter = new FixtureClassifierAdapter({
      'gold-001-issue-0': {
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
        },
        model_confidence: {
          Category: 0.92,
          Location: 0.88,
          Sub_Location: 0.85,
          Maintenance_Category: 0.90,
          Maintenance_Object: 0.85,
          Maintenance_Problem: 0.90,
        },
        missing_fields: [],
        needs_human_triage: false,
      },
    });

    const result = await runIssueReplay({
      example_id: 'gold-001',
      issue_index: 0,
      issue_text: 'My toilet is leaking water onto the bathroom floor.',
      expected_classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
      },
      classifierAdapter: adapter,
      taxonomyVersion: '2.0.0',
    });

    expect(result.status).toBe('ok');
    expect(result.classification).toBeDefined();
    expect(result.confidenceByField).toBeDefined();
    expect(result.fieldsNeedingInput).toBeDefined();
    expect(result.hierarchyValid).toBe(true);
  });

  it('returns needs_human_triage when classifier flags it', async () => {
    const adapter = new FixtureClassifierAdapter({
      'triage-001-issue-0': {
        classification: { Category: 'unknown' },
        model_confidence: { Category: 0.3 },
        missing_fields: [],
        needs_human_triage: true,
      },
    });

    const result = await runIssueReplay({
      example_id: 'triage-001',
      issue_index: 0,
      issue_text: 'asdf qwerty gibberish',
      expected_classification: { Category: 'unknown' },
      classifierAdapter: adapter,
      taxonomyVersion: '2.0.0',
    });

    expect(result.status).toBe('needs_human_triage');
  });
});

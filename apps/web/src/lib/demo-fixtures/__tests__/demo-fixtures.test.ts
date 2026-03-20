import { describe, it, expect } from 'vitest';
import {
  loadTaxonomy,
  taxonomyConstraints,
  validateHierarchicalConstraints,
} from '@wo-agent/schemas';
import type {
  IssueSplitterInput,
  IssueClassifierInput,
  FollowUpGeneratorInput,
} from '@wo-agent/schemas';
import { createDemoSplitter } from '../demo-splitter.js';
import { createDemoClassifier } from '../demo-classifier.js';
import { createDemoFollowupGenerator } from '../demo-followup-generator.js';

const taxonomy = loadTaxonomy();
const taxonomyVersion = '1.0.0';

function makeSplitterInput(text: string): IssueSplitterInput {
  return {
    raw_text: text,
    conversation_id: 'test-conv',
    taxonomy_version: taxonomyVersion,
    model_id: 'demo-fixture',
    prompt_version: '1.0.0',
  };
}

function makeClassifierInput(
  issueId: string,
  summary: string,
  rawExcerpt: string,
): IssueClassifierInput {
  return {
    issue_id: issueId,
    issue_summary: summary,
    raw_excerpt: rawExcerpt,
    taxonomy_version: taxonomyVersion,
    model_id: 'demo-fixture',
    prompt_version: '1.0.0',
  };
}

function makeFollowupInput(fieldsNeedingInput: string[]): FollowUpGeneratorInput {
  return {
    issue_id: 'test-issue',
    classification: {},
    confidence_by_field: {},
    missing_fields: [],
    fields_needing_input: fieldsNeedingInput,
    previous_questions: [],
    turn_number: 1,
    total_questions_asked: 0,
    taxonomy_version: taxonomyVersion,
    prompt_version: '1.0.0',
  };
}

// ---------------------------------------------------------------------------
// Demo Splitter
// ---------------------------------------------------------------------------
describe('createDemoSplitter', () => {
  const split = createDemoSplitter();

  it('returns 3 issues for multi-issue text (faucet + light + cockroach)', async () => {
    const result = await split(
      makeSplitterInput(
        'The kitchen faucet is leaking. The hallway light is flickering. I saw a cockroach in the bathroom.',
      ),
    );
    expect(result.issue_count).toBe(3);
    expect(result.issues).toHaveLength(3);
    const summaries = result.issues.map((i) => i.summary);
    expect(summaries[0]).toContain('faucet');
    expect(summaries[1]).toContain('light');
    expect(summaries[2].toLowerCase()).toContain('cockroach');
  });

  it('returns 1 issue for emergency text (flooding)', async () => {
    const result = await split(
      makeSplitterInput('Water is flooding from the pipe under the kitchen sink!'),
    );
    expect(result.issue_count).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].summary.toLowerCase()).toContain('flood');
  });

  it('returns 1 issue for default text', async () => {
    const result = await split(makeSplitterInput('My door handle is broken'));
    expect(result.issue_count).toBe(1);
    expect(result.issues).toHaveLength(1);
  });

  it('generates unique issue_ids', async () => {
    const result = await split(
      makeSplitterInput(
        'Faucet leaking. Light flickering. Cockroach in bathroom.',
      ),
    );
    const ids = result.issues.map((i) => i.issue_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Demo Classifier — taxonomy validity
// ---------------------------------------------------------------------------
describe('createDemoClassifier — taxonomy validity', () => {
  const classify = createDemoClassifier();

  const SCENARIOS: Array<{ name: string; summary: string; excerpt: string }> = [
    {
      name: 'faucet/plumbing',
      summary: 'Kitchen faucet is leaking with water pooling under the sink',
      excerpt: 'The kitchen faucet is leaking.',
    },
    {
      name: 'light/electrical',
      summary: 'Hallway light near front door is flickering on and off',
      excerpt: 'The hallway light has been flickering.',
    },
    {
      name: 'cockroach/pest',
      summary: 'Cockroach sighting in the bathroom',
      excerpt: 'I saw a cockroach in the bathroom.',
    },
    {
      name: 'hvac/heat',
      summary: 'No heat in the apartment',
      excerpt: "I haven't had heat in over a week.",
    },
    {
      name: 'toilet/plumbing',
      summary: 'Toilet is clogged',
      excerpt: 'My toilet is clogged and overflowing.',
    },
    {
      name: 'appliance',
      summary: 'Fridge stopped working',
      excerpt: 'My fridge is not working, food is spoiling.',
    },
    {
      name: 'carpentry/door',
      summary: 'Broken door handle',
      excerpt: 'My front door handle is broken.',
    },
    {
      name: 'default',
      summary: 'Something is wrong in my unit',
      excerpt: 'I need help with something in my apartment.',
    },
  ];

  for (const scenario of SCENARIOS) {
    describe(`scenario: ${scenario.name}`, () => {
      it('returns values that exist in taxonomy.json', async () => {
        const result = await classify(
          makeClassifierInput('issue-1', scenario.summary, scenario.excerpt),
        );
        for (const [field, value] of Object.entries(result.classification)) {
          const validValues = (taxonomy as unknown as Record<string, readonly string[]>)[field];
          expect(validValues, `field ${field} not found in taxonomy`).toBeDefined();
          expect(validValues).toContain(value);
        }
      });

      it('passes hierarchical constraint validation', async () => {
        const result = await classify(
          makeClassifierInput('issue-1', scenario.summary, scenario.excerpt),
        );
        const hierarchyResult = validateHierarchicalConstraints(
          result.classification,
          taxonomyConstraints,
          taxonomyVersion,
        );
        expect(hierarchyResult.valid).toBe(true);
      });

      it('has correct category gating (maintenance → management fields not_applicable)', async () => {
        const result = await classify(
          makeClassifierInput('issue-1', scenario.summary, scenario.excerpt),
        );
        if (result.classification.Category === 'maintenance') {
          expect(result.classification.Management_Category).toBe('not_applicable');
          expect(result.classification.Management_Object).toBe('not_applicable');
        }
      });

      it('returns needs_human_triage=false', async () => {
        const result = await classify(
          makeClassifierInput('issue-1', scenario.summary, scenario.excerpt),
        );
        expect(result.needs_human_triage).toBe(false);
      });

      it('returns empty missing_fields', async () => {
        const result = await classify(
          makeClassifierInput('issue-1', scenario.summary, scenario.excerpt),
        );
        expect(result.missing_fields).toEqual([]);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Demo Classifier — confidence targeting
// ---------------------------------------------------------------------------
describe('createDemoClassifier — confidence targeting', () => {
  const classify = createDemoClassifier();

  it('faucet issue: all confidence values >= 0.7', async () => {
    const result = await classify(
      makeClassifierInput(
        'issue-1',
        'Kitchen faucet is leaking',
        'The kitchen faucet is leaking.',
      ),
    );
    for (const [field, conf] of Object.entries(result.model_confidence)) {
      // Management fields are gated to 0.0 for maintenance — skip those
      if (field === 'Management_Category' || field === 'Management_Object') continue;
      expect(conf, `${field} confidence should be >= 0.7`).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('light issue: Location < 0.7 AND Sub_Location < 0.7', async () => {
    const result = await classify(
      makeClassifierInput(
        'issue-1',
        'Hallway light near front door is flickering',
        'The hallway light has been flickering.',
      ),
    );
    expect(result.model_confidence.Location).toBeLessThan(0.7);
    expect(result.model_confidence.Sub_Location).toBeLessThan(0.7);
  });

  it('cockroach issue: Sub_Location < 0.7', async () => {
    const result = await classify(
      makeClassifierInput(
        'issue-1',
        'Cockroach sighting in the bathroom',
        'I saw a cockroach in the bathroom.',
      ),
    );
    expect(result.model_confidence.Sub_Location).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// Demo Followup Generator
// ---------------------------------------------------------------------------
describe('createDemoFollowupGenerator', () => {
  const generate = createDemoFollowupGenerator();

  it('returns questions for Location field with valid enum options', async () => {
    const result = await generate(makeFollowupInput(['Location']));
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0];
    expect(q.field_target).toBe('Location');
    expect(q.answer_type).toBe('enum');
    for (const option of q.options) {
      expect(taxonomy.Location).toContain(option);
    }
  });

  it('returns questions for Sub_Location field with valid options', async () => {
    const result = await generate(makeFollowupInput(['Sub_Location']));
    expect(result.questions).toHaveLength(1);
    const q = result.questions[0];
    expect(q.field_target).toBe('Sub_Location');
    expect(q.answer_type).toBe('enum');
    for (const option of q.options) {
      expect(taxonomy.Sub_Location).toContain(option);
    }
  });

  it('returns multiple questions for multiple fields', async () => {
    const result = await generate(makeFollowupInput(['Location', 'Sub_Location']));
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].field_target).toBe('Location');
    expect(result.questions[1].field_target).toBe('Sub_Location');
  });

  it('returns empty questions array when no fields need input', async () => {
    const result = await generate(makeFollowupInput([]));
    expect(result.questions).toEqual([]);
  });

  it('generates unique question_ids', async () => {
    const result = await generate(
      makeFollowupInput(['Location', 'Sub_Location', 'Priority']),
    );
    const ids = result.questions.map((q) => q.question_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

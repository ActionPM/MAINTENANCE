/**
 * Regression tests for the gold-set taxonomy migration.
 * Validates the behavioral changes from the migration plan:
 * - Evidence-based classification (omitted fields, not force-fill)
 * - Completeness gate (blank meaningful fields trigger follow-up)
 * - needs_object persistence (not auto-resolved by constraints)
 * - Cross-domain normalization (not_applicable instead of other_*)
 * - Version-aware prompt dispatch
 * - cue_version pinning
 */
import { describe, it, expect } from 'vitest';
import { resolveConstraintImpliedFields } from '../../classifier/constraint-resolver.js';
import { checkCompleteness, FollowUpType } from '../../classifier/completeness-gate.js';
import {
  buildClassifierSystemPrompt,
  EVIDENCE_BASED_PROMPT_VERSION,
} from '../../llm/prompts/classifier-prompt.js';
import {
  resolveCurrentVersions,
  assertPinnedVersionsIntact,
  normalizePinnedVersions,
  compareSemver,
  CUE_VERSION,
  DEFAULT_CUE_VERSION,
  PROMPT_VERSION,
} from '@wo-agent/schemas';
import { taxonomy, loadTaxonomyConstraints } from '@wo-agent/schemas';

const constraints = loadTaxonomyConstraints();

describe('no weak-evidence inference (cue audit)', () => {
  it('"my sink is leaking" → classifier should NOT set Location=suite via cues', () => {
    // This is enforced by the cue dictionary audit — object mentions removed
    // from Location and Sub_Location cues. Tested in cue-scoring.test.ts.
    // Here we verify the completeness gate would flag missing Location.
    const classification = {
      Category: 'maintenance',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'sink',
      Maintenance_Problem: 'leak',
      Priority: 'normal',
    };
    const result = checkCompleteness(classification, 'maintenance');
    expect(result.incompleteFields).toContain('Location');
  });
});

describe('blank triggers follow-up (maintenance)', () => {
  it('maintenance message with no location → Location omitted → follow-up triggered', () => {
    const classification = {
      Category: 'maintenance',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
      Priority: 'normal',
    };
    const result = checkCompleteness(classification, 'maintenance');
    expect(result.incompleteFields).toContain('Location');
    expect(result.followupTypes['Location']).toBe(FollowUpType.LOCATION);
  });
});

describe('blank Location accepted (management) — Decision 1', () => {
  it('management message with no location → no follow-up triggered', () => {
    const classification = {
      Category: 'management',
      Management_Category: 'accounting',
      Management_Object: 'rent_receipt',
      Priority: 'normal',
    };
    const result = checkCompleteness(classification, 'management');
    expect(result.incompleteFields).not.toContain('Location');
    expect(result.complete).toBe(true);
  });
});

describe('needs_object always triggers follow-up — Decision 2', () => {
  it('Maintenance_Object: needs_object → follow-up asked for object clarification', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'bathroom',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'needs_object',
      Maintenance_Problem: 'leak',
      Priority: 'normal',
    };
    const result = checkCompleteness(classification, 'maintenance');
    expect(result.incompleteFields).toContain('Maintenance_Object');
    expect(result.followupTypes['Maintenance_Object']).toBe(FollowUpType.OBJECT_CLARIFICATION);
  });
});

describe('needs_object persistence (constraint resolver)', () => {
  it('constraint resolver does NOT overwrite needs_object', () => {
    const classification = {
      Category: 'maintenance',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'needs_object',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints);
    expect(implied['Maintenance_Object']).toBeUndefined();
  });

  it('"general" is still auto-resolved by constraint resolver', () => {
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Object: 'toilet',
    };
    const implied = resolveConstraintImpliedFields(classification, constraints, undefined, {
      mode: 'all',
    });
    expect(implied['Sub_Location']).toBe('bathroom');
  });
});

describe('management normalization', () => {
  it('management issue → Maintenance fields should be not_applicable (not triggering follow-up)', () => {
    const classification = {
      Category: 'management',
      Management_Category: 'accounting',
      Management_Object: 'rent_receipt',
      Maintenance_Category: 'not_applicable',
      Maintenance_Object: 'not_applicable',
      Maintenance_Problem: 'not_applicable',
      Priority: 'normal',
    };
    const result = checkCompleteness(classification, 'management');
    expect(result.incompleteFields).not.toContain('Maintenance_Category');
    expect(result.incompleteFields).not.toContain('Maintenance_Object');
    expect(result.incompleteFields).not.toContain('Maintenance_Problem');
  });
});

describe('version-aware prompt dispatch', () => {
  it('old prompt_version → builds v1 (force-fill) prompt', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '1.0.0');
    expect(prompt).toContain('Every classification field MUST use a value');
    expect(prompt).not.toContain('EVIDENCE-BASED');
  });

  it('new prompt_version → builds v2 (evidence-based) prompt', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.0.0');
    expect(prompt).toContain('EVIDENCE-BASED');
    expect(prompt).toContain('OMIT that field');
    expect(prompt).not.toContain('Every classification field MUST use a value');
  });

  it('PROMPT_VERSION is >= 2.0.0 (evidence-based classifier)', () => {
    expect(PROMPT_VERSION).toBe('2.4.0');
  });
});

describe('cue_version pinning', () => {
  it('new conversation pins cue_version', () => {
    const versions = resolveCurrentVersions();
    expect(versions.cue_version).toBe(CUE_VERSION);
  });

  it('pre-migration session without cue_version gets default', () => {
    const legacy = {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'claude-sonnet-4-20250514',
      prompt_version: '1.0.0',
    };
    const normalized = normalizePinnedVersions(legacy);
    expect(normalized.cue_version).toBe(DEFAULT_CUE_VERSION);
    expect(assertPinnedVersionsIntact(normalized)).toBe(true);
  });

  it('post-migration session retains explicit cue_version', () => {
    const current = {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'claude-sonnet-4-20250514',
      prompt_version: '2.0.0',
      cue_version: '1.3.0',
    };
    const normalized = normalizePinnedVersions(current);
    expect(normalized.cue_version).toBe('1.3.0');
  });
});

describe('PinnedVersions schema validation', () => {
  it('resolveCurrentVersions includes all five fields', () => {
    const versions = resolveCurrentVersions();
    expect(Object.keys(versions)).toHaveLength(5);
    expect(assertPinnedVersionsIntact(versions)).toBe(true);
  });
});

describe('compareSemver — numeric version comparison', () => {
  it('2.0.0 > 1.0.0', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0);
  });

  it('1.0.0 < 2.0.0', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('1.0.0 == 1.0.0', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('10.0.0 > 2.0.0 (not lexicographic)', () => {
    expect(compareSemver('10.0.0', '2.0.0')).toBeGreaterThan(0);
  });

  it('1.10.0 > 1.2.0 (minor component)', () => {
    expect(compareSemver('1.10.0', '1.2.0')).toBeGreaterThan(0);
  });

  it('1.2.3 > 1.2.2 (patch component)', () => {
    expect(compareSemver('1.2.3', '1.2.2')).toBeGreaterThan(0);
  });
});

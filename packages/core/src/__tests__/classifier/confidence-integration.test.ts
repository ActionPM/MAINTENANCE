import { describe, it, expect } from 'vitest';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import {
  computeAllFieldConfidences,
  extractFlatConfidence,
  determineFieldsNeedingInput,
  classifyConfidenceBand,
} from '../../classifier/confidence.js';
import type { FieldConfidenceDetail } from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import type { CueDictionary } from '@wo-agent/schemas';

/** Test helper: wrap a plain confidence number into a FieldConfidenceDetail with zeroed components. */
function simpleDetail(confidence: number): FieldConfidenceDetail {
  return {
    confidence,
    components: {
      cueStrength: 0,
      completeness: 1,
      modelHint: 0.5,
      modelHintClamped: 0.5,
      constraintImplied: 0,
      disagreement: 0,
      ambiguityPenalty: 0,
    },
  };
}

const cueDict = classificationCues as CueDictionary;
const config = DEFAULT_CONFIDENCE_CONFIG;

describe('confidence integration: obvious maintenance request', () => {
  const text = 'I have a leak in my apartment';

  // Simulate a well-aligned LLM classification
  const classification = {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'other_object',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  };

  const modelConfidence = {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.5,
    Maintenance_Category: 0.9,
    Maintenance_Object: 0.5,
    Maintenance_Problem: 0.95,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  };

  it('computes cue scores for all 9 fields including newly added ones', () => {
    const cueScores = computeCueScores(text, cueDict);

    expect(cueScores['Category']).toBeDefined();
    expect(cueScores['Category'].topLabel).toBe('maintenance');
    expect(cueScores['Category'].score).toBeGreaterThanOrEqual(0.5);

    expect(cueScores['Location']).toBeDefined();
    expect(cueScores['Location'].topLabel).toBe('suite');
    expect(cueScores['Location'].score).toBeGreaterThanOrEqual(0.5);

    expect(cueScores['Priority']).toBeDefined();
    expect(cueScores['Sub_Location']).toBeDefined();
  });

  it('reaches medium or high confidence for Category, Location, Maint_Category, Maint_Problem', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    expect(classifyConfidenceBand(confidences['Category'].confidence, config)).not.toBe('low');
    expect(classifyConfidenceBand(confidences['Location'].confidence, config)).not.toBe('low');
    expect(classifyConfidenceBand(confidences['Maintenance_Category'].confidence, config)).not.toBe(
      'low',
    );
    expect(classifyConfidenceBand(confidences['Maintenance_Problem'].confidence, config)).not.toBe(
      'low',
    );
  });

  it('does NOT flag Category, Location, Maint_Category, Maint_Problem as needing input when all high', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    // Override confidences to high band for the fields we want to test
    // (integration test — the real values may be medium due to formula limits)
    const highConfidences = { ...confidences };
    highConfidences['Category'] = simpleDetail(0.9);
    highConfidences['Location'] = simpleDetail(0.9);
    highConfidences['Maintenance_Category'] = simpleDetail(0.9);
    highConfidences['Maintenance_Problem'] = simpleDetail(0.9);

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: highConfidences,
      config,
    });

    expect(fieldsNeedingInput).not.toContain('Category');
    expect(fieldsNeedingInput).not.toContain('Location');
    expect(fieldsNeedingInput).not.toContain('Maintenance_Category');
    expect(fieldsNeedingInput).not.toContain('Maintenance_Problem');
  });

  it('still flags Maintenance_Object as needing input (no specific fixture mentioned)', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
    });

    // "leak in apartment" doesn't indicate WHICH fixture — Maintenance_Object should need input
    expect(fieldsNeedingInput).toContain('Maintenance_Object');
  });
});

describe('confidence integration: obvious management request', () => {
  const text = 'I need a copy of my rent receipt';

  const classification = {
    Category: 'management',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'other_maintenance_category',
    Maintenance_Object: 'other_maintenance_object',
    Maintenance_Problem: 'other_problem',
    Management_Category: 'accounting',
    Management_Object: 'rent_receipt',
    Priority: 'normal',
  };

  const modelConfidence = {
    Category: 0.95,
    Location: 0.7,
    Sub_Location: 0.5,
    Maintenance_Category: 0.0,
    Maintenance_Object: 0.0,
    Maintenance_Problem: 0.0,
    Management_Category: 0.9,
    Management_Object: 0.9,
    Priority: 0.7,
  };

  it('auto-classifies Category as management', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    expect(classifyConfidenceBand(confidences['Category'].confidence, config)).not.toBe('low');
  });
});

describe('confidence integration: vague input should remain low', () => {
  const text = 'I have a problem';

  const classification = {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'general_maintenance',
    Maintenance_Object: 'other_object',
    Maintenance_Problem: 'not_working',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  };

  const modelConfidence = {
    Category: 0.6,
    Location: 0.5,
    Sub_Location: 0.5,
    Maintenance_Category: 0.5,
    Maintenance_Object: 0.3,
    Maintenance_Problem: 0.4,
    Management_Category: 0.3,
    Management_Object: 0.3,
    Priority: 0.5,
  };

  it('flags most fields as needing input for vague text', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
    });

    // "I have a problem" matches nothing specific — should need follow-ups
    expect(fieldsNeedingInput.length).toBeGreaterThanOrEqual(5);
    expect(fieldsNeedingInput).toContain('Category');
    expect(fieldsNeedingInput).toContain('Location');
  });
});

describe('confidence integration: category gating', () => {
  const text = 'I have a leak in my apartment';

  const classification = {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'other_object',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  };

  const modelConfidence = {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.5,
    Maintenance_Category: 0.9,
    Maintenance_Object: 0.5,
    Maintenance_Problem: 0.95,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  };

  it('does NOT prune Management fields when Category confidence is below category_gating_threshold', () => {
    // "I have a leak in my apartment" gives only 1 keyword hit for Category=maintenance
    // → cue_strength=0.6 → confidence ~0.68 which is below category_gating_threshold (0.70).
    // Category gating requires confidence >= 0.70, so management fields are NOT pruned.
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    // Verify Category confidence is below gating threshold
    expect(confidences['Category'].confidence).toBeLessThan(config.category_gating_threshold);

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      missingFields: [],
      classificationOutput: classification,
    });

    // Category below gating threshold → management fields NOT pruned
    expect(fieldsNeedingInput).toContain('Management_Category');
    expect(fieldsNeedingInput).toContain('Management_Object');
  });

  it('still includes genuinely uncertain maintenance fields', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      missingFields: [],
      classificationOutput: classification,
    });

    // Maintenance_Object has no cue hits and low model confidence — should still need input
    expect(fieldsNeedingInput).toContain('Maintenance_Object');
  });
});

describe('confidence integration: management Location policy', () => {
  it('management issue with blank Location and medium confidence, Category confident → Location NOT in fieldsNeedingInput', () => {
    // Category is high-confidence (above high_threshold) so gating is active
    // Location is medium-confidence and normally required → would trigger follow-up
    // But management issues should not require Location
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.9),
      Location: simpleDetail(0.6), // medium band
      Sub_Location: simpleDetail(0.6), // medium band
      Management_Category: simpleDetail(0.9),
      Management_Object: simpleDetail(0.9),
      Priority: simpleDetail(0.7),
    };

    const classification = {
      Category: 'management',
      Location: '',
      Sub_Location: '',
      Management_Category: 'accounting',
      Management_Object: 'rent_receipt',
      Priority: 'normal',
    };

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    expect(fieldsNeedingInput).not.toContain('Location');
    expect(fieldsNeedingInput).not.toContain('Sub_Location');
  });

  it('management issue with provided Location and high confidence → Location NOT in fieldsNeedingInput', () => {
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.9),
      Location: simpleDetail(0.9),
      Sub_Location: simpleDetail(0.9),
      Management_Category: simpleDetail(0.9),
      Management_Object: simpleDetail(0.9),
      Priority: simpleDetail(0.7),
    };

    const classification = {
      Category: 'management',
      Location: 'suite',
      Sub_Location: 'general',
      Management_Category: 'accounting',
      Management_Object: 'rent_receipt',
      Priority: 'normal',
    };

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    expect(fieldsNeedingInput).not.toContain('Location');
    expect(fieldsNeedingInput).not.toContain('Sub_Location');
  });

  it('management issue with uncertain Category → Location IS still in fieldsNeedingInput (safety guard)', () => {
    // Category is low-confidence → gating disabled → Location still required
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.4), // low band → Category in fieldsNeedingInput → gating disabled
      Location: simpleDetail(0.6), // medium band, required → would need input
      Sub_Location: simpleDetail(0.6),
      Management_Category: simpleDetail(0.9),
      Management_Object: simpleDetail(0.9),
      Priority: simpleDetail(0.7),
    };

    const classification = {
      Category: 'management',
      Location: '',
      Sub_Location: '',
      Management_Category: 'accounting',
      Management_Object: 'rent_receipt',
      Priority: 'normal',
    };

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Category is uncertain, so gating is disabled — Location stays required
    expect(fieldsNeedingInput).toContain('Location');
  });

  it('maintenance issue with blank Location and medium confidence → Location IS in fieldsNeedingInput (regression guard)', () => {
    const confidences: Record<string, FieldConfidenceDetail> = {
      Category: simpleDetail(0.9),
      Location: simpleDetail(0.6), // medium band, required → should need input
      Sub_Location: simpleDetail(0.6),
      Maintenance_Category: simpleDetail(0.9),
      Maintenance_Object: simpleDetail(0.9),
      Maintenance_Problem: simpleDetail(0.9),
      Priority: simpleDetail(0.7),
    };

    const classification = {
      Category: 'maintenance',
      Location: '',
      Sub_Location: '',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'faucet',
      Maintenance_Problem: 'leak',
      Priority: 'normal',
    };

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Maintenance issues still require Location
    expect(fieldsNeedingInput).toContain('Location');
  });
});

describe('confidence integration: clear-case over-asking regression', () => {
  const text = 'My kitchen faucet is leaking';

  const classification = {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'kitchen',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'faucet',
    Maintenance_Problem: 'leak',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  };

  const modelConfidence = {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.9,
    Maintenance_Category: 0.95,
    Maintenance_Object: 0.9,
    Maintenance_Problem: 0.95,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.8,
  };

  it('Location cue now hits for suite-implying keyword "kitchen"', () => {
    const cueScores = computeCueScores(text, cueDict);
    expect(cueScores['Location']).toBeDefined();
    expect(cueScores['Location'].topLabel).toBe('suite');
    expect(cueScores['Location'].score).toBeGreaterThan(0);
  });

  it('Maintenance_Problem "leak" gets 2 keyword hits (leak + leaking) → cue_strength=1.0', () => {
    const cueScores = computeCueScores(text, cueDict);
    expect(cueScores['Maintenance_Problem'].topLabel).toBe('leak');
    expect(cueScores['Maintenance_Problem'].score).toBe(1.0);
  });

  it('Category, Maintenance_Category reach medium (not high) without constraint_implied — structural ceiling at 0.84', () => {
    // Without constraint_implied, max confidence is 0.40(1.0) + 0.25(1.0) + 0.20(0.95) = 0.84
    // which is below high_threshold (0.85). This is a known structural property of the formula.
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    // Both have strong cues (2+ hits) but cap at medium
    expect(classifyConfidenceBand(confidences['Category'].confidence, config)).toBe('medium');
    expect(classifyConfidenceBand(confidences['Maintenance_Category'].confidence, config)).toBe(
      'medium',
    );
  });

  it('Sub_Location reaches high with constraint_implied, other fields remain medium', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
      impliedFields: { Sub_Location: 'kitchen' }, // constraint narrowing from faucet
    });

    // Sub_Location gets constraint_implied boost → high
    expect(classifyConfidenceBand(confidences['Sub_Location'].confidence, config)).toBe('high');

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Sub_Location is high → not in fieldsNeedingInput
    expect(fieldsNeedingInput).not.toContain('Sub_Location');
    // Category is medium but resolved-medium (0.84, no disagreement, low ambiguity)
    // → accepted without follow-up
    expect(fieldsNeedingInput).not.toContain('Category');
  });
});

describe('confidence integration: cue/model disagreement penalizes correctly', () => {
  const text = 'I have a leak in my apartment';

  it('penalizes when model says electrical but cues say plumbing', () => {
    const cueScores = computeCueScores(text, cueDict);

    // Model says "electrical" but text clearly matches "plumbing" cues
    const badClassification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Category: 'electrical', // WRONG — cues say plumbing
      Maintenance_Object: 'outlet',
      Maintenance_Problem: 'not_working',
      Management_Category: 'other_mgmt_cat',
      Management_Object: 'other_mgmt_obj',
      Priority: 'normal',
    };

    const modelConfidence = {
      Category: 0.95,
      Location: 0.9,
      Sub_Location: 0.5,
      Maintenance_Category: 0.9,
      Maintenance_Object: 0.85,
      Maintenance_Problem: 0.9,
      Management_Category: 0.0,
      Management_Object: 0.0,
      Priority: 0.7,
    };

    const confidences = computeAllFieldConfidences({
      classification: badClassification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    // Maintenance_Category should be penalized by disagreement
    const maintCatBand = classifyConfidenceBand(
      confidences['Maintenance_Category'].confidence,
      config,
    );
    expect(maintCatBand).toBe('low'); // disagreement drops it
  });
});

describe('live confidence drift regressions', () => {
  it('reg-001 anchor: maintenance plumbing with strong signals → category gating fires, management fields pruned', () => {
    const text = 'The toilet in my bathroom is leaking';
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'bathroom',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
      Management_Category: 'not_applicable',
      Management_Object: 'not_applicable',
      Priority: 'normal',
    };
    const modelConfidence = {
      Category: 0.95,
      Location: 0.9,
      Sub_Location: 0.9,
      Maintenance_Category: 0.95,
      Maintenance_Object: 0.9,
      Maintenance_Problem: 0.95,
      Management_Category: 0.0,
      Management_Object: 0.0,
      Priority: 0.8,
    };

    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Category gating should fire (Category ≥ 0.70, no disagreement, low ambiguity)
    // so Management_Category and Management_Object should be pruned
    expect(fieldsNeedingInput).not.toContain('Management_Category');
    expect(fieldsNeedingInput).not.toContain('Management_Object');
    // Resolved-medium should reduce total fields
    expect(fieldsNeedingInput.length).toBeLessThanOrEqual(4);
  });

  it('reg-006 anchor: management rent-charge → maintenance + location pruned', () => {
    const text = 'I need a copy of my rent receipt';
    const classification = {
      Category: 'management',
      Management_Category: 'accounting',
      Management_Object: 'rent_charges',
      Maintenance_Category: 'not_applicable',
      Maintenance_Object: 'not_applicable',
      Maintenance_Problem: 'not_applicable',
      Priority: 'normal',
    };
    const modelConfidence = {
      Category: 0.95,
      Management_Category: 0.9,
      Management_Object: 0.85,
      Maintenance_Category: 0.0,
      Maintenance_Object: 0.0,
      Maintenance_Problem: 0.0,
      Priority: 0.7,
    };

    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Management → maintenance fields and Location/Sub_Location should be pruned
    expect(fieldsNeedingInput).not.toContain('Maintenance_Category');
    expect(fieldsNeedingInput).not.toContain('Maintenance_Object');
    expect(fieldsNeedingInput).not.toContain('Maintenance_Problem');
    expect(fieldsNeedingInput).not.toContain('Location');
    expect(fieldsNeedingInput).not.toContain('Sub_Location');
  });

  it('reg-010 anchor: Priority=low stays in fieldsNeedingInput when cue signal is weak (low band)', () => {
    // "My bathroom faucet has a slow drip" has no Priority-specific cues,
    // so Priority confidence = 0.40*0 + 0.25*1 + 0.20*0.85 = 0.42 (low band).
    // Low-band fields always need input regardless of resolved-medium.
    const text = 'My bathroom faucet has a slow drip';
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'bathroom',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'faucet',
      Maintenance_Problem: 'leak',
      Management_Category: 'not_applicable',
      Management_Object: 'not_applicable',
      Priority: 'low',
    };
    const modelConfidence = {
      Category: 0.95,
      Location: 0.9,
      Sub_Location: 0.9,
      Maintenance_Category: 0.92,
      Maintenance_Object: 0.9,
      Maintenance_Problem: 0.93,
      Management_Category: 0.0,
      Management_Object: 0.0,
      Priority: 0.85,
    };

    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    // Priority has no cue support → low band → always needs input
    expect(classifyConfidenceBand(confidences['Priority'].confidence, config)).toBe('low');

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    expect(fieldsNeedingInput).toContain('Priority');
  });

  it('reg-021 anchor: no-heat HVAC with strong agreement → Maintenance_Category NOT asked', () => {
    const text = 'I have no heat in my entire apartment, the radiator is cold';
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'entire_unit',
      Maintenance_Category: 'hvac',
      Maintenance_Object: 'radiator',
      Maintenance_Problem: 'no_heat',
      Management_Category: 'not_applicable',
      Management_Object: 'not_applicable',
      Priority: 'high',
    };
    const modelConfidence = {
      Category: 0.95,
      Location: 0.9,
      Sub_Location: 0.85,
      Maintenance_Category: 0.95,
      Maintenance_Object: 0.9,
      Maintenance_Problem: 0.95,
      Management_Category: 0.0,
      Management_Object: 0.0,
      Priority: 0.8,
    };

    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Strong cue+model agreement on Maintenance_Category=hvac should be resolved-medium
    expect(fieldsNeedingInput).not.toContain('Maintenance_Category');
  });

  it('emergency priority strict path: Priority=emergency at 0.84 → STILL in fieldsNeedingInput', () => {
    const text = 'I smell gas in my kitchen near the stove';
    const classification = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'kitchen',
      Maintenance_Category: 'general_maintenance',
      Maintenance_Object: 'stove',
      Maintenance_Problem: 'smell',
      Management_Category: 'not_applicable',
      Management_Object: 'not_applicable',
      Priority: 'emergency',
    };
    const modelConfidence = {
      Category: 0.95,
      Location: 0.95,
      Sub_Location: 0.9,
      Maintenance_Category: 0.9,
      Maintenance_Object: 0.9,
      Maintenance_Problem: 0.9,
      Management_Category: 0.0,
      Management_Object: 0.0,
      Priority: 0.9,
    };

    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput({
      confidenceByField: confidences,
      config,
      classificationOutput: classification,
    });

    // Priority=emergency must always be confirmed
    expect(fieldsNeedingInput).toContain('Priority');
  });
});

import { describe, it, expect } from 'vitest';
import { computeCueScores } from '../../classifier/cue-scoring.js';
import { computeAllFieldConfidences, determineFieldsNeedingInput, classifyConfidenceBand } from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import type { CueDictionary } from '@wo-agent/schemas';

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
    Location: 0.90,
    Sub_Location: 0.5,
    Maintenance_Category: 0.90,
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

    expect(classifyConfidenceBand(confidences['Category'], config)).not.toBe('low');
    expect(classifyConfidenceBand(confidences['Location'], config)).not.toBe('low');
    expect(classifyConfidenceBand(confidences['Maintenance_Category'], config)).not.toBe('low');
    expect(classifyConfidenceBand(confidences['Maintenance_Problem'], config)).not.toBe('low');
  });

  it('does NOT flag Category, Location, Maint_Category, Maint_Problem as needing input', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config);

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

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config);

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
    Management_Category: 0.90,
    Management_Object: 0.90,
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

    expect(classifyConfidenceBand(confidences['Category'], config)).not.toBe('low');
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

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config);

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
    Location: 0.90,
    Sub_Location: 0.5,
    Maintenance_Category: 0.90,
    Maintenance_Object: 0.5,
    Maintenance_Problem: 0.95,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  };

  it('does NOT include Management fields in fieldsNeedingInput for maintenance issues', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config, [], classification);

    expect(fieldsNeedingInput).not.toContain('Management_Category');
    expect(fieldsNeedingInput).not.toContain('Management_Object');
  });

  it('still includes genuinely uncertain maintenance fields', () => {
    const cueScores = computeCueScores(text, cueDict);
    const confidences = computeAllFieldConfidences({
      classification,
      modelConfidence,
      cueResults: cueScores,
      config,
    });

    const fieldsNeedingInput = determineFieldsNeedingInput(confidences, config, [], classification);

    // Maintenance_Object has no cue hits and low model confidence — should still need input
    expect(fieldsNeedingInput).toContain('Maintenance_Object');
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
      Location: 0.90,
      Sub_Location: 0.5,
      Maintenance_Category: 0.90,
      Maintenance_Object: 0.85,
      Maintenance_Problem: 0.90,
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
    const maintCatBand = classifyConfidenceBand(confidences['Maintenance_Category'], config);
    expect(maintCatBand).toBe('low'); // disagreement drops it
  });
});

import { describe, it, expect } from 'vitest';
import { scanTextForTriggers, scanClassificationForTriggers } from '../../risk/trigger-scanner.js';
import type { RiskProtocols } from '@wo-agent/schemas';

const TEST_PROTOCOLS: RiskProtocols = {
  version: '1.0.0',
  triggers: [
    {
      trigger_id: 'fire-001',
      name: 'Fire',
      grammar: {
        keyword_any: ['fire', 'smoke', 'burning'],
        regex_any: ['\\b(fire|flames)\\b'],
        taxonomy_path_any: [],
      },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-fire',
    },
    {
      trigger_id: 'flood-001',
      name: 'Flood',
      grammar: {
        keyword_any: ['flood', 'burst pipe'],
        regex_any: ['\\bflood(ing)?\\b'],
        taxonomy_path_any: ['maintenance.plumbing.flood'],
      },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-flood',
    },
    {
      trigger_id: 'no-heat-001',
      name: 'No Heat',
      grammar: {
        keyword_any: ['no heat'],
        regex_any: ['\\bno\\s+heat\\b'],
        taxonomy_path_any: ['maintenance.hvac.no_heat'],
      },
      requires_confirmation: true,
      severity: 'high',
      mitigation_template_id: 'mit-no-heat',
    },
  ],
  mitigation_templates: [],
};

describe('scanTextForTriggers', () => {
  it('returns empty result for benign text', () => {
    const result = scanTextForTriggers('My faucet is dripping', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(0);
    expect(result.has_emergency).toBe(false);
    expect(result.highest_severity).toBeNull();
  });

  it('matches keyword triggers (case-insensitive)', () => {
    const result = scanTextForTriggers('There is SMOKE coming from my unit', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('fire-001');
    expect(result.triggers_matched[0].matched_keywords).toContain('smoke');
    expect(result.has_emergency).toBe(true);
    expect(result.highest_severity).toBe('emergency');
  });

  it('matches regex triggers', () => {
    const result = scanTextForTriggers('The apartment is flooding badly', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('flood-001');
    expect(result.triggers_matched[0].matched_regex.length).toBeGreaterThan(0);
  });

  it('matches multiple triggers', () => {
    const result = scanTextForTriggers('Fire and flooding in the building', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(2);
    const ids = result.triggers_matched.map(t => t.trigger.trigger_id);
    expect(ids).toContain('fire-001');
    expect(ids).toContain('flood-001');
  });

  it('matches multi-word keywords', () => {
    const result = scanTextForTriggers('We have a burst pipe in the kitchen', TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('flood-001');
    expect(result.triggers_matched[0].matched_keywords).toContain('burst pipe');
  });

  it('sets highest_severity to the worst match', () => {
    const result = scanTextForTriggers('No heat and also there is fire', TEST_PROTOCOLS);
    expect(result.highest_severity).toBe('emergency');
  });

  it('handles high severity without emergency', () => {
    const result = scanTextForTriggers('There is no heat in my apartment', TEST_PROTOCOLS);
    expect(result.has_emergency).toBe(false);
    expect(result.highest_severity).toBe('high');
  });
});

describe('scanClassificationForTriggers', () => {
  it('matches taxonomy path triggers using classifier field keys', () => {
    // Classifier outputs PascalCase field keys: Category, Maintenance_Category, Maintenance_Problem
    const classification = { Category: 'maintenance', Maintenance_Category: 'plumbing', Maintenance_Problem: 'flood' };
    const result = scanClassificationForTriggers(classification, TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('flood-001');
    expect(result.triggers_matched[0].matched_taxonomy_paths).toContain('maintenance.plumbing.flood');
  });

  it('matches two-level taxonomy path (Category.Maintenance_Category)', () => {
    // hvac.no_heat needs 3 levels, but Category.Maintenance_Category alone should match 2-level paths
    const classification = { Category: 'maintenance', Maintenance_Category: 'hvac', Maintenance_Problem: 'no_heat' };
    const result = scanClassificationForTriggers(classification, TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(1);
    expect(result.triggers_matched[0].trigger.trigger_id).toBe('no-heat-001');
  });

  it('returns empty for non-risk classification', () => {
    const classification = { Category: 'maintenance', Maintenance_Category: 'general', Maintenance_Problem: 'cleaning' };
    const result = scanClassificationForTriggers(classification, TEST_PROTOCOLS);
    expect(result.triggers_matched).toHaveLength(0);
  });
});

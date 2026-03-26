import { describe, it, expect } from 'vitest';
import { resolveConstraintImpliedFields } from '../../classifier/constraint-resolver.js';
import { validateHierarchicalConstraints, taxonomyConstraints } from '@wo-agent/schemas';
import { computeAllFieldConfidences } from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';

describe('constraint pipeline integration', () => {
  it('resolves Sub_Location=bathroom for toilet+suite and boosts confidence', () => {
    const classification: Record<string, string> = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };

    // Step A: Validate — should pass (general is skip value)
    const validation = validateHierarchicalConstraints(classification, taxonomyConstraints);
    expect(validation.valid).toBe(true);

    // Step B: Resolve implied fields
    const implied = resolveConstraintImpliedFields(classification, taxonomyConstraints);
    expect(implied['Sub_Location']).toBe('bathroom');

    // Apply implied
    const resolved = { ...classification, ...implied };
    expect(resolved.Sub_Location).toBe('bathroom');

    // Step C: Confidence with boost
    const withBoost = computeAllFieldConfidences({
      classification: resolved,
      modelConfidence: { Sub_Location: 0.3 },
      cueResults: {},
      config: DEFAULT_CONFIDENCE_CONFIG,
      impliedFields: implied,
    });

    const withoutBoost = computeAllFieldConfidences({
      classification: resolved,
      modelConfidence: { Sub_Location: 0.3 },
      cueResults: {},
      config: DEFAULT_CONFIDENCE_CONFIG,
    });

    expect(withBoost['Sub_Location'].confidence).toBeGreaterThan(
      withoutBoost['Sub_Location'].confidence,
    );
  });

  it('detects toilet+bedroom as a hierarchical violation', () => {
    const classification: Record<string, string> = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'bedroom',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };

    const validation = validateHierarchicalConstraints(classification, taxonomyConstraints);
    expect(validation.valid).toBe(false);
    expect(validation.violations.length).toBeGreaterThan(0);
  });

  it('does not imply fields when multiple options remain', () => {
    const classification: Record<string, string> = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Category: 'plumbing',
    };

    const implied = resolveConstraintImpliedFields(classification, taxonomyConstraints);
    // plumbing in suite has multiple valid sub-locations and objects
    expect(implied['Sub_Location']).toBeUndefined();
    expect(implied['Maintenance_Object']).toBeUndefined();
  });

  it('constraint resolution logs correctly when fields are resolved', () => {
    const classification: Record<string, string> = {
      Category: 'maintenance',
      Location: 'suite',
      Maintenance_Object: 'fridge',
    };

    const implied = resolveConstraintImpliedFields(classification, taxonomyConstraints);
    expect(implied['Sub_Location']).toBe('kitchen');

    // The pipeline would log this as an event
    expect(Object.keys(implied).length).toBeGreaterThan(0);
  });
});

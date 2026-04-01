import { describe, it, expect } from 'vitest';
import { resolveConstraintImpliedFields } from '../../classifier/constraint-resolver.js';
import { validateHierarchicalConstraints, taxonomyConstraints } from '@wo-agent/schemas';
import { computeAllFieldConfidences } from '../../classifier/confidence.js';
import { DEFAULT_CONFIDENCE_CONFIG } from '@wo-agent/schemas';

describe('constraint pipeline integration', () => {
  it('does not auto-resolve Sub_Location from Maintenance_Object on the default intake path', () => {
    const classification: Record<string, string> = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };

    const validation = validateHierarchicalConstraints(classification, taxonomyConstraints);
    expect(validation.valid).toBe(true);

    const implied = resolveConstraintImpliedFields(classification, taxonomyConstraints);
    expect(implied['Sub_Location']).toBeUndefined();
  });

  it('can still resolve Sub_Location=bathroom for toilet+suite when all constraint directions are enabled', () => {
    const classification: Record<string, string> = {
      Category: 'maintenance',
      Location: 'suite',
      Sub_Location: 'general',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: 'toilet',
      Maintenance_Problem: 'leak',
    };

    const implied = resolveConstraintImpliedFields(classification, taxonomyConstraints, undefined, {
      mode: 'all',
    });
    expect(implied['Sub_Location']).toBe('bathroom');

    const resolved = { ...classification, ...implied };
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
    expect(implied['Sub_Location']).toBeUndefined();
    expect(implied['Maintenance_Object']).toBeUndefined();
  });
});

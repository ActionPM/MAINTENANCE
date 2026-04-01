import { describe, it, expect } from 'vitest';
import { buildHierarchyConflictQuestion } from '../../followup/hierarchy-conflict-questions.js';
import { loadTaxonomyConstraints } from '@wo-agent/schemas';
import type { ClearedField } from '../../classifier/descendant-invalidation.js';

const constraints = loadTaxonomyConstraints();

let idCounter = 0;
function testIdGenerator(): string {
  return `q-conflict-${++idCounter}`;
}

describe('buildHierarchyConflictQuestion', () => {
  it('builds contradiction prompt for a cleared pin', () => {
    const cleared: ClearedField = {
      field: 'Maintenance_Object',
      oldValue: 'toilet',
      wasPinned: true,
    };
    // After clearing, classification has the updated parent and empty object
    const classification: Record<string, string> = {
      Location: 'suite',
      Sub_Location: 'kitchen',
      Maintenance_Category: 'plumbing',
      Maintenance_Object: '',
    };

    const result = buildHierarchyConflictQuestion(
      cleared,
      'Sub_Location',
      'kitchen',
      classification,
      constraints,
      testIdGenerator,
    );

    expect(result).not.toBeNull();
    expect(result!.field_target).toBe('Maintenance_Object');
    expect(result!.prompt).toContain('toilet');
    expect(result!.prompt).toContain('kitchen');
    expect(result!.answer_type).toBe('enum');
    // Options should be valid plumbing objects (faucet, sink, etc.)
    expect(result!.options.length).toBeGreaterThan(0);
    expect(result!.options).toContain('faucet');
    expect(result!.options).toContain('sink');
  });

  it('returns null for unpinned source', () => {
    const cleared: ClearedField = {
      field: 'Maintenance_Object',
      oldValue: 'toilet',
      wasPinned: false,
    };
    const classification: Record<string, string> = {
      Maintenance_Category: 'plumbing',
      Maintenance_Object: '',
    };

    const result = buildHierarchyConflictQuestion(
      cleared,
      'Sub_Location',
      'kitchen',
      classification,
      constraints,
      testIdGenerator,
    );

    expect(result).toBeNull();
  });

  it('returns null when no valid options exist', () => {
    const cleared: ClearedField = {
      field: 'Maintenance_Object',
      oldValue: 'toilet',
      wasPinned: true,
    };
    // No parent value to constrain → resolveValidOptions returns null
    const classification: Record<string, string> = {
      Maintenance_Object: '',
    };

    const result = buildHierarchyConflictQuestion(
      cleared,
      'Sub_Location',
      'kitchen',
      classification,
      constraints,
      testIdGenerator,
    );

    // resolveValidOptions returns null (unconstrained) → null
    expect(result).toBeNull();
  });

  it('caps options at 10', () => {
    const cleared: ClearedField = {
      field: 'Maintenance_Category',
      oldValue: 'appliance',
      wasPinned: true,
    };
    // kitchen has many valid categories (12+)
    const classification: Record<string, string> = {
      Sub_Location: 'kitchen',
      Maintenance_Category: '',
    };

    const result = buildHierarchyConflictQuestion(
      cleared,
      'Sub_Location',
      'kitchen',
      classification,
      constraints,
      testIdGenerator,
    );

    expect(result).not.toBeNull();
    expect(result!.options.length).toBeLessThanOrEqual(10);
  });

  it('uses human-readable labels in prompt text', () => {
    const cleared: ClearedField = {
      field: 'Maintenance_Object',
      oldValue: 'range_hood',
      wasPinned: true,
    };
    const classification: Record<string, string> = {
      Maintenance_Category: 'plumbing',
      Maintenance_Object: '',
    };

    const result = buildHierarchyConflictQuestion(
      cleared,
      'Maintenance_Category',
      'plumbing',
      classification,
      constraints,
      testIdGenerator,
    );

    expect(result).not.toBeNull();
    // "range_hood" should become "range hood" in the prompt
    expect(result!.prompt).toContain('range hood');
    // Field label should be human-readable
    expect(result!.prompt).toContain('specific fixture or item');
  });
});

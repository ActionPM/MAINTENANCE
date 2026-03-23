import { describe, it, expect } from 'vitest';
import {
  checkCompleteness,
  DEFAULT_COMPLETENESS_POLICY,
  FollowUpType,
} from '../../classifier/completeness-gate.js';

describe('checkCompleteness', () => {
  describe('maintenance issues', () => {
    it('flags blank Location as incomplete with type "location"', () => {
      const classification = {
        Category: 'maintenance',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
      };
      const result = checkCompleteness(classification, 'maintenance');

      expect(result.complete).toBe(false);
      expect(result.incompleteFields).toContain('Location');
      expect(result.followupTypes['Location']).toBe(FollowUpType.LOCATION);
    });

    it('flags blank Sub_Location as incomplete with type "location"', () => {
      const classification = {
        Category: 'maintenance',
        Location: 'suite',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
      };
      const result = checkCompleteness(classification, 'maintenance');

      expect(result.incompleteFields).toContain('Sub_Location');
      expect(result.followupTypes['Sub_Location']).toBe(FollowUpType.LOCATION);
    });

    it('flags needs_object as incomplete with type "object_clarification"', () => {
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

      expect(result.complete).toBe(false);
      expect(result.incompleteFields).toContain('Maintenance_Object');
      expect(result.followupTypes['Maintenance_Object']).toBe(
        FollowUpType.OBJECT_CLARIFICATION,
      );
    });

    it('returns complete when all eligible fields are populated', () => {
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
      const result = checkCompleteness(classification, 'maintenance');

      expect(result.complete).toBe(true);
      expect(result.incompleteFields).toHaveLength(0);
    });

    it('does not flag cross-domain management fields', () => {
      const classification = {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Priority: 'normal',
        // Management fields absent — should NOT trigger follow-up
      };
      const result = checkCompleteness(classification, 'maintenance');

      expect(result.incompleteFields).not.toContain('Management_Category');
      expect(result.incompleteFields).not.toContain('Management_Object');
    });
  });

  describe('management issues', () => {
    it('does NOT flag blank Location (Decision 1)', () => {
      const classification = {
        Category: 'management',
        Management_Category: 'accounting',
        Management_Object: 'rent_receipt',
        Priority: 'normal',
      };
      const result = checkCompleteness(classification, 'management');

      expect(result.incompleteFields).not.toContain('Location');
    });

    it('does not flag cross-domain maintenance fields', () => {
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

    it('flags needs_object in Management_Object', () => {
      const classification = {
        Category: 'management',
        Management_Category: 'general',
        Management_Object: 'needs_object',
        Priority: 'normal',
      };
      const result = checkCompleteness(classification, 'management');

      expect(result.incompleteFields).toContain('Management_Object');
      expect(result.followupTypes['Management_Object']).toBe(
        FollowUpType.OBJECT_CLARIFICATION,
      );
    });

    it('returns complete for management issue with all relevant fields', () => {
      const classification = {
        Category: 'management',
        Management_Category: 'accounting',
        Management_Object: 'rent_receipt',
        Priority: 'normal',
      };
      const result = checkCompleteness(classification, 'management');

      expect(result.complete).toBe(true);
    });
  });

  describe('not_applicable handling', () => {
    it('not_applicable fields are never follow-up-eligible', () => {
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
      const result = checkCompleteness(classification, 'maintenance');

      expect(result.incompleteFields).not.toContain('Management_Category');
      expect(result.incompleteFields).not.toContain('Management_Object');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  callIssueClassifier,
  ClassifierError,
  ClassifierErrorCode,
} from '../../classifier/issue-classifier.js';
import type { IssueClassifierInput, IssueClassifierOutput } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';

const taxonomy = loadTaxonomy();

const VALID_INPUT: IssueClassifierInput = {
  issue_id: 'issue-1',
  issue_summary: 'Toilet is leaking',
  raw_excerpt: 'My toilet is leaking water onto the floor',
  taxonomy_version: '1.0.0',
  model_id: 'test-model',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

const VALID_OUTPUT: IssueClassifierOutput = {
  issue_id: 'issue-1',
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'leak',
    Management_Category: 'other_mgmt_cat',
    Management_Object: 'other_mgmt_obj',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95,
    Location: 0.9,
    Sub_Location: 0.85,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.95,
    Maintenance_Problem: 0.88,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.7,
  },
  missing_fields: [],
  needs_human_triage: false,
};

describe('callIssueClassifier', () => {
  it('returns valid output on first attempt', async () => {
    const llmCall = vi.fn().mockResolvedValue(VALID_OUTPUT);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('ok');
    expect(result.output!.issue_id).toBe('issue-1');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('retries once on schema validation failure then succeeds', async () => {
    const badOutput = { ...VALID_OUTPUT, issue_id: undefined }; // missing required field
    const llmCall = vi.fn().mockResolvedValueOnce(badOutput).mockResolvedValueOnce(VALID_OUTPUT);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('ok');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('returns llm_fail after two schema validation failures', async () => {
    const badOutput = { ...VALID_OUTPUT, issue_id: undefined };
    const llmCall = vi.fn().mockResolvedValue(badOutput);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('llm_fail');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws ClassifierError on LLM call exception', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(callIssueClassifier(VALID_INPUT, llmCall, taxonomy)).rejects.toThrow(
      ClassifierError,
    );
  });

  it('detects category gating contradiction and retries with constraint', async () => {
    const contradictory: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Category: 'management',
        // But has populated maintenance fields -- contradictory!
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
      },
    };
    const fixed: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Category: 'management',
        Maintenance_Category: 'other_maintenance_category',
        Maintenance_Object: 'other_maintenance_object',
        Maintenance_Problem: 'other_problem',
        Management_Category: 'accounting',
        Management_Object: 'rent_charges',
      },
    };
    const llmCall = vi.fn().mockResolvedValueOnce(contradictory).mockResolvedValueOnce(fixed);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('ok');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('sets needs_human_triage when gating retry still contradictory', async () => {
    const contradictory: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Category: 'management',
        Maintenance_Category: 'plumbing',
      },
    };
    const llmCall = vi.fn().mockResolvedValue(contradictory);
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('needs_human_triage');
    expect(result.conflicting).toHaveLength(2);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('validates classification values against taxonomy', async () => {
    const invalidTaxonomy: IssueClassifierOutput = {
      ...VALID_OUTPUT,
      classification: {
        ...VALID_OUTPUT.classification,
        Maintenance_Category: 'nonexistent_category',
      },
    };
    const llmCall = vi.fn().mockResolvedValue(invalidTaxonomy);
    // Invalid taxonomy values are treated as schema-level failures -> retry
    const result = await callIssueClassifier(VALID_INPUT, llmCall, taxonomy);
    expect(result.status).toBe('llm_fail');
  });
});

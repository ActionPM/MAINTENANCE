import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicClassifierAdapter,
  type ClassifierAdapterOutput,
} from '../../runners/classifier-adapters.js';

describe('AnthropicClassifierAdapter', () => {
  it('passes cue scores into the validated classifier pipeline and returns output', async () => {
    const llmCall = vi.fn(async () => ({
      issue_id: 'gold-001-issue-0',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'faucet',
        Maintenance_Problem: 'leak',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
        Priority: 'normal',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.9,
        Sub_Location: 0.9,
        Maintenance_Category: 0.92,
        Maintenance_Object: 0.9,
        Maintenance_Problem: 0.93,
        Priority: 0.88,
      },
      missing_fields: [],
      needs_human_triage: false,
    }));

    const adapter = new AnthropicClassifierAdapter({
      llmCall,
      modelId: 'claude-sonnet-4-20250514',
    });

    const result = await adapter.classify({
      issue_id: 'gold-001-issue-0',
      issue_text: 'My kitchen faucet is leaking.',
      cue_scores: {
        Category: 1,
        Location: 0.8,
        ignored: 'nope',
      },
    });

    expect(result.needs_human_triage).toBe(false);
    expect(result.classification.Priority).toBe('normal');
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_id: 'gold-001-issue-0',
        cue_scores: {
          Category: 1,
          Location: 0.8,
        },
      }),
      undefined,
    );
  });

  it('maps category-gating failures to needs_human_triage output', async () => {
    const contradictory: ClassifierAdapterOutput = {
      classification: {
        Category: 'management',
        Location: 'suite',
        Sub_Location: 'kitchen',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'faucet',
        Maintenance_Problem: 'leak',
        Management_Category: 'lease',
        Management_Object: 'lease_inquiry',
        Priority: 'normal',
      },
      model_confidence: {
        Category: 0.7,
      },
      missing_fields: [],
      needs_human_triage: false,
    };
    const llmCall = vi
      .fn()
      .mockResolvedValueOnce({
        issue_id: 'triage-001-issue-0',
        ...contradictory,
      })
      .mockResolvedValueOnce({
        issue_id: 'triage-001-issue-0',
        ...contradictory,
      });

    const adapter = new AnthropicClassifierAdapter({ llmCall });

    const result = await adapter.classify({
      issue_id: 'triage-001-issue-0',
      issue_text: 'Need help with lease renewal and my faucet is leaking.',
    });

    expect(result.needs_human_triage).toBe(true);
    expect(result.classification.Category).toBe('management');
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('throws when no API key or injected llmCall is provided', () => {
    expect(() => new AnthropicClassifierAdapter({ apiKey: '' })).toThrow(
      'ANTHROPIC_API_KEY is required for --adapter anthropic',
    );
  });
});

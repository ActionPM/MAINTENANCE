import { describe, it, expect } from 'vitest';
import { runConversationReplay } from '../../runners/conversation-replay.js';
import { FixtureClassifierAdapter } from '../../runners/classifier-adapters.js';

describe('runConversationReplay', () => {
  it('replays a single-issue conversation through classification', async () => {
    // Empty fixture adapter will cause the classifier to throw,
    // which the pipeline catches as schema_fail -> llm_error_retryable
    const result = await runConversationReplay({
      example_id: 'gold-001',
      conversation_text: 'My toilet is leaking water onto the bathroom floor.',
      split_issues_expected: [
        { issue_text: 'My toilet is leaking water onto the bathroom floor.' },
      ],
      classifierAdapter: new FixtureClassifierAdapter({}),
      followupAdapter: null,
      taxonomyVersion: '2.0.0',
    });

    expect(result.terminal_state).toBeDefined();
    expect([
      'needs_tenant_input',
      'tenant_confirmation_pending',
      'llm_error_retryable',
      'llm_error_terminal',
      'needs_human_triage',
    ]).toContain(result.terminal_state);
    expect(result.event_trace.length).toBeGreaterThan(0);
    expect(result.example_id).toBe('gold-001');
  });

  it('replays a single-issue conversation with full fixture data', async () => {
    const adapter = new FixtureClassifierAdapter({
      'gold-002-issue-0': {
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
        },
        model_confidence: {
          Category: 0.92,
          Location: 0.88,
          Sub_Location: 0.85,
          Maintenance_Category: 0.9,
          Maintenance_Object: 0.85,
          Maintenance_Problem: 0.9,
        },
        missing_fields: [],
        needs_human_triage: false,
      },
    });

    const result = await runConversationReplay({
      example_id: 'gold-002',
      conversation_text: 'My toilet is leaking water onto the bathroom floor.',
      split_issues_expected: [
        { issue_text: 'My toilet is leaking water onto the bathroom floor.' },
      ],
      classifierAdapter: adapter,
      followupAdapter: null,
      taxonomyVersion: '2.0.0',
    });

    expect(result.terminal_state).toBeDefined();
    expect(result.issue_results.length).toBe(1);
    expect(result.needs_human_triage).toBe(false);
    expect(result.escape_hatch_triggered).toBe(false);
  });

  it('detects needs_human_triage when classifier returns it', async () => {
    const adapter = new FixtureClassifierAdapter({
      'hard-001-issue-0': {
        classification: { Category: 'maintenance' },
        model_confidence: { Category: 0.2 },
        missing_fields: [],
        needs_human_triage: true,
      },
    });

    const result = await runConversationReplay({
      example_id: 'hard-001',
      conversation_text: 'My toilet is leaking water onto the bathroom floor.',
      split_issues_expected: [
        { issue_text: 'My toilet is leaking water onto the bathroom floor.' },
      ],
      classifierAdapter: adapter,
      followupAdapter: null,
      taxonomyVersion: '2.0.0',
    });

    expect(result.needs_human_triage).toBe(true);
    expect(result.escape_hatch_triggered).toBe(true);
    expect(result.terminal_state).toBe('needs_human_triage');
  });

  it('handles multi-issue conversations', async () => {
    const adapter = new FixtureClassifierAdapter({
      'multi-001-issue-0': {
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leak',
        },
        model_confidence: {
          Category: 0.92,
          Location: 0.88,
          Sub_Location: 0.85,
          Maintenance_Category: 0.9,
          Maintenance_Object: 0.85,
          Maintenance_Problem: 0.9,
        },
        missing_fields: [],
        needs_human_triage: false,
      },
      'multi-001-issue-1': {
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'appliance',
          Maintenance_Object: 'dishwasher',
          Maintenance_Problem: 'not_draining',
        },
        model_confidence: {
          Category: 0.9,
          Location: 0.85,
          Sub_Location: 0.8,
          Maintenance_Category: 0.85,
          Maintenance_Object: 0.8,
          Maintenance_Problem: 0.82,
        },
        missing_fields: [],
        needs_human_triage: false,
      },
    });

    const result = await runConversationReplay({
      example_id: 'multi-001',
      conversation_text: 'My toilet is leaking and my dishwasher is not draining.',
      split_issues_expected: [
        { issue_text: 'My toilet is leaking water onto the bathroom floor.' },
        { issue_text: 'My dishwasher is not draining.' },
      ],
      classifierAdapter: adapter,
      followupAdapter: null,
      taxonomyVersion: '2.0.0',
    });

    expect(result.issue_results.length).toBe(2);
    expect(result.event_trace.length).toBeGreaterThan(0);
  });
});

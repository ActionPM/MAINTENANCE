import { describe, it, expect } from 'vitest';
import { buildResponse } from '../../orchestrator/response-builder.js';
import { ConversationState } from '@wo-agent/schemas';
import { createSession, setClassificationResults } from '../../session/session.js';
import type { IssueClassificationResult } from '../../session/types.js';

describe('buildResponse with classification', () => {
  it('includes classification_results in snapshot when present', () => {
    const results: IssueClassificationResult[] = [
      {
        issue_id: 'i1',
        classifierOutput: {
          issue_id: 'i1',
          classification: { Category: 'maintenance' },
          model_confidence: { Category: 0.9 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { Category: 0.85 },
        fieldsNeedingInput: [],
        shouldAskFollowup: false,
        followupTypes: {},
        constraintPassed: true,
        recoverable_via_followup: false,
      },
    ];

    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });
    session = setClassificationResults(session, results);

    const response = buildResponse({
      newState: ConversationState.TENANT_CONFIRMATION_PENDING,
      session,
      uiMessages: [{ role: 'agent', content: 'Review and confirm.' }],
    });

    expect(response.conversation_snapshot.classification_results).toBeDefined();
    expect(response.conversation_snapshot.classification_results).toHaveLength(1);
  });

  it('omits classification_results from snapshot when null', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'test',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    });

    const response = buildResponse({
      newState: ConversationState.INTAKE_STARTED,
      session,
      uiMessages: [{ role: 'agent', content: 'Hello.' }],
    });

    expect(response.conversation_snapshot.classification_results).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import type { OrchestratorActionRequest, PinnedVersions } from '@wo-agent/schemas';
import { handleConfirmSubmission } from '../../orchestrator/action-handlers/confirm-submission.js';
import type { ActionHandlerContext, OrchestratorDependencies } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import {
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
} from '../../notifications/in-memory-notification-store.js';
import { NotificationService } from '../../notifications/notification-service.js';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';

const VERSIONS: PinnedVersions = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'test',
  prompt_version: '1.0.0',
  cue_version: '1.2.0',
};

function makeSession(): ConversationSession {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    state: ConversationState.TENANT_CONFIRMATION_PENDING,
    unit_id: 'unit-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: VERSIONS,
    split_issues: [
      {
        issue_id: 'issue-1',
        raw_excerpt: 'Leaky faucet',
        summary: 'Leaky faucet in kitchen',
      },
    ],
    classification_results: [
      {
        issue_id: 'issue-1',
        classifierOutput: {
          issue_id: 'issue-1',
          classification: { maintenance_category: 'plumbing' },
          model_confidence: { maintenance_category: 0.9 },
          missing_fields: [],
          needs_human_triage: false,
        },
        computedConfidence: { maintenance_category: 0.9 },
        fieldsNeedingInput: [],
        shouldAskFollowup: false,
        followupTypes: {},
        constraintPassed: true,
        recoverable_via_followup: false,
      },
    ],
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-03-03T12:00:00Z',
    last_activity_at: '2026-03-03T12:00:00Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: 'prop-1',
    client_id: 'client-1',
    building_id: 'bldg-1',
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
    queued_messages: [],
    confirmed_followup_answers: {},
  };
}

describe('confirm-submission notification integration', () => {
  let notifStore: InMemoryNotificationStore;
  let notifService: NotificationService;
  let counter: number;

  function makeDeps(): OrchestratorDependencies {
    counter = 0;
    notifStore = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();
    notifService = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender,
      idGenerator: () => `nid-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    let mainCounter = 0;
    return {
      eventRepo: new InMemoryEventStore(),
      sessionStore: {
        get: async () => null,
        getByTenantUser: async () => [],
        save: async () => {},
      },
      idGenerator: () => `id-${++mainCounter}`,
      clock: () => '2026-03-03T12:00:00Z',
      issueSplitter: async () => ({ issues: [], issue_count: 0 }),
      issueClassifier: async () => ({
        issue_id: 'issue-1',
        classification: {},
        model_confidence: {},
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: { version: '1.0.0', fields: {} },
      taxonomy: { version: '1.0.0', fields: {} } as any,
      confidenceConfig: undefined,
      followUpCaps: undefined,
      unitResolver: {
        resolve: async () => ({
          unit_id: 'unit-1',
          property_id: 'prop-1',
          client_id: 'client-1',
          building_id: 'bldg-1',
        }),
      },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: async () => false,
      notificationService: notifService,
    };
  }

  it('sends notification after successful WO creation', async () => {
    const deps = makeDeps();
    const ctx: ActionHandlerContext = {
      session: makeSession(),
      request: {
        conversation_id: 'conv-1',
        action_type: 'CONFIRM_SUBMISSION',
        actor: 'tenant',
        tenant_input: {},
        idempotency_key: 'submit-1',
        auth_context: {
          tenant_user_id: 'user-1',
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['unit-1'],
        },
      } as OrchestratorActionRequest,
      deps,
    };

    const result = await handleConfirmSubmission(ctx);
    expect(result.newState).toBe(ConversationState.SUBMITTED);

    // Notification was sent
    const notifs = await notifStore.queryByTenantUser('user-1');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].notification_type).toBe('work_order_created');
    expect(notifs[0].work_order_ids).toHaveLength(1);
  });

  it('includes send_notifications side effect', async () => {
    const deps = makeDeps();
    const ctx: ActionHandlerContext = {
      session: makeSession(),
      request: {
        conversation_id: 'conv-1',
        action_type: 'CONFIRM_SUBMISSION',
        actor: 'tenant',
        tenant_input: {},
        idempotency_key: 'submit-2',
        auth_context: {
          tenant_user_id: 'user-1',
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['unit-1'],
        },
      } as OrchestratorActionRequest,
      deps,
    };

    const result = await handleConfirmSubmission(ctx);
    const notifEffect = result.sideEffects?.find((e) => e.effect_type === 'send_notifications');
    expect(notifEffect).toBeDefined();
    expect(notifEffect?.status).toBe('completed');
  });

  it('does NOT fail WO creation if notification service is unavailable', async () => {
    const deps = makeDeps();
    // Remove notification service to simulate unavailability
    (deps as any).notificationService = undefined;

    const ctx: ActionHandlerContext = {
      session: makeSession(),
      request: {
        conversation_id: 'conv-1',
        action_type: 'CONFIRM_SUBMISSION',
        actor: 'tenant',
        tenant_input: {},
        idempotency_key: 'submit-3',
        auth_context: {
          tenant_user_id: 'user-1',
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['unit-1'],
        },
      } as OrchestratorActionRequest,
      deps,
    };

    const result = await handleConfirmSubmission(ctx);
    // WO creation still succeeds
    expect(result.newState).toBe(ConversationState.SUBMITTED);
    expect(result.eventPayload?.work_order_ids).toBeTruthy();
  });
});

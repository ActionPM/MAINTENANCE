import { describe, it, expect, beforeEach } from 'vitest';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { InMemoryNotificationStore } from '../../notifications/in-memory-notification-store.js';
import { InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';
import { NotificationService } from '../../notifications/notification-service.js';
import { assembleRecordBundle } from '../../record-bundle/record-bundle-assembler.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import type { CueDictionary, IssueClassifierInput } from '@wo-agent/schemas';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { SlaPolicies } from '../../record-bundle/types.js';

const SLA_POLICIES: SlaPolicies = {
  version: '1.0.0',
  client_defaults: {
    emergency: { response_hours: 1, resolution_hours: 24 },
    high: { response_hours: 4, resolution_hours: 48 },
    normal: { response_hours: 24, resolution_hours: 168 },
    low: { response_hours: 48, resolution_hours: 336 },
  },
  overrides: [],
};

describe('E2E: Record bundle through full intake flow', () => {
  let counter: number;
  let workOrderRepo: InMemoryWorkOrderStore;
  let notificationRepo: InMemoryNotificationStore;

  function makeId() {
    return `id-${++counter}`;
  }
  const clock = () => '2026-03-04T12:00:00.000Z';

  class InMemorySessionStore implements SessionStore {
    private sessions = new Map<string, ConversationSession>();
    async get(id: string) {
      return this.sessions.get(id) ?? null;
    }
    async getByTenantUser(userId: string) {
      return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
    }
    async save(session: ConversationSession) {
      this.sessions.set(session.conversation_id, session);
    }
  }

  function makeDeps(): OrchestratorDependencies {
    workOrderRepo = new InMemoryWorkOrderStore();
    notificationRepo = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();

    const notificationService = new NotificationService({
      notificationRepo,
      preferenceStore: prefStore,
      smsSender,
      idGenerator: makeId,
      clock,
    });

    return {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: makeId,
      clock,
      issueSplitter: async (input) => ({
        issues: [{ issue_id: makeId(), summary: 'Leaky faucet', raw_excerpt: input.raw_text }],
        issue_count: 1,
      }),
      issueClassifier: async (input: IssueClassifierInput) => ({
        issue_id: input.issue_id,
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'kitchen',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'faucet',
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
          Maintenance_Object: 0.88,
          Maintenance_Problem: 0.9,
          Management_Category: 0.0,
          Management_Object: 0.0,
          Priority: 0.8,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: {
        version: '1.0.0',
        fields: {
          Category: { maintenance: { keywords: ['leak', 'faucet'], regex: [] } },
          Location: { suite: { keywords: ['kitchen'], regex: [] } },
          Sub_Location: { kitchen: { keywords: ['kitchen'], regex: [] } },
          Maintenance_Category: { plumbing: { keywords: ['leak', 'faucet'], regex: [] } },
          Maintenance_Object: { faucet: { keywords: ['faucet'], regex: [] } },
          Maintenance_Problem: { leak: { keywords: ['leak'], regex: [] } },
          Management_Category: { other_mgmt_cat: { keywords: [], regex: [] } },
          Management_Object: { other_mgmt_obj: { keywords: [], regex: [] } },
          Priority: { normal: { keywords: ['leak'], regex: [] } },
        },
      } as CueDictionary,
      taxonomy: loadTaxonomy(),
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: 'prop-1',
          client_id: 'client-1',
        }),
      },
      workOrderRepo,
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: async () => false,
      notificationService,
    };
  }

  beforeEach(() => {
    counter = 0;
  });

  it('produces a valid record bundle after confirm-submission', async () => {
    const deps = makeDeps();
    const dispatch = createDispatcher(deps);

    const AUTH = {
      tenant_user_id: 'tenant-1',
      tenant_account_id: 'account-1',
      authorized_unit_ids: ['unit-1'],
    };

    // 1. Create conversation
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // 2. Select unit
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: AUTH,
    });

    // 3. Submit initial message → triggers split + classification
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'My kitchen faucet is leaking badly' },
      auth_context: AUTH,
    });

    // 4. Confirm split
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // 5. Confirm submission → creates WOs + notifications
    const r5 = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'e2e-bundle-key-1',
      auth_context: AUTH,
    });

    expect(r5.session.state).toBe(ConversationState.SUBMITTED);

    // 6. Find the created WO via snapshot work_order_ids
    const woIds = r5.response.conversation_snapshot.work_order_ids;
    expect(woIds).toBeDefined();
    expect(woIds!.length).toBeGreaterThan(0);
    const woId = woIds![0];

    // 7. Assemble record bundle
    const bundle = await assembleRecordBundle(woId, {
      workOrderRepo,
      notificationRepo,
      slaPolicies: SLA_POLICIES,
      clock: () => '2026-03-04T13:00:00.000Z',
    });

    expect(bundle).not.toBeNull();
    expect(bundle!.work_order_id).toBe(woId);
    expect(bundle!.summary).toBe('Leaky faucet');
    expect(bundle!.unit_id).toBe('unit-1');
    expect(bundle!.schedule.priority).toBe('normal');
    expect(bundle!.status_history.length).toBeGreaterThanOrEqual(1);
    expect(bundle!.exported_at).toBe('2026-03-04T13:00:00.000Z');
  });
});

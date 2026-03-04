import { describe, it, expect } from 'vitest';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { CueDictionary } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import { InMemoryNotificationStore, InMemoryNotificationPreferenceStore } from '../../notifications/in-memory-notification-store.js';
import { NotificationService } from '../../notifications/notification-service.js';
import { MockSmsSender } from '../../notifications/mock-sms-sender.js';
import type { SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';

const taxonomy = loadTaxonomy();

const FULL_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Category: { maintenance: { keywords: ['faucet', 'leak'], regex: [] } },
    Location: { suite: { keywords: ['kitchen'], regex: [] } },
    Sub_Location: { kitchen: { keywords: ['kitchen'], regex: [] } },
    Maintenance_Category: { plumbing: { keywords: ['faucet', 'leak'], regex: [] } },
    Maintenance_Object: { faucet: { keywords: ['faucet'], regex: [] } },
    Maintenance_Problem: { leak: { keywords: ['leak'], regex: [] } },
    Management_Category: { other_mgmt_cat: { keywords: ['other'], regex: [] } },
    Management_Object: { other_mgmt_obj: { keywords: ['other'], regex: [] } },
    Priority: { normal: { keywords: ['faucet'], regex: [] } },
  },
};

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter(s => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

const AUTH = { tenant_user_id: 'user-1', tenant_account_id: 'acct-1', authorized_unit_ids: ['unit-1'] };

/**
 * E2E test: Walk the full intake flow through to submitted,
 * then verify notifications were sent correctly.
 */
describe('E2E: Notification flow through dispatcher', () => {
  it('sends batched in-app notification after multi-issue WO creation', async () => {
    const notifStore = new InMemoryNotificationStore();
    const prefStore = new InMemoryNotificationPreferenceStore();
    const smsSender = new MockSmsSender();

    let notifCounter = 0;
    const notifService = new NotificationService({
      notificationRepo: notifStore,
      preferenceStore: prefStore,
      smsSender,
      idGenerator: () => `nid-${++notifCounter}`,
      clock: () => '2026-03-03T12:00:00Z',
    });

    let counter = 0;
    const deps = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => `id-${++counter}`,
      clock: () => '2026-03-03T12:00:00Z',
      issueSplitter: async () => ({
        issue_count: 2,
        issues: [
          { issue_id: 'issue-1', raw_excerpt: 'Leaky faucet', summary: 'Leaky faucet in kitchen' },
          { issue_id: 'issue-2', raw_excerpt: 'Broken light', summary: 'Broken light in hallway' },
        ],
      }),
      issueClassifier: async (input: any) => ({
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
          Category: 0.95, Location: 0.9, Sub_Location: 0.85,
          Maintenance_Category: 0.92, Maintenance_Object: 0.95,
          Maintenance_Problem: 0.88, Management_Category: 0.95,
          Management_Object: 0.95, Priority: 0.9,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: FULL_CUES,
      taxonomy,
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: 'prop-1',
          client_id: 'client-1',
        }),
      },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      contactExecutor: async () => false,
      notificationService: notifService,
    };

    const dispatch = createDispatcher(deps);

    // Step 1: CREATE_CONVERSATION
    const r1 = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = r1.response.conversation_snapshot.conversation_id;

    // Step 2: SELECT_UNIT
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SELECT_UNIT,
      actor: ActorType.TENANT,
      tenant_input: { unit_id: 'unit-1' },
      auth_context: AUTH,
    });

    // Step 3: SUBMIT_INITIAL_MESSAGE (triggers split → classification chain)
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'I have a leaky faucet and a broken light' },
      auth_context: AUTH,
    });

    // Step 4: CONFIRM_SPLIT
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SPLIT,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    // Step 5: CONFIRM_SUBMISSION
    const submitResult = await dispatch({
      conversation_id: convId,
      action_type: ActionType.CONFIRM_SUBMISSION,
      actor: ActorType.TENANT,
      tenant_input: {},
      idempotency_key: 'submit-e2e-1',
      auth_context: AUTH,
    });

    // Verify: WOs created
    expect(submitResult.response.conversation_snapshot.state).toBe(ConversationState.SUBMITTED);

    // Verify: Notification sent
    const notifs = await notifStore.queryByTenantUser('user-1');
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    const woNotif = notifs.find(n => n.notification_type === 'work_order_created');
    expect(woNotif).toBeDefined();
    expect(woNotif!.channel).toBe('in_app');
    expect(woNotif!.status).toBe('sent');

    // Verify: side effects include send_notifications
    const notifEffect = submitResult.response.pending_side_effects.find(
      (e: any) => e.effect_type === 'send_notifications',
    );
    expect(notifEffect).toBeDefined();

    // Verify: no SMS sent (default prefs)
    expect(smsSender.sent).toHaveLength(0);
  });
});

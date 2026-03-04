import { randomUUID } from 'crypto';
import { createDispatcher, ERPSyncService, AnalyticsService } from '@wo-agent/core';
import { InMemoryEventStore, InMemoryWorkOrderStore, InMemoryIdempotencyStore } from '@wo-agent/core';
import { InMemoryNotificationStore, InMemoryNotificationPreferenceStore, MockSmsSender, NotificationService } from '@wo-agent/core';
import type { SessionStore, OrchestratorDependencies, UnitResolver, SlaPolicies, EventRepository, WorkOrderRepository, NotificationRepository, NotificationPreferenceStore, IdempotencyStore } from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';
import type { CueDictionary, IssueClassifierInput } from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import { MockERPAdapter } from '@wo-agent/mock-erp';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };

// In-memory session store fallback
class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async getByTenantUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.tenant_user_id === userId);
  }
  async save(session: ConversationSession) { this.sessions.set(session.conversation_id, session); }
}

interface Stores {
  eventRepo: EventRepository;
  workOrderRepo: WorkOrderRepository;
  notificationRepo: NotificationRepository;
  prefStore: NotificationPreferenceStore;
  sessionStore: SessionStore;
  idempotencyStore: IdempotencyStore;
}

function createStores(): Stores {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Lazy-import to avoid bundling @neondatabase/serverless when not needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPool, PostgresEventStore, PostgresWorkOrderStore, PostgresSessionStore, PostgresNotificationStore, PostgresNotificationPreferenceStore, PostgresIdempotencyStore } = require('@wo-agent/db');
    const pool = createPool(databaseUrl);
    return {
      eventRepo: new PostgresEventStore(pool),
      workOrderRepo: new PostgresWorkOrderStore(pool),
      notificationRepo: new PostgresNotificationStore(pool),
      prefStore: new PostgresNotificationPreferenceStore(pool),
      sessionStore: new PostgresSessionStore(pool),
      idempotencyStore: new PostgresIdempotencyStore(pool),
    };
  }

  // Fallback: in-memory for local dev without DATABASE_URL
  return {
    eventRepo: new InMemoryEventStore(),
    workOrderRepo: new InMemoryWorkOrderStore(),
    notificationRepo: new InMemoryNotificationStore(),
    prefStore: new InMemoryNotificationPreferenceStore(),
    sessionStore: new InMemorySessionStore(),
    idempotencyStore: new InMemoryIdempotencyStore(),
  };
}

let _deps: {
  workOrderRepo: WorkOrderRepository;
  notificationRepo: NotificationRepository;
  dispatcher: ReturnType<typeof createDispatcher>;
  erpAdapter: MockERPAdapter;
  erpSyncService: ERPSyncService;
  analyticsService: AnalyticsService;
} | null = null;

function ensureInitialized() {
  if (!_deps) {
    const stores = createStores();
    const smsSender = new MockSmsSender();
    const idGenerator = () => randomUUID();
    const clock = () => new Date().toISOString();

    const notificationService = new NotificationService({
      notificationRepo: stores.notificationRepo,
      preferenceStore: stores.prefStore,
      smsSender,
      idGenerator,
      clock,
    });

    const erpAdapter = new MockERPAdapter();
    const erpSyncService = new ERPSyncService({
      erpAdapter,
      workOrderRepo: stores.workOrderRepo,
      idGenerator,
      clock,
    });

    const deps: OrchestratorDependencies = {
      eventRepo: stores.eventRepo,
      sessionStore: stores.sessionStore,
      idGenerator,
      clock,
      issueSplitter: async (input) => ({
        issues: [{ issue_id: randomUUID(), summary: input.raw_text.slice(0, 200), raw_excerpt: input.raw_text }],
        issue_count: 1,
      }),
      issueClassifier: async (input: IssueClassifierInput) => ({
        issue_id: input.issue_id,
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'general',
          Maintenance_Category: 'general_maintenance',
          Maintenance_Object: 'other_object',
          Maintenance_Problem: 'not_working',
          Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj',
          Priority: 'normal',
        },
        model_confidence: {
          Category: 0.7,
          Location: 0.5,
          Sub_Location: 0.5,
          Maintenance_Category: 0.6,
          Maintenance_Object: 0.5,
          Maintenance_Problem: 0.5,
          Management_Category: 0.0,
          Management_Object: 0.0,
          Priority: 0.5,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: classificationCues as CueDictionary,
      taxonomy: loadTaxonomy(),
      unitResolver: {
        resolve: async (unitId: string) => ({ unit_id: unitId, property_id: `prop-${unitId}`, client_id: `client-${unitId}` }),
      } satisfies UnitResolver,
      workOrderRepo: stores.workOrderRepo,
      idempotencyStore: stores.idempotencyStore,
      notificationService,
      erpAdapter,
    };

    const analyticsService = new AnalyticsService({
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      slaPolicies: slaPoliciesJson as SlaPolicies,
      clock,
    });

    _deps = {
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      dispatcher: createDispatcher(deps),
      erpAdapter,
      erpSyncService,
      analyticsService,
    };
  }
  return _deps;
}

export function getOrchestrator() { return ensureInitialized().dispatcher; }
export function getWorkOrderRepo() { return ensureInitialized().workOrderRepo; }
export function getNotificationRepo() { return ensureInitialized().notificationRepo; }
export function getERPAdapter() { return ensureInitialized().erpAdapter; }
export function getERPSyncService() { return ensureInitialized().erpSyncService; }
export function getAnalyticsService() { return ensureInitialized().analyticsService; }

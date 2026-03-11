import { randomUUID } from 'crypto';
import {
  createDispatcher,
  ERPSyncService,
  AnalyticsService,
  createLlmDependencies,
  computeCueScores,
} from '@wo-agent/core';
import type { LlmDependencies } from '@wo-agent/core';
import {
  InMemoryEventStore,
  InMemoryWorkOrderStore,
  InMemoryIdempotencyStore,
} from '@wo-agent/core';
import {
  InMemoryNotificationStore,
  InMemoryNotificationPreferenceStore,
  MockSmsSender,
  NotificationService,
} from '@wo-agent/core';
import type {
  SessionStore,
  OrchestratorDependencies,
  UnitResolver,
  SlaPolicies,
  EventRepository,
  WorkOrderRepository,
  NotificationRepository,
  NotificationPreferenceStore,
  IdempotencyStore,
  ContactExecutor,
} from '@wo-agent/core';
import type { ConversationSession } from '@wo-agent/core';
import type {
  CueDictionary,
  IssueClassifierInput,
  RiskProtocols,
  EscalationPlans,
} from '@wo-agent/schemas';
import { loadTaxonomy } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import { MockERPAdapter } from '@wo-agent/mock-erp';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };

// In-memory session store fallback
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
    const {
      createPool,
      PostgresEventStore,
      PostgresWorkOrderStore,
      PostgresSessionStore,
      PostgresNotificationStore,
      PostgresNotificationPreferenceStore,
      PostgresIdempotencyStore,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = require('@wo-agent/db');
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

// Persist singleton on globalThis so in-memory stores survive Next.js dev
// module re-evaluations and per-route webpack bundles (same pattern as Prisma).
interface FactoryDeps {
  workOrderRepo: WorkOrderRepository;
  notificationRepo: NotificationRepository;
  dispatcher: ReturnType<typeof createDispatcher>;
  erpAdapter: MockERPAdapter;
  erpSyncService: ERPSyncService;
  analyticsService: AnalyticsService;
}

const globalForFactory = globalThis as unknown as { __woAgentDeps?: FactoryDeps };

function ensureInitialized(): FactoryDeps {
  if (!globalForFactory.__woAgentDeps) {
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

    const taxonomy = loadTaxonomy();
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    let llmDeps: LlmDependencies | null = null;
    if (anthropicApiKey) {
      llmDeps = createLlmDependencies({
        apiKey: anthropicApiKey,
        taxonomy,
        defaultModel: process.env.LLM_DEFAULT_MODEL,
      });
    }

    const deps: OrchestratorDependencies = {
      eventRepo: stores.eventRepo,
      sessionStore: stores.sessionStore,
      idGenerator,
      clock,
      issueSplitter:
        llmDeps?.issueSplitter ??
        (async (input) => ({
          issues: [
            {
              issue_id: randomUUID(),
              summary: input.raw_text.slice(0, 200),
              raw_excerpt: input.raw_text,
            },
          ],
          issue_count: 1,
        })),
      issueClassifier:
        llmDeps?.issueClassifier ??
        (async (input: IssueClassifierInput) => {
          const text = `${input.issue_summary} ${input.raw_excerpt}`;
          const cueScores = computeCueScores(text, classificationCues as CueDictionary);

          // Derive classification from top cue labels, falling back to sensible defaults
          const category = cueScores['Category']?.topLabel ?? 'maintenance';
          const location = cueScores['Location']?.topLabel ?? 'suite';
          const subLocation = cueScores['Sub_Location']?.topLabel ?? 'general';
          const maintCategory =
            cueScores['Maintenance_Category']?.topLabel ?? 'general_maintenance';
          const maintObject = cueScores['Maintenance_Object']?.topLabel ?? 'other_object';
          const maintProblem = cueScores['Maintenance_Problem']?.topLabel ?? 'not_working';
          const mgmtCategory = cueScores['Management_Category']?.topLabel ?? 'other_mgmt_cat';
          const mgmtObject = cueScores['Management_Object']?.topLabel ?? 'other_mgmt_obj';
          const priority = cueScores['Priority']?.topLabel ?? 'normal';

          // Use cue score as model_confidence proxy (higher cue = more confident mock)
          const conf = (field: string) => {
            const s = cueScores[field]?.score ?? 0;
            return s > 0 ? Math.min(0.95, 0.7 + s * 0.25) : 0.5;
          };

          return {
            issue_id: input.issue_id,
            classification: {
              Category: category,
              Location: location,
              Sub_Location: subLocation,
              Maintenance_Category: maintCategory,
              Maintenance_Object: maintObject,
              Maintenance_Problem: maintProblem,
              Management_Category: category === 'management' ? mgmtCategory : 'other_mgmt_cat',
              Management_Object: category === 'management' ? mgmtObject : 'other_mgmt_obj',
              Priority: priority,
            },
            model_confidence: {
              Category: conf('Category'),
              Location: conf('Location'),
              Sub_Location: conf('Sub_Location'),
              Maintenance_Category: conf('Maintenance_Category'),
              Maintenance_Object: conf('Maintenance_Object'),
              Maintenance_Problem: conf('Maintenance_Problem'),
              Management_Category: category === 'management' ? conf('Management_Category') : 0.0,
              Management_Object: category === 'management' ? conf('Management_Object') : 0.0,
              Priority: conf('Priority'),
            },
            missing_fields: [],
            needs_human_triage: false,
          };
        }),
      followUpGenerator: llmDeps?.followUpGenerator ?? (async () => ({ questions: [] })),
      cueDict: classificationCues as CueDictionary,
      taxonomy,
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: `prop-${unitId}`,
          client_id: `client-${unitId}`,
        }),
      } satisfies UnitResolver,
      workOrderRepo: stores.workOrderRepo,
      idempotencyStore: stores.idempotencyStore,
      notificationService,
      erpAdapter,
      riskProtocols: {
        version: '1.0.0',
        triggers: [],
        mitigation_templates: [],
      } satisfies RiskProtocols,
      escalationPlans: { version: '1.0.0', plans: [] } satisfies EscalationPlans,
      contactExecutor: (async () => false) as ContactExecutor,
    };

    const analyticsService = new AnalyticsService({
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      slaPolicies: slaPoliciesJson as SlaPolicies,
      clock,
    });

    globalForFactory.__woAgentDeps = {
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      dispatcher: createDispatcher(deps),
      erpAdapter,
      erpSyncService,
      analyticsService,
    };
  }
  return globalForFactory.__woAgentDeps;
}

export function getOrchestrator() {
  return ensureInitialized().dispatcher;
}
export function getWorkOrderRepo() {
  return ensureInitialized().workOrderRepo;
}
export function getNotificationRepo() {
  return ensureInitialized().notificationRepo;
}
export function getERPAdapter() {
  return ensureInitialized().erpAdapter;
}
export function getERPSyncService() {
  return ensureInitialized().erpSyncService;
}
export function getAnalyticsService() {
  return ensureInitialized().analyticsService;
}

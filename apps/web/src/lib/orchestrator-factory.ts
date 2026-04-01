import { randomUUID } from 'crypto';
import {
  createDispatcher,
  ERPSyncService,
  AnalyticsService,
  createLlmDependencies,
  computeCueScores,
  DEFAULT_COORDINATOR_CONFIG,
  DEFAULT_ALERT_EVALUATOR_CONFIG,
  StdoutJsonLogger,
  NoopMetricsRecorder,
  NoopAlertSink,
  MisconfiguredAlertSink,
  SmsAlertSink,
  InMemoryAlertCooldownStore,
} from '@wo-agent/core';
import type {
  LlmDependencies,
  EscalationCoordinatorConfig,
  EscalationCoordinatorDeps,
  EscalationIncidentStore,
  VoiceCallProvider,
  SmsProvider,
  Logger,
  MetricsRecorder,
  MetricsQueryStore,
  AlertSink,
  AlertCooldownStore,
  AlertEvaluatorDeps,
} from '@wo-agent/core';
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
  InMemoryEscalationIncidentStore,
  MockVoiceProvider,
  MockSmsProvider,
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
import type { CueDictionary, EscalationPlans, IssueClassifierInput } from '@wo-agent/schemas';
import { loadTaxonomy, loadRiskProtocols, loadEscalationPlans } from '@wo-agent/schemas';
import classificationCues from '@wo-agent/schemas/classification_cues.json' with { type: 'json' };
import { MockERPAdapter } from '@wo-agent/mock-erp';
import slaPoliciesJson from '@wo-agent/schemas/sla_policies.json' with { type: 'json' };
import { TwilioVoiceProvider } from './emergency/twilio-voice';
import { TwilioSmsProvider } from './emergency/twilio-sms';
import {
  createDemoSplitter,
  createDemoClassifier,
  createDemoFollowupGenerator,
} from './demo-fixtures';
import { getDatabaseUrl } from './database-url';

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
  escalationIncidentStore: EscalationIncidentStore;
  metricsRecorder: MetricsRecorder;
}

interface PersistentFactoryState {
  stores: Stores;
  erpAdapter: MockERPAdapter;
}

function createStores(): Stores {
  const databaseUrl = getDatabaseUrl();

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
      PostgresEscalationIncidentStore,
      PgOperationalMetricsStore,
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
      escalationIncidentStore: new PostgresEscalationIncidentStore(pool),
      metricsRecorder: new PgOperationalMetricsStore(pool),
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
    escalationIncidentStore: new InMemoryEscalationIncidentStore(),
    metricsRecorder: new NoopMetricsRecorder(),
  };
}

// --- Escalation provider/config construction ---

/**
 * Returns true if Twilio credentials are fully configured.
 * When EMERGENCY_ROUTING_ENABLED=true, these MUST be present for real delivery.
 */
function hasTwilioCredentials(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  );
}

/**
 * Create voice provider. Returns real Twilio provider when credentials are set,
 * mock provider for dev/test when routing is disabled, or undefined when
 * routing is enabled but credentials are missing (fail-closed).
 */
function createVoiceProvider(routingEnabled: boolean): VoiceCallProvider | undefined {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (sid && token && from) {
    return new TwilioVoiceProvider({ accountSid: sid, authToken: token, fromNumber: from });
  }
  if (routingEnabled) {
    // Routing is ON but Twilio is not configured — fail-closed, no mock fallback
    console.error(
      '[orchestrator-factory] EMERGENCY_ROUTING_ENABLED=true but TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER are missing. Voice provider will not be injected.',
    );
    return undefined;
  }
  // Dev/test fallback — recorded for tests, no real calls
  return new MockVoiceProvider();
}

/**
 * Create SMS provider. Same fail-closed logic as voice.
 */
function createSmsProvider(routingEnabled: boolean): SmsProvider | undefined {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (sid && token && from) {
    return new TwilioSmsProvider({ accountSid: sid, authToken: token, fromNumber: from });
  }
  if (routingEnabled) {
    console.error(
      '[orchestrator-factory] EMERGENCY_ROUTING_ENABLED=true but TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER are missing. SMS provider will not be injected.',
    );
    return undefined;
  }
  return new MockSmsProvider();
}

function createEscalationConfig(): EscalationCoordinatorConfig {
  return {
    maxCyclesDefault: parseInt(process.env.EMERGENCY_MAX_CYCLES_DEFAULT ?? '3', 10),
    callTimeoutSeconds: parseInt(process.env.EMERGENCY_CALL_TIMEOUT_SECONDS ?? '60', 10),
    smsReplyTimeoutSeconds: parseInt(process.env.EMERGENCY_SMS_REPLY_TIMEOUT_SECONDS ?? '120', 10),
    outboundFromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
    internalAlertNumber: process.env.EMERGENCY_INTERNAL_ALERT_NUMBER ?? '',
    webhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL ?? '',
    emergencyRoutingEnabled: process.env.EMERGENCY_ROUTING_ENABLED === 'true',
    processingLockDurationMs: DEFAULT_COORDINATOR_CONFIG.processingLockDurationMs,
  };
}

/**
 * Create UnitResolver. Gated on USE_DEMO_UNIT_RESOLVER:
 *
 * - USE_DEMO_UNIT_RESOLVER=true: Demo stub that returns DEMO_BUILDING_ID
 *   (default 'example-building-001') for every unit. Must match a building_id
 *   in emergency_escalation_plans.json for emergency routing to work.
 *
 * - USE_DEMO_UNIT_RESOLVER absent or not 'true': Fail-closed — returns null
 *   for every unit until a real DB-backed resolver is implemented. SELECT_UNIT
 *   will reject with UNIT_NOT_FOUND, making the gap explicit.
 */
export function createUnitResolver(escalationPlans: EscalationPlans): UnitResolver {
  if (process.env.USE_DEMO_UNIT_RESOLVER !== 'true') {
    return {
      resolve: async () => null,
    };
  }

  const demoBuildingId = process.env.DEMO_BUILDING_ID ?? 'example-building-001';
  const hasMatchingPlan = escalationPlans.plans.some((p) => p.building_id === demoBuildingId);
  if (!hasMatchingPlan) {
    console.warn(
      `[orchestrator-factory] DEMO_BUILDING_ID="${demoBuildingId}" does not match any ` +
        `building_id in emergency_escalation_plans.json. Emergency escalation will return ` +
        `NO_ESCALATION_PLAN for all conversations. Valid values: ` +
        `${escalationPlans.plans.map((p) => p.building_id).join(', ')}`,
    );
  }

  return {
    resolve: async (unitId: string) => ({
      unit_id: unitId,
      property_id: `prop-${unitId}`,
      client_id: `client-${unitId}`,
      building_id: demoBuildingId,
    }),
  };
}

// Persist singleton on globalThis so in-memory stores survive Next.js dev
// module re-evaluations and per-route webpack bundles (same pattern as Prisma).
interface FactoryDeps {
  eventRepo: EventRepository;
  workOrderRepo: WorkOrderRepository;
  notificationRepo: NotificationRepository;
  sessionStore: SessionStore;
  dispatcher: ReturnType<typeof createDispatcher>;
  erpAdapter: MockERPAdapter;
  erpSyncService: ERPSyncService;
  analyticsService: AnalyticsService;
  escalationIncidentStore: EscalationIncidentStore;
  escalationPlans: EscalationPlans;
  voiceProvider: VoiceCallProvider | undefined;
  smsProvider: SmsProvider | undefined;
  escalationConfig: EscalationCoordinatorConfig;
  idGenerator: () => string;
  clock: () => string;
  logger: Logger;
  metricsRecorder: MetricsRecorder;
  alertSink: AlertSink;
}

const globalForFactory = globalThis as unknown as {
  __woAgentDeps?: FactoryDeps;
  __woAgentPersistent?: PersistentFactoryState;
};

function getPersistentFactoryState(): PersistentFactoryState {
  if (!globalForFactory.__woAgentPersistent) {
    globalForFactory.__woAgentPersistent = {
      stores: createStores(),
      erpAdapter: new MockERPAdapter(),
    };
  }

  return globalForFactory.__woAgentPersistent;
}

function ensureInitialized(): FactoryDeps {
  const useRuntimeCache = process.env.NODE_ENV === 'production';
  if (!useRuntimeCache || !globalForFactory.__woAgentDeps) {
    const { stores, erpAdapter } = getPersistentFactoryState();
    const smsSender = new MockSmsSender();
    const idGenerator = () => randomUUID();
    const clock = () => new Date().toISOString();

    // Observability sinks — must be created before NotificationService and LLM deps
    const logger: Logger = new StdoutJsonLogger();
    const metricsRecorder: MetricsRecorder = stores.metricsRecorder;

    // Alert sink: only use SmsAlertSink when OPS_ALERT_PHONE_NUMBERS is set
    // AND real Twilio credentials are available (Finding 3: no silent mock fallback)
    const opsPhoneNumbers = process.env.OPS_ALERT_PHONE_NUMBERS;
    let alertSink: AlertSink = new NoopAlertSink();
    if (opsPhoneNumbers) {
      if (hasTwilioCredentials()) {
        const smsProviderForAlerts = createSmsProvider(true)!;
        alertSink = new SmsAlertSink({
          smsProvider: smsProviderForAlerts,
          phoneNumbers: opsPhoneNumbers.split(',').map((p) => p.trim()),
          logger,
          metricsRecorder,
          clock,
        });
      } else {
        console.warn(
          '[orchestrator-factory] OPS_ALERT_PHONE_NUMBERS is set but Twilio credentials are missing. ' +
            'Alert evaluator will report delivery failures every cycle. Set TWILIO_ACCOUNT_SID, ' +
            'TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable SMS alerting.',
        );
        alertSink = new MisconfiguredAlertSink(logger);
      }
    }

    const notificationService = new NotificationService({
      notificationRepo: stores.notificationRepo,
      preferenceStore: stores.prefStore,
      smsSender,
      idGenerator,
      clock,
      metricsRecorder,
    });

    const erpSyncService = new ERPSyncService({
      erpAdapter,
      workOrderRepo: stores.workOrderRepo,
      idGenerator,
      clock,
    });

    const taxonomy = loadTaxonomy();

    // --- LLM dependency resolution (3-way priority) ---
    // 1. USE_DEMO_FIXTURES=true → deterministic demo fixtures (global, all routes)
    // 2. ANTHROPIC_API_KEY set  → real LLM adapters
    // 3. Neither                → simple cue-based stubs
    const useDemoFixtures = process.env.USE_DEMO_FIXTURES === 'true';
    const demoFixtureSplitter = useDemoFixtures ? createDemoSplitter() : null;
    const demoFixtureClassifier = useDemoFixtures ? createDemoClassifier() : null;
    const demoFixtureFollowup = useDemoFixtures ? createDemoFollowupGenerator() : null;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

    let llmDeps: LlmDependencies | null = null;
    if (!useDemoFixtures && anthropicApiKey) {
      llmDeps = createLlmDependencies({
        apiKey: anthropicApiKey,
        taxonomy,
        defaultModel: process.env.LLM_DEFAULT_MODEL,
        logger,
        metricsRecorder,
      });
    }

    const escalationPlans = loadEscalationPlans();
    const escalationIncidentStore = stores.escalationIncidentStore;
    const escalationConfig = createEscalationConfig();

    const unitResolver = createUnitResolver(escalationPlans);
    const routingEnabled = escalationConfig.emergencyRoutingEnabled;
    const voiceProvider = createVoiceProvider(routingEnabled);
    const smsProvider = createSmsProvider(routingEnabled);

    const deps: OrchestratorDependencies = {
      eventRepo: stores.eventRepo,
      sessionStore: stores.sessionStore,
      idGenerator,
      clock,
      issueSplitter: useDemoFixtures
        ? demoFixtureSplitter!
        : (llmDeps?.issueSplitter ??
          (async (input) => ({
            issues: [
              {
                issue_id: randomUUID(),
                summary: input.raw_text.slice(0, 200),
                raw_excerpt: input.raw_text,
              },
            ],
            issue_count: 1,
          }))),
      issueClassifier: useDemoFixtures
        ? demoFixtureClassifier!
        : (llmDeps?.issueClassifier ??
          (async (input: IssueClassifierInput) => {
            const text = `${input.issue_summary} ${input.raw_excerpt}`;
            const cueScores = computeCueScores(text, classificationCues as CueDictionary);

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
          })),
      followUpGenerator: useDemoFixtures
        ? demoFixtureFollowup!
        : (llmDeps?.followUpGenerator ?? (async () => ({ questions: [] }))),
      messageDisambiguator: llmDeps?.messageDisambiguator,
      cueDict: classificationCues as CueDictionary,
      taxonomy,
      unitResolver,
      workOrderRepo: stores.workOrderRepo,
      idempotencyStore: stores.idempotencyStore,
      notificationService,
      erpAdapter,
      riskProtocols: loadRiskProtocols(),
      escalationPlans,
      escalationIncidentStore,
      emergencyRoutingEnabled: escalationConfig.emergencyRoutingEnabled,
      voiceProvider,
      smsProvider,
      escalationConfig,
      contactExecutor: (async () => false) as ContactExecutor,
      logger,
      metricsRecorder,
      alertSink,
      modelId: process.env.LLM_DEFAULT_MODEL,
    };

    const analyticsService = new AnalyticsService({
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      slaPolicies: slaPoliciesJson as SlaPolicies,
      clock,
    });

    const runtimeDeps: FactoryDeps = {
      eventRepo: stores.eventRepo,
      workOrderRepo: stores.workOrderRepo,
      notificationRepo: stores.notificationRepo,
      sessionStore: stores.sessionStore,
      dispatcher: createDispatcher(deps),
      erpAdapter,
      erpSyncService,
      analyticsService,
      escalationIncidentStore,
      escalationPlans,
      voiceProvider,
      smsProvider,
      escalationConfig,
      idGenerator,
      clock,
      logger,
      metricsRecorder,
      alertSink,
    };

    // In development, rebuild runtime dependencies on every access so changes in
    // handlers/prompts/core imports are picked up without losing in-memory stores.
    if (useRuntimeCache) {
      globalForFactory.__woAgentDeps = runtimeDeps;
    }

    return runtimeDeps;
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
export function getSessionStore() {
  return ensureInitialized().sessionStore;
}
export function getAnalyticsService() {
  return ensureInitialized().analyticsService;
}
export function getEscalationIncidentStore() {
  return ensureInitialized().escalationIncidentStore;
}
export function getEscalationPlans() {
  return ensureInitialized().escalationPlans;
}

/**
 * Build EscalationCoordinatorDeps for use by webhook routes and cron handlers.
 * These deps are for async escalation processing that happens outside the
 * normal dispatcher flow (Twilio callbacks, cron-driven timeouts).
 *
 * Returns null if providers are not configured (fail-closed).
 */
export function getEscalationCoordinatorDeps(): EscalationCoordinatorDeps | null {
  const d = ensureInitialized();
  if (!d.voiceProvider || !d.smsProvider) {
    return null;
  }
  return {
    incidentStore: d.escalationIncidentStore,
    voiceProvider: d.voiceProvider,
    smsProvider: d.smsProvider,
    config: d.escalationConfig,
    idGenerator: d.idGenerator,
    clock: d.clock,
    logger: d.logger,
    metricsRecorder: d.metricsRecorder,
    alertSink: d.alertSink,
    writeRiskEvent: async (event) => {
      await d.eventRepo.insert(event);
    },
  };
}

/**
 * Build AlertEvaluatorDeps for the observability cron route.
 * Returns null if DATABASE_URL is not set (no metrics to query).
 */
export function getAlertEvaluatorDeps(): AlertEvaluatorDeps | null {
  const d = ensureInitialized();

  // metricsRecorder must also implement MetricsQueryStore for windowed queries.
  // PgOperationalMetricsStore implements both; NoopMetricsRecorder does not.
  const metricsQuery = d.metricsRecorder as MetricsRecorder & Partial<MetricsQueryStore>;
  if (!metricsQuery.queryWindow || !metricsQuery.queryCount) {
    return null; // no DB → no queryable metrics
  }

  // Alert cooldown: use DB store if available, otherwise in-memory
  let cooldownStore: AlertCooldownStore;
  const databaseUrl = getDatabaseUrl();
  if (databaseUrl) {
    const { createPool, PgAlertCooldownStore } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@wo-agent/db');
    const pool = createPool(databaseUrl);
    cooldownStore = new PgAlertCooldownStore(pool);
  } else {
    cooldownStore = new InMemoryAlertCooldownStore();
  }

  return {
    metricsQuery: metricsQuery as MetricsQueryStore,
    escalationIncidentStore: d.escalationIncidentStore,
    alertSink: d.alertSink,
    cooldownStore,
    logger: d.logger,
    config: {
      llmErrorSpikeThreshold: parseInt(
        process.env.ALERT_LLM_ERROR_SPIKE_THRESHOLD ??
          String(DEFAULT_ALERT_EVALUATOR_CONFIG.llmErrorSpikeThreshold),
        10,
      ),
      schemaFailureSpikeThreshold: parseInt(
        process.env.ALERT_SCHEMA_FAILURE_SPIKE_THRESHOLD ??
          String(DEFAULT_ALERT_EVALUATOR_CONFIG.schemaFailureSpikeThreshold),
        10,
      ),
      asyncBacklogThreshold: parseInt(
        process.env.ALERT_ASYNC_BACKLOG_THRESHOLD ??
          String(DEFAULT_ALERT_EVALUATOR_CONFIG.asyncBacklogThreshold),
        10,
      ),
      cooldownMinutes: parseInt(
        process.env.ALERT_COOLDOWN_MINUTES ??
          String(DEFAULT_ALERT_EVALUATOR_CONFIG.cooldownMinutes),
        10,
      ),
      windowMinutes: DEFAULT_ALERT_EVALUATOR_CONFIG.windowMinutes,
    },
  };
}

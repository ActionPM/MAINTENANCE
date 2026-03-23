/**
 * Integration test: full observability stack (spec §25).
 * Verifies that structured logging, metrics, and alerts flow end-to-end
 * through dispatcher → action handlers → LLM wrappers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ActionType, ActorType, ConversationState, loadTaxonomy } from '@wo-agent/schemas';
import type { AuthContext, CueDictionary } from '@wo-agent/schemas';
import { createDispatcher } from '../../orchestrator/dispatcher.js';
import { InMemoryEventStore } from '../../events/in-memory-event-store.js';
import type { OrchestratorDependencies, SessionStore } from '../../orchestrator/types.js';
import type { ConversationSession } from '../../session/types.js';
import { InMemoryWorkOrderStore } from '../../work-order/in-memory-wo-store.js';
import { InMemoryIdempotencyStore } from '../../idempotency/in-memory-idempotency-store.js';
import {
  InMemoryLogger,
  InMemoryMetricsRecorder,
  NoopAlertSink,
} from '../../observability/index.js';
import { withObservedLlmCall } from '../../llm/with-observed-llm-call.js';

const taxonomy = loadTaxonomy();
const MINI_CUES: CueDictionary = {
  version: '1.0.0',
  fields: {
    Maintenance_Category: {
      plumbing: { keywords: ['leak'], regex: [] },
    },
  },
};

const testVersions = {
  taxonomy_version: '1.0.0',
  schema_version: '1.0.0',
  model_id: 'default',
  prompt_version: '1.0.0',
      cue_version: '1.2.0',
};

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

const AUTH: AuthContext = {
  tenant_user_id: 'user-1',
  tenant_account_id: 'acct-1',
  authorized_unit_ids: ['unit-1'],
};

describe('Observability E2E', () => {
  let logger: InMemoryLogger;
  let metrics: InMemoryMetricsRecorder;
  let dispatch: ReturnType<typeof createDispatcher>;

  beforeEach(() => {
    logger = new InMemoryLogger();
    metrics = new InMemoryMetricsRecorder();
    let idCounter = 0;

    const deps: OrchestratorDependencies = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => `id-${++idCounter}`,
      clock: () => '2026-03-12T12:00:00.000Z',
      issueSplitter: async (input) => ({
        issues: [
          { issue_id: 'iss-1', summary: input.raw_text.slice(0, 50), raw_excerpt: input.raw_text },
        ],
        issue_count: 1,
      }),
      issueClassifier: async () => ({
        issue_id: 'iss-1',
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leaking',
          Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj',
          Priority: 'normal',
        },
        model_confidence: {
          Category: 0.95,
          Location: 0.9,
          Sub_Location: 0.85,
          Maintenance_Category: 0.9,
          Maintenance_Object: 0.85,
          Maintenance_Problem: 0.9,
          Management_Category: 0,
          Management_Object: 0,
          Priority: 0.8,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: MINI_CUES,
      taxonomy,
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: 'prop-1',
          client_id: 'client-1',
          building_id: 'bldg-1',
        }),
      },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      notificationService: {
        notifyWorkOrdersCreated: async () => ({ in_app_sent: true, sms_sent: false }),
      } as any,
      erpAdapter: {
        createWorkOrder: async () => ({ success: true, external_id: 'ext-1' }),
        getWorkOrderStatus: async () => ({ status: 'open' }),
        getStatusChanges: async () => [],
      } as any,
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      escalationIncidentStore: {
        create: async () => true,
        getById: async () => null,
        getActiveByConversation: async () => null,
        getDueIncidents: async () => [],
        getActiveByContactedPhone: async () => [],
        update: async () => true,
        countOverdue: async () => 0,
      },
      emergencyRoutingEnabled: false,
      contactExecutor: async () => false,
      logger,
      metricsRecorder: metrics,
      alertSink: new NoopAlertSink(),
    };

    dispatch = createDispatcher(deps);
  });

  it('emits structured logs for dispatcher actions', async () => {
    const result = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    expect(result.response.conversation_snapshot.state).toBe(ConversationState.UNIT_SELECTED);

    // Check that dispatcher logged action_received and action_completed
    const received = logger.entries.find((e) => e.event === 'action_received');
    expect(received).toBeDefined();
    expect(received!.action_type).toBe(ActionType.CREATE_CONVERSATION);
    expect(received!.request_id).toBeDefined();

    const completed = logger.entries.find((e) => e.event === 'action_completed');
    expect(completed).toBeDefined();
    expect(completed!.duration_ms).toBeTypeOf('number');
  });

  it('records orchestrator latency metric', async () => {
    await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });

    const latencyObs = metrics.observations.find(
      (o) => o.metric_name === 'orchestrator_action_latency_ms',
    );
    expect(latencyObs).toBeDefined();
    expect(latencyObs!.action_type).toBe(ActionType.CREATE_CONVERSATION);
  });

  it('logs and records metrics through multi-step conversation', async () => {
    // Create conversation — single-unit auto-resolves to unit_selected
    const createResult = await dispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    // Submit initial message (triggers split + classification via auto-chain)
    // SELECT_UNIT skipped — already unit_selected from single-unit auto-resolve
    await dispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'Toilet is leaking in the bathroom' },
      auth_context: AUTH,
    });

    // Should have multiple action logs (CREATE + SUBMIT + auto-chained system events)
    const actionLogs = logger.entries.filter((e) => e.event === 'action_completed');
    expect(actionLogs.length).toBeGreaterThanOrEqual(2);

    // Should have multiple latency metrics
    const latencyMetrics = metrics.observations.filter(
      (o) => o.metric_name === 'orchestrator_action_latency_ms',
    );
    expect(latencyMetrics.length).toBeGreaterThanOrEqual(2);
  });

  it('correlates dispatcher request_id with downstream llm_call_* logs', async () => {
    // Rebuild dispatcher with observed splitter to prove cross-hop correlation
    const observedLogger = new InMemoryLogger();
    const observedMetrics = new InMemoryMetricsRecorder();
    let idCounter = 0;

    const rawSplitter = async (input: { raw_text: string }) => ({
      issues: [
        { issue_id: 'iss-1', summary: input.raw_text.slice(0, 50), raw_excerpt: input.raw_text },
      ],
      issue_count: 1,
    });

    // Wrap with withObservedLlmCall so llm_call_* logs are emitted
    const observedSplitter = withObservedLlmCall(
      rawSplitter,
      observedLogger,
      observedMetrics,
      'issue_splitter',
    );

    const deps: OrchestratorDependencies = {
      eventRepo: new InMemoryEventStore(),
      sessionStore: new InMemorySessionStore(),
      idGenerator: () => `id-${++idCounter}`,
      clock: () => '2026-03-12T12:00:00.000Z',
      issueSplitter: observedSplitter as any,
      issueClassifier: async () => ({
        issue_id: 'iss-1',
        classification: {
          Category: 'maintenance',
          Location: 'suite',
          Sub_Location: 'bathroom',
          Maintenance_Category: 'plumbing',
          Maintenance_Object: 'toilet',
          Maintenance_Problem: 'leaking',
          Management_Category: 'other_mgmt_cat',
          Management_Object: 'other_mgmt_obj',
          Priority: 'normal',
        },
        model_confidence: {
          Category: 0.95,
          Location: 0.9,
          Sub_Location: 0.85,
          Maintenance_Category: 0.9,
          Maintenance_Object: 0.85,
          Maintenance_Problem: 0.9,
          Management_Category: 0,
          Management_Object: 0,
          Priority: 0.8,
        },
        missing_fields: [],
        needs_human_triage: false,
      }),
      followUpGenerator: async () => ({ questions: [] }),
      cueDict: MINI_CUES,
      taxonomy,
      unitResolver: {
        resolve: async (unitId: string) => ({
          unit_id: unitId,
          property_id: 'prop-1',
          client_id: 'client-1',
          building_id: 'bldg-1',
        }),
      },
      workOrderRepo: new InMemoryWorkOrderStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      notificationService: {
        notifyWorkOrdersCreated: async () => ({ in_app_sent: true, sms_sent: false }),
      } as any,
      erpAdapter: {
        createWorkOrder: async () => ({ success: true, external_id: 'ext-1' }),
        getWorkOrderStatus: async () => ({ status: 'open' }),
        getStatusChanges: async () => [],
      } as any,
      riskProtocols: { version: '1.0.0', triggers: [], mitigation_templates: [] },
      escalationPlans: { version: '1.0.0', plans: [] },
      escalationIncidentStore: {
        create: async () => true,
        getById: async () => null,
        getActiveByConversation: async () => null,
        getDueIncidents: async () => [],
        getActiveByContactedPhone: async () => [],
        update: async () => true,
        countOverdue: async () => 0,
      },
      emergencyRoutingEnabled: false,
      contactExecutor: async () => false,
      logger: observedLogger,
      metricsRecorder: observedMetrics,
      alertSink: new NoopAlertSink(),
    };

    const observedDispatch = createDispatcher(deps);

    // Drive through to split: CREATE → SUBMIT_INITIAL_MESSAGE (single-unit auto-resolves)
    const createResult = await observedDispatch({
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: AUTH,
    });
    const convId = createResult.response.conversation_snapshot.conversation_id;

    await observedDispatch({
      conversation_id: convId,
      action_type: ActionType.SUBMIT_INITIAL_MESSAGE,
      actor: ActorType.TENANT,
      tenant_input: { message: 'Toilet is leaking in the bathroom' },
      auth_context: AUTH,
    });

    // The SUBMIT_INITIAL_MESSAGE dispatcher call generates a request_id that should
    // propagate through to the llm_call_* log entries emitted by the observed splitter.

    // Find the dispatcher's action_received log for SUBMIT_INITIAL_MESSAGE
    const submitReceived = observedLogger.entries.find(
      (e) => e.event === 'action_received' && e.action_type === ActionType.SUBMIT_INITIAL_MESSAGE,
    );
    expect(submitReceived).toBeDefined();
    const dispatcherRequestId = submitReceived!.request_id;
    expect(dispatcherRequestId).toBeDefined();
    expect(typeof dispatcherRequestId).toBe('string');

    // Find llm_call_started and llm_call_completed for issue_splitter
    const llmStarted = observedLogger.entries.find(
      (e) => e.event === 'llm_call_started' && e.tool_name === 'issue_splitter',
    );
    const llmCompleted = observedLogger.entries.find(
      (e) => e.event === 'llm_call_completed' && e.tool_name === 'issue_splitter',
    );

    expect(llmStarted).toBeDefined();
    expect(llmCompleted).toBeDefined();

    // THE KEY ASSERTION: dispatcher request_id matches the llm_call request_id
    expect(llmStarted!.request_id).toBe(dispatcherRequestId);
    expect(llmCompleted!.request_id).toBe(dispatcherRequestId);

    // Also verify the metric recorded by withObservedLlmCall carries the same request_id
    const llmLatencyMetric = observedMetrics.observations.find(
      (o) => o.metric_name === 'llm_call_latency_ms' && o.component === 'issue_splitter',
    );
    expect(llmLatencyMetric).toBeDefined();
    expect(llmLatencyMetric!.request_id).toBe(dispatcherRequestId);
  });
});

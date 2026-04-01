import { describe, it, expect } from 'vitest';

// Test that everything imports cleanly from the barrel
import {
  // Taxonomy
  taxonomy,
  loadTaxonomy,
  isTaxonomyValue,
  TAXONOMY_FIELD_NAMES,
  MAINTENANCE_FIELDS,
  MANAGEMENT_FIELDS,

  // Enums
  ConversationState,
  ALL_CONVERSATION_STATES,
  RESUMABLE_STATES,
  WorkOrderStatus,
  ALL_WORK_ORDER_STATUSES,
  ActionType,
  ALL_ACTION_TYPES,
  ActorType,
  ALL_ACTOR_TYPES,

  // Config
  DEFAULT_RATE_LIMITS,
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_FOLLOWUP_CAPS,

  // Validators
  validate,
  validateOrchestratorActionRequest,
  validateOrchestratorActionResponse,
  validateIssueSplitterOutput,
  validateClassifierOutput,
  validateFollowUpOutput,
  validateFollowUpEvent,
  validateWorkOrder,
  validatePhoto,
  validateClassificationAgainstTaxonomy,
  validateCueDictionary,
} from '../index.js';

import type {
  Taxonomy,
  TaxonomyFieldName,
  PinnedVersions,
  RateLimitConfig,
  ConfidenceConfig,
  FollowUpCaps,
  OrchestratorActionRequest,
  OrchestratorActionResponse,
  IssueSplitterOutput,
  IssueClassifierOutput,
  FollowUpGeneratorOutput,
  WorkOrder,
  Photo,
  ValidationResult,
  DomainValidationResult,
  CueDictionary,
} from '../index.js';

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '..', '..');

function uuid(): string {
  return 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
}

function sha256(): string {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}

const NOW = '2026-02-23T12:00:00.000Z';

describe('Integration — barrel import', () => {
  it('all exports are defined', () => {
    // Values
    expect(taxonomy).toBeDefined();
    expect(loadTaxonomy).toBeTypeOf('function');
    expect(isTaxonomyValue).toBeTypeOf('function');
    expect(TAXONOMY_FIELD_NAMES).toHaveLength(9);
    expect(MAINTENANCE_FIELDS).toHaveLength(3);
    expect(MANAGEMENT_FIELDS).toHaveLength(2);
    expect(ALL_CONVERSATION_STATES).toHaveLength(14);
    expect(RESUMABLE_STATES.size).toBe(7);
    expect(ALL_WORK_ORDER_STATUSES).toHaveLength(5);
    expect(ALL_ACTION_TYPES).toHaveLength(17);
    expect(ALL_ACTOR_TYPES).toHaveLength(4);
    expect(DEFAULT_RATE_LIMITS).toBeDefined();
    expect(DEFAULT_CONFIDENCE_CONFIG).toBeDefined();
    expect(DEFAULT_FOLLOWUP_CAPS).toBeDefined();

    // Validators
    expect(validate).toBeTypeOf('function');
    expect(validateOrchestratorActionRequest).toBeTypeOf('function');
    expect(validateOrchestratorActionResponse).toBeTypeOf('function');
    expect(validateIssueSplitterOutput).toBeTypeOf('function');
    expect(validateClassifierOutput).toBeTypeOf('function');
    expect(validateFollowUpOutput).toBeTypeOf('function');
    expect(validateFollowUpEvent).toBeTypeOf('function');
    expect(validateWorkOrder).toBeTypeOf('function');
    expect(validatePhoto).toBeTypeOf('function');
    expect(validateClassificationAgainstTaxonomy).toBeTypeOf('function');
    expect(validateCueDictionary).toBeTypeOf('function');
  });
});

describe('Integration — round-trip: build valid data, validate, access typed result', () => {
  it('OrchestratorActionRequest → validate → typed access', () => {
    const req: OrchestratorActionRequest = {
      conversation_id: null,
      action_type: ActionType.CREATE_CONVERSATION,
      actor: ActorType.TENANT,
      tenant_input: {},
      auth_context: {
        tenant_user_id: uuid(),
        tenant_account_id: uuid(),
        authorized_unit_ids: [uuid()],
      },
    };
    const result = validateOrchestratorActionRequest(req);
    expect(result.valid).toBe(true);
    expect(result.data?.action_type).toBe('CREATE_CONVERSATION');
    expect(result.data?.actor).toBe('tenant');
  });

  it('OrchestratorActionResponse → validate → typed access', () => {
    const resp: OrchestratorActionResponse = {
      conversation_snapshot: {
        conversation_id: uuid(),
        state: ConversationState.INTAKE_STARTED,
        pinned_versions: {
          taxonomy_version: '1.0.0',
          schema_version: '1.0.0',
          model_id: 'claude-sonnet-4-6',
          prompt_version: '1.0.0',
          cue_version: '1.2.0',
        },
      },
      ui_directive: {
        messages: [{ role: 'agent', content: 'How can I help?', timestamp: NOW }],
      },
      artifacts: [],
      pending_side_effects: [],
      errors: [],
    };
    const result = validateOrchestratorActionResponse(resp);
    expect(result.valid).toBe(true);
    expect(result.data?.conversation_snapshot.state).toBe('intake_started');
  });

  it('IssueSplitterOutput → validate → typed access', () => {
    const split: IssueSplitterOutput = {
      issues: [
        { issue_id: 'i-1', summary: 'Leaking toilet', raw_excerpt: 'toilet is leaking' },
        { issue_id: 'i-2', summary: 'Broken light', raw_excerpt: 'light in kitchen broken' },
      ],
      issue_count: 2,
    };
    const result = validateIssueSplitterOutput(split);
    expect(result.valid).toBe(true);
    expect(result.data?.issues).toHaveLength(2);
    expect(result.data?.issue_count).toBe(2);
  });

  it('IssueClassifierOutput → schema validate → taxonomy cross-validate', () => {
    const output: IssueClassifierOutput = {
      issue_id: 'i-1',
      classification: {
        Category: 'maintenance',
        Location: 'suite',
        Sub_Location: 'bathroom',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
      },
      model_confidence: {
        Category: 0.95,
        Location: 0.9,
        Sub_Location: 0.8,
        Maintenance_Category: 0.92,
        Maintenance_Object: 0.88,
        Maintenance_Problem: 0.91,
      },
      missing_fields: [],
      needs_human_triage: false,
    };

    // Schema validation
    const schemaResult = validateClassifierOutput(output);
    expect(schemaResult.valid).toBe(true);

    // Domain validation — taxonomy cross-check
    const domainResult = validateClassificationAgainstTaxonomy(output.classification, taxonomy);
    expect(domainResult.valid).toBe(true);
    expect(domainResult.contradictory).toBe(false);
  });

  it('WorkOrder → validate → typed access', () => {
    const wo: WorkOrder = {
      work_order_id: uuid(),
      issue_group_id: uuid(),
      issue_id: uuid(),
      conversation_id: uuid(),
      client_id: uuid(),
      property_id: uuid(),
      unit_id: uuid(),
      tenant_user_id: uuid(),
      tenant_account_id: uuid(),
      status: WorkOrderStatus.CREATED,
      status_history: [
        { status: WorkOrderStatus.CREATED, changed_at: NOW, actor: ActorType.SYSTEM },
      ],
      raw_text: 'My toilet is leaking badly',
      summary_confirmed: 'Leaking toilet in bathroom',
      photos: [],
      classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
      confidence_by_field: { Category: 0.95, Maintenance_Category: 0.88 },
      missing_fields: [],
      pets_present: 'unknown',
      needs_human_triage: false,
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'claude-sonnet-4-6',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
      created_at: NOW,
      updated_at: NOW,
      row_version: 1,
    };
    const result = validateWorkOrder(wo);
    expect(result.valid).toBe(true);
    expect(result.data?.status).toBe('created');
    expect(result.data?.row_version).toBe(1);
  });

  it('cue dictionary loads and validates against taxonomy', () => {
    const raw = readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8');
    const cues: CueDictionary = JSON.parse(raw);
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(true);
  });
});

describe('Integration — all 12 schema/config JSON files exist', () => {
  const schemaFiles = [
    'taxonomy.json',
    'taxonomy-classification.generated.schema.json',
    'orchestrator_action.schema.json',
    'issue_split.schema.json',
    'classification.schema.json',
    'followup_request.schema.json',
    'followups.schema.json',
    'work_order.schema.json',
    'photo.schema.json',
    'risk_protocols.json',
    'emergency_escalation_plans.json',
    'sla_policies.json',
    'classification_cues.json',
  ];

  for (const file of schemaFiles) {
    it(`${file} exists and is valid JSON`, () => {
      const content = readFileSync(resolve(schemasDir, file), 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });
  }
});

describe('Integration — config JSON content validation', () => {
  it('risk_protocols.json has triggers and mitigation_templates', () => {
    const raw = JSON.parse(readFileSync(resolve(schemasDir, 'risk_protocols.json'), 'utf-8'));
    expect(raw.version).toBe('1.1.0');
    expect(raw.triggers.length).toBeGreaterThan(0);
    expect(raw.mitigation_templates.length).toBeGreaterThan(0);
    for (const trigger of raw.triggers) {
      expect(trigger.trigger_id).toBeDefined();
      expect(trigger.grammar).toBeDefined();
      expect(typeof trigger.requires_confirmation).toBe('boolean');
      expect(['emergency', 'high', 'medium']).toContain(trigger.severity);
    }
  });

  it('emergency_escalation_plans.json has valid contact chain', () => {
    const raw = JSON.parse(
      readFileSync(resolve(schemasDir, 'emergency_escalation_plans.json'), 'utf-8'),
    );
    expect(raw.version).toBe('1.0.0');
    expect(raw.plans.length).toBeGreaterThan(0);
    const plan = raw.plans[0];
    expect(plan.contact_chain).toHaveLength(4);
    const roles = plan.contact_chain.map((c: { role: string }) => c.role);
    expect(roles).toEqual([
      'building_manager',
      'property_manager',
      'senior_property_manager',
      'fallback_after_hours',
    ]);
    expect(plan.exhaustion_behavior).toBeDefined();
    expect(plan.exhaustion_behavior.internal_alert).toBe(true);
  });

  it('sla_policies.json covers all Priority values', () => {
    const raw = JSON.parse(readFileSync(resolve(schemasDir, 'sla_policies.json'), 'utf-8'));
    const priorities = ['emergency', 'high', 'normal', 'low'];
    for (const p of priorities) {
      expect(raw.client_defaults[p]).toBeDefined();
      expect(raw.client_defaults[p].response_hours).toBeGreaterThan(0);
      expect(raw.client_defaults[p].resolution_hours).toBeGreaterThan(0);
    }
  });
});

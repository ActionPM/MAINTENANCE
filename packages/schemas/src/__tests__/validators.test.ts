import { describe, it, expect } from 'vitest';
import { validate } from '../validator.js';
import {
  validateOrchestratorActionRequest,
  validateOrchestratorActionResponse,
} from '../validators/orchestrator-action.js';
import { validateIssueSplitterOutput } from '../validators/issue-split.js';
import { validateClassifierOutput } from '../validators/classification.js';
import {
  validateFollowUpInput,
  validateFollowUpOutput,
  validateFollowUpEvent,
} from '../validators/followups.js';
import { validateWorkOrder } from '../validators/work-order.js';
import { validatePhoto } from '../validators/photo.js';
import { validateClassificationAgainstTaxonomy } from '../validators/taxonomy-cross-validator.js';
import { validateCueDictionary } from '../validators/cue-dictionary-validator.js';
import { validateOrchestratorActionDomain } from '../validators/orchestrator-action-domain.js';
import { validateIssueSplitDomain } from '../validators/issue-split-domain.js';
import { validateDisambiguatorOutput } from '../validators/disambiguator.js';
import { taxonomy } from '../taxonomy.js';
import { ALL_CONVERSATION_STATES } from '../conversation-states.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '..', '..');

// --- Test helpers ---

function uuid(): string {
  return 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
}

function sha256(): string {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}

const NOW = '2026-02-23T12:00:00.000Z';

// --- Generic validator ---

describe('validate()', () => {
  it('returns schema not found for unknown ref', () => {
    const result = validate({}, 'nonexistent.schema.json#/definitions/Foo');
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.keyword).toBe('schema');
  });
});

// --- OrchestratorActionRequest ---

describe('validateOrchestratorActionRequest', () => {
  const baseRequest = {
    conversation_id: null,
    action_type: 'CREATE_CONVERSATION',
    actor: 'tenant',
    tenant_input: {},
    auth_context: {
      tenant_user_id: uuid(),
      tenant_account_id: uuid(),
      authorized_unit_ids: [uuid()],
    },
  };

  it('accepts valid CREATE_CONVERSATION request', () => {
    const result = validateOrchestratorActionRequest(baseRequest);
    expect(result.valid).toBe(true);
  });

  it('accepts valid SELECT_UNIT request', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'SELECT_UNIT',
      tenant_input: { unit_id: uuid() },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid SUBMIT_INITIAL_MESSAGE request', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'SUBMIT_INITIAL_MESSAGE',
      tenant_input: { message: 'My toilet is leaking' },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing action_type', () => {
    const { action_type, ...noAction } = baseRequest;
    const result = validateOrchestratorActionRequest(noAction);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects invalid action_type', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      action_type: 'INVALID_ACTION',
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.keyword === 'enum')).toBe(true);
  });

  it('rejects missing auth_context', () => {
    const { auth_context, ...noAuth } = baseRequest;
    const result = validateOrchestratorActionRequest(noAuth);
    expect(result.valid).toBe(false);
  });

  // --- tenant_input binding tests (Task 5b) ---

  it('rejects SELECT_UNIT with empty tenant_input', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'SELECT_UNIT',
      tenant_input: {},
    });
    expect(result.valid).toBe(false);
  });

  it('rejects SELECT_UNIT with wrong-shaped tenant_input', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'SELECT_UNIT',
      tenant_input: { message: 'hello' },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects SUBMIT_INITIAL_MESSAGE with missing message', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'SUBMIT_INITIAL_MESSAGE',
      tenant_input: {},
    });
    expect(result.valid).toBe(false);
  });

  it('rejects ANSWER_FOLLOWUPS with missing answers', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'ANSWER_FOLLOWUPS',
      tenant_input: {},
    });
    expect(result.valid).toBe(false);
  });

  it('rejects UPLOAD_PHOTO_INIT with missing required fields', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'UPLOAD_PHOTO_INIT',
      tenant_input: {},
    });
    expect(result.valid).toBe(false);
  });

  it('rejects EDIT_ISSUE with missing issue_id', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'EDIT_ISSUE',
      tenant_input: { summary: 'updated' },
    });
    expect(result.valid).toBe(false);
  });

  it('accepts CONFIRM_SPLIT with empty tenant_input', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: uuid(),
      action_type: 'CONFIRM_SPLIT',
      tenant_input: {},
    });
    expect(result.valid).toBe(true);
  });

  it('rejects CREATE_CONVERSATION with extra fields in tenant_input', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      action_type: 'CREATE_CONVERSATION',
      tenant_input: { unexpected_field: 'value' },
    });
    expect(result.valid).toBe(false);
  });

  it('rejects request with non-UUID conversation_id', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      conversation_id: 'not-a-uuid',
      action_type: 'SELECT_UNIT',
      tenant_input: { unit_id: uuid() },
    });
    expect(result.valid).toBe(false);
  });
});

// --- OrchestratorActionResponse ---

describe('validateOrchestratorActionResponse', () => {
  const baseResponse = {
    conversation_snapshot: {
      conversation_id: uuid(),
      state: 'intake_started',
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'claude-sonnet-4-6',
        prompt_version: '1.0.0',
        cue_version: '1.2.0',
      },
    },
    ui_directive: {
      messages: [{ role: 'agent', content: 'Hello', timestamp: NOW }],
    },
    artifacts: [],
    pending_side_effects: [],
    errors: [],
  };

  it('accepts valid response', () => {
    const result = validateOrchestratorActionResponse(baseResponse);
    expect(result.valid).toBe(true);
  });

  it('rejects missing conversation_snapshot', () => {
    const { conversation_snapshot, ...missing } = baseResponse;
    const result = validateOrchestratorActionResponse(missing);
    expect(result.valid).toBe(false);
  });

  // --- Task 5e: response state validation ---

  it('rejects response with invalid conversation state', () => {
    const result = validateOrchestratorActionResponse({
      ...baseResponse,
      conversation_snapshot: {
        ...baseResponse.conversation_snapshot,
        state: 'definitely_not_a_real_state',
      },
    });
    expect(result.valid).toBe(false);
  });

  it('accepts response with queued_messages on snapshot', () => {
    const result = validateOrchestratorActionResponse({
      ...baseResponse,
      conversation_snapshot: {
        ...baseResponse.conversation_snapshot,
        queued_messages: ["My parking garage door is broken and won't close"],
      },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts response with valid SplitIssue items in issues', () => {
    const result = validateOrchestratorActionResponse({
      ...baseResponse,
      conversation_snapshot: {
        ...baseResponse.conversation_snapshot,
        issues: [{ issue_id: 'i-1', summary: 'Leaking toilet', raw_excerpt: 'toilet leaks' }],
      },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects response with issues items missing required fields', () => {
    const result = validateOrchestratorActionResponse({
      ...baseResponse,
      conversation_snapshot: {
        ...baseResponse.conversation_snapshot,
        issues: [{ summary: 'Leaking toilet' }],
      },
    });
    expect(result.valid).toBe(false);
  });

  // --- Task 5d: state enum sync guard ---

  it('schema ConversationSnapshot state enum matches ConversationState values', () => {
    const schema = JSON.parse(
      readFileSync(resolve(schemasDir, 'orchestrator_action.schema.json'), 'utf-8'),
    );
    const schemaStates = schema.definitions.ConversationSnapshot.properties.state.enum;
    const codeStates = ALL_CONVERSATION_STATES;
    expect(new Set(schemaStates)).toEqual(new Set(codeStates));
  });
});

// --- OrchestratorAction domain validator ---

describe('validateOrchestratorActionDomain', () => {
  const baseDomainRequest = {
    actor: 'tenant' as const,
    auth_context: {
      tenant_user_id: uuid(),
      tenant_account_id: uuid(),
      authorized_unit_ids: [uuid()],
    },
  };

  it('requires idempotency_key for CONFIRM_SUBMISSION', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: uuid(),
      action_type: 'CONFIRM_SUBMISSION',
      tenant_input: {},
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('idempotency_key');
  });

  it('requires idempotency_key for CREATE_CONVERSATION', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: null,
      action_type: 'CREATE_CONVERSATION',
      tenant_input: {},
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('idempotency_key');
  });

  it('requires idempotency_key for UPLOAD_PHOTO_COMPLETE', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: uuid(),
      action_type: 'UPLOAD_PHOTO_COMPLETE',
      tenant_input: { photo_id: uuid(), storage_key: 'uploads/abc', sha256: 'a'.repeat(64) },
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('idempotency_key');
  });

  it('accepts CONFIRM_SUBMISSION with idempotency_key', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: uuid(),
      action_type: 'CONFIRM_SUBMISSION',
      tenant_input: {},
      idempotency_key: uuid(),
    } as any);
    expect(result.valid).toBe(true);
  });

  it('does not require idempotency_key for SELECT_UNIT', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: uuid(),
      action_type: 'SELECT_UNIT',
      tenant_input: { unit_id: uuid() },
    } as any);
    expect(result.valid).toBe(true);
  });

  it('requires conversation_id for non-CREATE actions', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: null,
      action_type: 'SELECT_UNIT',
      tenant_input: { unit_id: uuid() },
    } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('conversation_id');
  });

  it('allows null conversation_id for CREATE_CONVERSATION', () => {
    const result = validateOrchestratorActionDomain({
      ...baseDomainRequest,
      conversation_id: null,
      action_type: 'CREATE_CONVERSATION',
      tenant_input: {},
      idempotency_key: uuid(),
    } as any);
    expect(result.valid).toBe(true);
  });
});

// --- IssueSplitterOutput ---

describe('validateIssueSplitterOutput', () => {
  it('accepts valid single-issue split', () => {
    const result = validateIssueSplitterOutput({
      issues: [{ issue_id: 'i-1', summary: 'Leaking toilet', raw_excerpt: 'My toilet is leaking' }],
      issue_count: 1,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid multi-issue split', () => {
    const result = validateIssueSplitterOutput({
      issues: [
        { issue_id: 'i-1', summary: 'Leaking toilet', raw_excerpt: 'toilet leaks' },
        { issue_id: 'i-2', summary: 'Broken light', raw_excerpt: 'light broken' },
      ],
      issue_count: 2,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty issues array', () => {
    const result = validateIssueSplitterOutput({ issues: [], issue_count: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects 11 issues (max 10)', () => {
    const issues = Array.from({ length: 11 }, (_, i) => ({
      issue_id: `i-${i}`,
      summary: `Issue ${i}`,
      raw_excerpt: `excerpt ${i}`,
    }));
    const result = validateIssueSplitterOutput({ issues, issue_count: 11 });
    expect(result.valid).toBe(false);
  });

  it('rejects summary over 500 chars', () => {
    const result = validateIssueSplitterOutput({
      issues: [{ issue_id: 'i-1', summary: 'x'.repeat(501), raw_excerpt: 'test' }],
      issue_count: 1,
    });
    expect(result.valid).toBe(false);
  });
});

// --- IssueSplitDomain ---

describe('validateIssueSplitDomain', () => {
  function makeSplitOutput(issueCount: number, actualCount: number) {
    const issues = Array.from({ length: actualCount }, (_, i) => ({
      issue_id: `i-${i + 1}`,
      summary: `Issue ${i + 1}`,
      raw_excerpt: `excerpt ${i + 1}`,
    }));
    return { issues, issue_count: issueCount };
  }

  it('accepts matching count (1)', () => {
    const result = validateIssueSplitDomain(makeSplitOutput(1, 1));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts matching count (3)', () => {
    const result = validateIssueSplitDomain(makeSplitOutput(3, 3));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects issue_count too high', () => {
    const result = validateIssueSplitDomain(makeSplitOutput(5, 2));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('5');
    expect(result.errors[0]).toContain('2');
  });

  it('rejects issue_count too low', () => {
    const result = validateIssueSplitDomain(makeSplitOutput(1, 3));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('1');
    expect(result.errors[0]).toContain('3');
  });

  it('schema-valid payload with mismatched count fails domain validation', () => {
    const payload = {
      issues: [
        { issue_id: 'i-1', summary: 'Leak', raw_excerpt: 'toilet leaks' },
        { issue_id: 'i-2', summary: 'Light', raw_excerpt: 'light broken' },
      ],
      issue_count: 5,
    };
    const schemaResult = validateIssueSplitterOutput(payload);
    expect(schemaResult.valid).toBe(true); // schema does not catch mismatch

    const domainResult = validateIssueSplitDomain(schemaResult.data!);
    expect(domainResult.valid).toBe(false); // domain layer catches it
    expect(domainResult.errors[0]).toContain('5');
    expect(domainResult.errors[0]).toContain('2');
  });
});

// --- IssueClassifierOutput ---

describe('validateClassifierOutput', () => {
  it('accepts valid output', () => {
    const result = validateClassifierOutput({
      issue_id: 'i-1',
      classification: { Category: 'maintenance', Maintenance_Category: 'plumbing' },
      model_confidence: { Category: 0.9, Maintenance_Category: 0.85 },
      missing_fields: [],
      needs_human_triage: false,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects missing issue_id', () => {
    const result = validateClassifierOutput({
      classification: { Category: 'maintenance' },
      model_confidence: { Category: 0.9 },
      missing_fields: [],
      needs_human_triage: false,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects confidence out of range (> 1)', () => {
    const result = validateClassifierOutput({
      issue_id: 'i-1',
      classification: { Category: 'maintenance' },
      model_confidence: { Category: 1.5 },
      missing_fields: [],
      needs_human_triage: false,
    });
    expect(result.valid).toBe(false);
  });
});

// --- FollowUpGeneratorInput ---

describe('validateFollowUpInput', () => {
  const baseInput = {
    issue_id: 'i-1',
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    fields_needing_input: ['Maintenance_Object'],
    previous_questions: [],
    turn_number: 1,
    total_questions_asked: 0,
    taxonomy_version: '1.0.0',
    prompt_version: '1.0.0',
    cue_version: '1.2.0',
  };

  it('rejects turn_number > 8 (max_turns cap)', () => {
    const result = validateFollowUpInput({ ...baseInput, turn_number: 9 });
    expect(result.valid).toBe(false);
  });

  it('rejects total_questions_asked > 8 (generator input cap — >= 9 is exhausted)', () => {
    const result = validateFollowUpInput({ ...baseInput, total_questions_asked: 9 });
    expect(result.valid).toBe(false);
  });

  it('rejects times_asked > 2 on a PreviousQuestion (max_reasks cap)', () => {
    const result = validateFollowUpInput({
      ...baseInput,
      previous_questions: [{ field_target: 'Maintenance_Object', times_asked: 3 }],
    });
    expect(result.valid).toBe(false);
  });

  it('accepts input at cap boundaries (turn 8, 8 total questions, 2 re-asks)', () => {
    const result = validateFollowUpInput({
      ...baseInput,
      turn_number: 8,
      total_questions_asked: 8,
      previous_questions: [{ field_target: 'Maintenance_Object', times_asked: 2 }],
    });
    expect(result.valid).toBe(true);
  });
});

// --- FollowUpGeneratorOutput ---

describe('validateFollowUpOutput', () => {
  it('accepts valid output with 1-3 questions', () => {
    const result = validateFollowUpOutput({
      questions: [
        {
          question_id: 'q-1',
          field_target: 'Maintenance_Object',
          prompt: 'What is leaking?',
          options: ['toilet', 'sink', 'faucet'],
          answer_type: 'enum',
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects 4 questions (max 3)', () => {
    const questions = Array.from({ length: 4 }, (_, i) => ({
      question_id: `q-${i}`,
      field_target: 'field',
      prompt: `Question ${i}?`,
      options: ['a', 'b'],
      answer_type: 'enum' as const,
    }));
    const result = validateFollowUpOutput({ questions });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid answer_type', () => {
    const result = validateFollowUpOutput({
      questions: [
        {
          question_id: 'q-1',
          field_target: 'field',
          prompt: 'Question?',
          options: [],
          answer_type: 'number',
        },
      ],
    });
    expect(result.valid).toBe(false);
  });
});

// --- FollowUpEvent ---

describe('validateFollowUpEvent', () => {
  it('accepts valid event', () => {
    const result = validateFollowUpEvent({
      event_id: uuid(),
      conversation_id: uuid(),
      issue_id: uuid(),
      turn_number: 1,
      questions_asked: [
        {
          question_id: 'q-1',
          field_target: 'Maintenance_Object',
          prompt: 'What is leaking?',
          options: ['toilet', 'sink'],
          answer_type: 'enum',
        },
      ],
      answers_received: null,
      created_at: NOW,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects event with turn_number > 8', () => {
    const result = validateFollowUpEvent({
      event_id: uuid(),
      conversation_id: uuid(),
      issue_id: uuid(),
      turn_number: 9,
      questions_asked: [
        {
          question_id: 'q-1',
          field_target: 'field',
          prompt: 'Question?',
          options: ['a'],
          answer_type: 'enum',
        },
      ],
      created_at: NOW,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects event with 4+ questions_asked', () => {
    const questions = Array.from({ length: 4 }, (_, i) => ({
      question_id: `q-${i}`,
      field_target: 'field',
      prompt: `Question ${i}?`,
      options: ['a'],
      answer_type: 'enum' as const,
    }));
    const result = validateFollowUpEvent({
      event_id: uuid(),
      conversation_id: uuid(),
      issue_id: uuid(),
      turn_number: 1,
      questions_asked: questions,
      created_at: NOW,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects event with 4+ answers_received', () => {
    const answers = Array.from({ length: 4 }, (_, i) => ({
      question_id: `q-${i}`,
      answer: 'yes',
      received_at: NOW,
    }));
    const result = validateFollowUpEvent({
      event_id: uuid(),
      conversation_id: uuid(),
      issue_id: uuid(),
      turn_number: 1,
      questions_asked: [
        {
          question_id: 'q-1',
          field_target: 'field',
          prompt: 'Question?',
          options: ['a'],
          answer_type: 'enum',
        },
      ],
      answers_received: answers,
      created_at: NOW,
    });
    expect(result.valid).toBe(false);
  });
});

// --- WorkOrder ---

describe('validateWorkOrder', () => {
  const validWO = {
    work_order_id: uuid(),
    issue_group_id: uuid(),
    issue_id: uuid(),
    conversation_id: uuid(),
    client_id: uuid(),
    property_id: uuid(),
    unit_id: uuid(),
    tenant_user_id: uuid(),
    tenant_account_id: uuid(),
    status: 'created',
    status_history: [{ status: 'created', changed_at: NOW, actor: 'system' }],
    raw_text: 'My toilet is leaking',
    summary_confirmed: 'Leaking toilet in unit bathroom',
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

  it('accepts valid work order', () => {
    const result = validateWorkOrder(validWO);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = validateWorkOrder({ ...validWO, status: 'in_progress' });
    expect(result.valid).toBe(false);
  });

  it('rejects missing required IDs', () => {
    const { work_order_id, ...noId } = validWO;
    const result = validateWorkOrder(noId);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid pets_present value', () => {
    const result = validateWorkOrder({ ...validWO, pets_present: 'maybe' });
    expect(result.valid).toBe(false);
  });

  it('rejects row_version of 0', () => {
    const result = validateWorkOrder({ ...validWO, row_version: 0 });
    expect(result.valid).toBe(false);
  });
});

// --- Photo ---

describe('validatePhoto', () => {
  const validPhoto = {
    photo_id: uuid(),
    conversation_id: uuid(),
    work_order_id: null,
    filename: 'leak.jpg',
    content_type: 'image/jpeg',
    size_bytes: 1024000,
    sha256: sha256(),
    storage_key: 'uploads/abc123',
    scanned_status: 'pending',
    uploaded_by: uuid(),
    created_at: NOW,
  };

  it('accepts valid photo', () => {
    const result = validatePhoto(validPhoto);
    expect(result.valid).toBe(true);
  });

  it('rejects photo over max size (10MB)', () => {
    const result = validatePhoto({ ...validPhoto, size_bytes: 10485761 });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid content_type', () => {
    const result = validatePhoto({ ...validPhoto, content_type: 'application/pdf' });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid scanned_status', () => {
    const result = validatePhoto({ ...validPhoto, scanned_status: 'unknown' });
    expect(result.valid).toBe(false);
  });

  it('rejects invalid sha256 format', () => {
    const result = validatePhoto({ ...validPhoto, sha256: 'not-a-hash' });
    expect(result.valid).toBe(false);
  });
});

// --- Taxonomy cross-validator ---

describe('validateClassificationAgainstTaxonomy', () => {
  it('passes valid maintenance classification', () => {
    const result = validateClassificationAgainstTaxonomy(
      { Category: 'maintenance', Maintenance_Category: 'plumbing', Maintenance_Object: 'toilet' },
      taxonomy,
    );
    expect(result.valid).toBe(true);
    expect(result.contradictory).toBe(false);
  });

  it('passes valid management classification', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'management',
        Management_Category: 'accounting',
        Management_Object: 'rent_charges',
      },
      taxonomy,
    );
    expect(result.valid).toBe(true);
    expect(result.contradictory).toBe(false);
  });

  it('detects invalid taxonomy value', () => {
    const result = validateClassificationAgainstTaxonomy(
      { Category: 'nonexistent_category' },
      taxonomy,
    );
    expect(result.valid).toBe(false);
    expect(result.invalidValues.length).toBeGreaterThan(0);
  });

  it('detects management category with maintenance fields (contradictory)', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'management',
        Maintenance_Category: 'plumbing',
        Management_Category: 'accounting',
      },
      taxonomy,
    );
    expect(result.contradictory).toBe(true);
    expect(result.crossDomainViolations.length).toBeGreaterThan(0);
  });

  it('detects maintenance category with management fields (contradictory)', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'maintenance',
        Management_Category: 'accounting',
        Maintenance_Category: 'plumbing',
      },
      taxonomy,
    );
    expect(result.contradictory).toBe(true);
    expect(result.crossDomainViolations.length).toBeGreaterThan(0);
  });

  // --- v1.1.0 not_applicable tests ---

  it('accepts management classification with not_applicable maintenance fields (v1.1.0)', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'management',
        Management_Category: 'accounting',
        Management_Object: 'rent_charges',
        Maintenance_Category: 'not_applicable',
        Maintenance_Object: 'not_applicable',
        Maintenance_Problem: 'not_applicable',
      },
      taxonomy,
      '1.1.0',
    );
    expect(result.valid).toBe(true);
    expect(result.contradictory).toBe(false);
  });

  it('accepts maintenance classification with not_applicable management fields (v1.1.0)', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'maintenance',
        Maintenance_Category: 'plumbing',
        Maintenance_Object: 'toilet',
        Maintenance_Problem: 'leak',
        Management_Category: 'not_applicable',
        Management_Object: 'not_applicable',
      },
      taxonomy,
      '1.1.0',
    );
    expect(result.valid).toBe(true);
    expect(result.contradictory).toBe(false);
  });

  it('flags management classification with other_* maintenance fields as contradictory (v1.1.0)', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'management',
        Management_Category: 'accounting',
        Maintenance_Category: 'other_maintenance_category',
      },
      taxonomy,
      '1.1.0',
    );
    expect(result.contradictory).toBe(true);
    expect(result.crossDomainViolations.length).toBeGreaterThan(0);
  });

  it('flags maintenance classification with other_* management fields as contradictory (v1.1.0)', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'maintenance',
        Maintenance_Category: 'plumbing',
        Management_Category: 'other_mgmt_cat',
      },
      taxonomy,
      '1.1.0',
    );
    expect(result.contradictory).toBe(true);
    expect(result.crossDomainViolations.length).toBeGreaterThan(0);
  });

  // --- Legacy version backward compat tests ---

  it('accepts management classification with other_* maintenance fields under legacy version', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'management',
        Management_Category: 'accounting',
        Maintenance_Category: 'other_maintenance_category',
        Maintenance_Object: 'no_object',
        Maintenance_Problem: 'other_problem',
      },
      taxonomy,
      '1.0.0',
    );
    expect(result.valid).toBe(true);
    expect(result.contradictory).toBe(false);
  });

  it('accepts maintenance classification with other_* management fields under legacy version', () => {
    const result = validateClassificationAgainstTaxonomy(
      {
        Category: 'maintenance',
        Maintenance_Category: 'plumbing',
        Management_Category: 'other_mgmt_cat',
        Management_Object: 'no_object',
      },
      taxonomy,
      '1.0.0',
    );
    expect(result.valid).toBe(true);
    expect(result.contradictory).toBe(false);
  });

  // --- not_applicable enum validity ---

  it('recognizes not_applicable as valid taxonomy value for domain-specific fields', () => {
    for (const field of [
      'Maintenance_Category',
      'Maintenance_Object',
      'Maintenance_Problem',
      'Management_Category',
      'Management_Object',
    ]) {
      const result = validateClassificationAgainstTaxonomy({ [field]: 'not_applicable' }, taxonomy);
      expect(result.invalidValues.filter((iv) => iv.field === field)).toHaveLength(0);
    }
  });
});

// --- Cue dictionary validator ---

describe('validateCueDictionary', () => {
  it('passes for valid cues matching taxonomy', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: ['leak', 'toilet'], regex: [] },
        },
      },
    };
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(true);
  });

  it('detects orphaned label not in taxonomy', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: ['leak'], regex: [] },
          teleportation: { keywords: ['beam me up'], regex: [] },
        },
      },
    };
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.message.includes('teleportation'))).toBe(true);
  });

  it('detects field name not in taxonomy', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Nonexistent_Field: {
          value: { keywords: ['test'], regex: [] },
        },
      },
    };
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.message.includes('Nonexistent_Field'))).toBe(true);
  });

  // --- Field-level label map guards ---

  it('rejects field labels container that is null', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: null,
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(
      result.errors?.some(
        (e) => e.path === '/fields/Maintenance_Category' && e.message.includes('non-null object'),
      ),
    ).toBe(true);
  });

  it('rejects field labels container that is a string', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: 'bad',
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(
      result.errors?.some((e) => e.path === '/fields/Maintenance_Category' && e.keyword === 'type'),
    ).toBe(true);
  });

  // --- Entry-level shape checks ---

  it('rejects cue entry where keywords is a string instead of array', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: 'leak', regex: [] },
        },
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.path.includes('keywords'))).toBe(true);
  });

  it('rejects cue entry where regex is missing', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: ['leak'] },
        },
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.path.includes('regex'))).toBe(true);
  });

  it('rejects cue entry where keywords contains a non-string', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: ['leak', 42], regex: [] },
        },
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.message.includes('keywords[1]'))).toBe(true);
  });

  it('rejects cue entry where regex contains an invalid RegExp', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: ['leak'], regex: ['[invalid('] },
        },
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.keyword === 'pattern')).toBe(true);
  });

  it('rejects cue entry that is null instead of an object', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: null,
        },
      },
    };
    const result = validateCueDictionary(cues as any, taxonomy);
    expect(result.valid).toBe(false);
    expect(result.errors?.some((e) => e.message.includes('must be an object'))).toBe(true);
  });

  it('accepts cue entry with valid regex patterns', () => {
    const cues = {
      version: '1.0.0',
      fields: {
        Maintenance_Category: {
          plumbing: { keywords: ['leak'], regex: ['toilet\\s+leak', '\\bpipe\\b'] },
        },
      },
    };
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(true);
  });

  it('validates the actual classification_cues.json file', () => {
    const raw = readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8');
    const cues = JSON.parse(raw);
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(true);
  });
});

// --- DisambiguatorOutput validator ---

describe('validateDisambiguatorOutput', () => {
  it('accepts valid clarification output', () => {
    const result = validateDisambiguatorOutput({
      classification: 'clarification',
      reasoning: 'The message provides details about the existing kitchen leak issue.',
    });
    expect(result.valid).toBe(true);
    expect(result.data!.classification).toBe('clarification');
  });

  it('accepts valid new_issue output', () => {
    const result = validateDisambiguatorOutput({
      classification: 'new_issue',
      reasoning:
        'The message describes a parking garage door problem unrelated to the kitchen leak.',
    });
    expect(result.valid).toBe(true);
    expect(result.data!.classification).toBe('new_issue');
  });

  it('rejects invalid classification value', () => {
    const result = validateDisambiguatorOutput({
      classification: 'maybe_new',
      reasoning: 'Not sure.',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing reasoning', () => {
    const result = validateDisambiguatorOutput({
      classification: 'clarification',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects empty reasoning', () => {
    const result = validateDisambiguatorOutput({
      classification: 'new_issue',
      reasoning: '',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects extra properties', () => {
    const result = validateDisambiguatorOutput({
      classification: 'clarification',
      reasoning: 'This is a clarification.',
      confidence: 0.9,
    });
    expect(result.valid).toBe(false);
  });
});

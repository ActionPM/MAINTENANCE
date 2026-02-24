import { describe, it, expect } from 'vitest';
import { validate } from '../validator.js';
import { validateOrchestratorActionRequest, validateOrchestratorActionResponse } from '../validators/orchestrator-action.js';
import { validateIssueSplitterOutput } from '../validators/issue-split.js';
import { validateClassifierOutput } from '../validators/classification.js';
import { validateFollowUpOutput, validateFollowUpEvent } from '../validators/followups.js';
import { validateWorkOrder } from '../validators/work-order.js';
import { validatePhoto } from '../validators/photo.js';
import { validateClassificationAgainstTaxonomy } from '../validators/taxonomy-cross-validator.js';
import { validateCueDictionary } from '../validators/cue-dictionary-validator.js';
import { taxonomy } from '../taxonomy.js';
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
    expect(result.errors?.some(e => e.keyword === 'required')).toBe(true);
  });

  it('rejects invalid action_type', () => {
    const result = validateOrchestratorActionRequest({
      ...baseRequest,
      action_type: 'INVALID_ACTION',
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.some(e => e.keyword === 'enum')).toBe(true);
  });

  it('rejects missing auth_context', () => {
    const { auth_context, ...noAuth } = baseRequest;
    const result = validateOrchestratorActionRequest(noAuth);
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
      questions: [{
        question_id: 'q-1',
        field_target: 'field',
        prompt: 'Question?',
        options: [],
        answer_type: 'number',
      }],
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
      questions_asked: [{
        question_id: 'q-1',
        field_target: 'Maintenance_Object',
        prompt: 'What is leaking?',
        options: ['toilet', 'sink'],
        answer_type: 'enum',
      }],
      answers_received: null,
      created_at: NOW,
    });
    expect(result.valid).toBe(true);
  });
});

// --- WorkOrder ---

describe('validateWorkOrder', () => {
  const validWO = {
    work_order_id: uuid(),
    issue_group_id: uuid(),
    issue_id: uuid(),
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
      { Category: 'management', Management_Category: 'accounting', Management_Object: 'rent_charges' },
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
      { Category: 'management', Maintenance_Category: 'plumbing', Management_Category: 'accounting' },
      taxonomy,
    );
    expect(result.contradictory).toBe(true);
    expect(result.crossDomainViolations.length).toBeGreaterThan(0);
  });

  it('detects maintenance category with management fields (contradictory)', () => {
    const result = validateClassificationAgainstTaxonomy(
      { Category: 'maintenance', Management_Category: 'accounting', Maintenance_Category: 'plumbing' },
      taxonomy,
    );
    expect(result.contradictory).toBe(true);
    expect(result.crossDomainViolations.length).toBeGreaterThan(0);
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
    expect(result.errors?.some(e => e.message.includes('teleportation'))).toBe(true);
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
    expect(result.errors?.some(e => e.message.includes('Nonexistent_Field'))).toBe(true);
  });

  it('validates the actual classification_cues.json file', () => {
    const raw = readFileSync(resolve(schemasDir, 'classification_cues.json'), 'utf-8');
    const cues = JSON.parse(raw);
    const result = validateCueDictionary(cues, taxonomy);
    expect(result.valid).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  taxonomy,
  loadTaxonomy,
  isTaxonomyValue,
  TAXONOMY_FIELD_NAMES,
} from '../taxonomy.js';
import {
  ConversationState,
  ALL_CONVERSATION_STATES,
  RESUMABLE_STATES,
} from '../conversation-states.js';
import {
  WorkOrderStatus,
  ALL_WORK_ORDER_STATUSES,
} from '../work-order-status.js';
import {
  ActionType,
  ALL_ACTION_TYPES,
  ActorType,
  ALL_ACTOR_TYPES,
} from '../action-types.js';
import { DEFAULT_RATE_LIMITS } from '../rate-limits.js';
import {
  DEFAULT_CONFIDENCE_CONFIG,
  DEFAULT_FOLLOWUP_CAPS,
} from '../confidence-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, '..', '..');

describe('Taxonomy', () => {
  it('loadTaxonomy returns a valid taxonomy object', () => {
    const t = loadTaxonomy();
    expect(t).toBeDefined();
    for (const field of TAXONOMY_FIELD_NAMES) {
      expect(Array.isArray(t[field])).toBe(true);
      expect(t[field].length).toBeGreaterThan(0);
    }
  });

  it('has exactly 9 taxonomy fields', () => {
    expect(TAXONOMY_FIELD_NAMES).toHaveLength(9);
  });

  it('taxonomy singleton is populated', () => {
    expect(taxonomy.Category).toContain('maintenance');
    expect(taxonomy.Category).toContain('management');
    expect(taxonomy.Category).toContain('other_category');
    expect(taxonomy.Priority).toContain('emergency');
  });

  it('isTaxonomyValue returns true for valid values', () => {
    expect(isTaxonomyValue('Category', 'maintenance')).toBe(true);
    expect(isTaxonomyValue('Category', 'management')).toBe(true);
    expect(isTaxonomyValue('Priority', 'low')).toBe(true);
    expect(isTaxonomyValue('Priority', 'emergency')).toBe(true);
    expect(isTaxonomyValue('Maintenance_Category', 'plumbing')).toBe(true);
    expect(isTaxonomyValue('Location', 'suite')).toBe(true);
  });

  it('isTaxonomyValue returns false for invalid values', () => {
    expect(isTaxonomyValue('Category', 'freetext_garbage')).toBe(false);
    expect(isTaxonomyValue('Category', '')).toBe(false);
    expect(isTaxonomyValue('Priority', 'critical')).toBe(false);
    expect(isTaxonomyValue('Maintenance_Category', 'magic')).toBe(false);
  });
});

describe('ConversationState', () => {
  it('defines exactly 14 states', () => {
    expect(ALL_CONVERSATION_STATES).toHaveLength(14);
  });

  it('includes all 10 core states', () => {
    const coreStates = [
      'intake_started',
      'unit_selection_required',
      'unit_selected',
      'split_in_progress',
      'split_proposed',
      'split_finalized',
      'classification_in_progress',
      'needs_tenant_input',
      'tenant_confirmation_pending',
      'submitted',
    ];
    for (const state of coreStates) {
      expect(ALL_CONVERSATION_STATES).toContain(state);
    }
  });

  it('includes all 4 failure/recovery states', () => {
    const failureStates = [
      'llm_error_retryable',
      'llm_error_terminal',
      'intake_abandoned',
      'intake_expired',
    ];
    for (const state of failureStates) {
      expect(ALL_CONVERSATION_STATES).toContain(state);
    }
  });

  it('RESUMABLE_STATES contains exactly the spec §12.1 states', () => {
    const expectedResumable = [
      'unit_selection_required',
      'split_proposed',
      'classification_in_progress',
      'needs_tenant_input',
      'tenant_confirmation_pending',
      'llm_error_retryable',
      'intake_abandoned',
    ];
    expect(RESUMABLE_STATES.size).toBe(7);
    for (const state of expectedResumable) {
      expect(RESUMABLE_STATES.has(state as ConversationState)).toBe(true);
    }
  });

  it('RESUMABLE_STATES is a subset of all states', () => {
    for (const state of RESUMABLE_STATES) {
      expect(ALL_CONVERSATION_STATES).toContain(state);
    }
  });
});

describe('WorkOrderStatus', () => {
  it('defines exactly 5 statuses', () => {
    expect(ALL_WORK_ORDER_STATUSES).toHaveLength(5);
  });

  it('matches spec §1.5 lifecycle', () => {
    const expected = ['created', 'action_required', 'scheduled', 'resolved', 'cancelled'];
    for (const status of expected) {
      expect(ALL_WORK_ORDER_STATUSES).toContain(status);
    }
  });
});

describe('ActionType', () => {
  it('defines exactly 15 action types', () => {
    expect(ALL_ACTION_TYPES).toHaveLength(15);
  });

  it('includes all spec §10.3 action types', () => {
    const expected = [
      'CREATE_CONVERSATION',
      'SELECT_UNIT',
      'SUBMIT_INITIAL_MESSAGE',
      'SUBMIT_ADDITIONAL_MESSAGE',
      'CONFIRM_SPLIT',
      'MERGE_ISSUES',
      'EDIT_ISSUE',
      'ADD_ISSUE',
      'REJECT_SPLIT',
      'ANSWER_FOLLOWUPS',
      'CONFIRM_SUBMISSION',
      'UPLOAD_PHOTO_INIT',
      'UPLOAD_PHOTO_COMPLETE',
      'RESUME',
      'ABANDON',
    ];
    for (const action of expected) {
      expect(ALL_ACTION_TYPES).toContain(action);
    }
  });
});

describe('ActorType', () => {
  it('defines exactly 4 actor types', () => {
    expect(ALL_ACTOR_TYPES).toHaveLength(4);
  });

  it('includes tenant, system, agent, pm_user', () => {
    expect(ALL_ACTOR_TYPES).toContain('tenant');
    expect(ALL_ACTOR_TYPES).toContain('system');
    expect(ALL_ACTOR_TYPES).toContain('agent');
    expect(ALL_ACTOR_TYPES).toContain('pm_user');
  });
});

describe('RateLimitConfig', () => {
  it('has all 7 limits with spec §8 defaults', () => {
    expect(DEFAULT_RATE_LIMITS.max_messages_per_minute_per_user).toBe(10);
    expect(DEFAULT_RATE_LIMITS.max_new_conversations_per_day_per_user).toBe(20);
    expect(DEFAULT_RATE_LIMITS.max_photo_uploads_per_conversation).toBe(10);
    expect(DEFAULT_RATE_LIMITS.max_photo_size_mb).toBe(10);
    expect(DEFAULT_RATE_LIMITS.max_message_chars).toBe(8000);
    expect(DEFAULT_RATE_LIMITS.max_issues_per_conversation).toBe(10);
    expect(DEFAULT_RATE_LIMITS.max_issue_text_chars).toBe(500);
  });

  it('has exactly 7 keys', () => {
    expect(Object.keys(DEFAULT_RATE_LIMITS)).toHaveLength(7);
  });
});

describe('ConfidenceConfig', () => {
  it('has correct threshold values from spec §14.3', () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.high_threshold).toBe(0.85);
    expect(DEFAULT_CONFIDENCE_CONFIG.medium_threshold).toBe(0.65);
  });

  it('has model hint clamp range [0.2, 0.95]', () => {
    expect(DEFAULT_CONFIDENCE_CONFIG.model_hint_min).toBe(0.2);
    expect(DEFAULT_CONFIDENCE_CONFIG.model_hint_max).toBe(0.95);
  });

  it('weights sum to 1.0', () => {
    const { weights } = DEFAULT_CONFIDENCE_CONFIG;
    const sum =
      weights.cue_strength +
      weights.completeness +
      weights.model_hint +
      weights.disagreement +
      weights.ambiguity_penalty;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('has correct individual weight values', () => {
    const { weights } = DEFAULT_CONFIDENCE_CONFIG;
    expect(weights.cue_strength).toBe(0.40);
    expect(weights.completeness).toBe(0.25);
    expect(weights.model_hint).toBe(0.20);
    expect(weights.disagreement).toBe(0.10);
    expect(weights.ambiguity_penalty).toBe(0.05);
  });
});

describe('FollowUpCaps', () => {
  it('matches spec §15 hard caps', () => {
    expect(DEFAULT_FOLLOWUP_CAPS.max_questions_per_turn).toBe(3);
    expect(DEFAULT_FOLLOWUP_CAPS.max_turns).toBe(8);
    expect(DEFAULT_FOLLOWUP_CAPS.max_total_questions).toBe(9);
    expect(DEFAULT_FOLLOWUP_CAPS.max_reasks_per_field).toBe(2);
  });

  it('schema bounds match DEFAULT_FOLLOWUP_CAPS', () => {
    const requestSchema = JSON.parse(readFileSync(
      resolve(schemasDir, 'followup_request.schema.json'), 'utf-8'));
    const followupsSchema = JSON.parse(readFileSync(
      resolve(schemasDir, 'followups.schema.json'), 'utf-8'));

    // Input schema bounds
    const input = requestSchema.definitions.FollowUpGeneratorInput.properties;
    expect(input.turn_number.maximum).toBe(DEFAULT_FOLLOWUP_CAPS.max_turns);
    expect(input.total_questions_asked.maximum).toBe(DEFAULT_FOLLOWUP_CAPS.max_total_questions - 1);
    // Note: input cap is max_total_questions - 1 because >= 9 means exhausted (do not call)

    // PreviousQuestion re-ask bound
    const prev = requestSchema.definitions.PreviousQuestion.properties;
    expect(prev.times_asked.maximum).toBe(DEFAULT_FOLLOWUP_CAPS.max_reasks_per_field);

    // Output questions maxItems
    const output = followupsSchema.definitions.FollowUpGeneratorOutput.properties;
    expect(output.questions.maxItems).toBe(DEFAULT_FOLLOWUP_CAPS.max_questions_per_turn);

    // Event bounds
    const event = followupsSchema.definitions.FollowUpEvent.properties;
    expect(event.turn_number.maximum).toBe(DEFAULT_FOLLOWUP_CAPS.max_turns);
    expect(event.questions_asked.maxItems).toBe(DEFAULT_FOLLOWUP_CAPS.max_questions_per_turn);
    expect(event.answers_received.maxItems).toBe(DEFAULT_FOLLOWUP_CAPS.max_questions_per_turn);
  });
});

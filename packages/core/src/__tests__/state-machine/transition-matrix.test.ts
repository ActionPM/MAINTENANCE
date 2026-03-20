import { describe, it, expect } from 'vitest';
import { ConversationState, ALL_CONVERSATION_STATES, ActionType } from '@wo-agent/schemas';
import { SystemEvent, ALL_SYSTEM_EVENTS } from '../../state-machine/system-events.js';
import {
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  type TransitionTrigger,
} from '../../state-machine/transition-matrix.js';

describe('SystemEvent', () => {
  it('defines all 7 system events from spec §11.2 + §16', () => {
    expect(ALL_SYSTEM_EVENTS).toHaveLength(7);
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_SPLIT_SUCCESS');
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_CLASSIFY_SUCCESS');
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_FAIL');
    expect(ALL_SYSTEM_EVENTS).toContain('START_CLASSIFICATION');
    expect(ALL_SYSTEM_EVENTS).toContain('STALENESS_DETECTED');
    expect(ALL_SYSTEM_EVENTS).toContain('RETRY_LLM');
    expect(ALL_SYSTEM_EVENTS).toContain('EXPIRE');
  });

  it('has no overlap with ActionType values', async () => {
    const { ALL_ACTION_TYPES } = await import('@wo-agent/schemas');
    for (const evt of ALL_SYSTEM_EVENTS) {
      expect(ALL_ACTION_TYPES).not.toContain(evt);
    }
  });
});

describe('TRANSITION_MATRIX', () => {
  it('has an entry for every ConversationState', () => {
    for (const state of ALL_CONVERSATION_STATES) {
      expect(TRANSITION_MATRIX).toHaveProperty(state);
    }
  });

  it('does not include photo actions (handled separately)', () => {
    for (const state of ALL_CONVERSATION_STATES) {
      const transitions = TRANSITION_MATRIX[state];
      for (const trigger of Object.keys(transitions ?? {})) {
        expect(PHOTO_ACTIONS).not.toContain(trigger);
      }
    }
  });

  it('every target state is a valid ConversationState', () => {
    for (const state of ALL_CONVERSATION_STATES) {
      const transitions = TRANSITION_MATRIX[state];
      for (const [_trigger, targets] of Object.entries(transitions ?? {})) {
        for (const target of targets as ConversationState[]) {
          expect(ALL_CONVERSATION_STATES).toContain(target);
        }
      }
    }
  });

  // Verify specific transitions from spec §11.2
  const expectedTransitions: [string, string, string[]][] = [
    // intake_started
    ['intake_started', 'SELECT_UNIT', ['unit_selected', 'unit_selection_required']],
    ['intake_started', 'SUBMIT_INITIAL_MESSAGE', ['split_in_progress']],
    ['intake_started', 'RESUME', ['intake_started']],
    // unit_selection_required
    ['unit_selection_required', 'SELECT_UNIT', ['unit_selected']],
    ['unit_selection_required', 'ABANDON', ['intake_abandoned']],
    // unit_selected
    ['unit_selected', 'SUBMIT_INITIAL_MESSAGE', ['split_in_progress']],
    ['unit_selected', 'ABANDON', ['intake_abandoned']],
    // split_in_progress
    ['split_in_progress', 'LLM_SPLIT_SUCCESS', ['split_proposed']],
    ['split_in_progress', 'LLM_FAIL', ['llm_error_retryable', 'llm_error_terminal']],
    ['split_in_progress', 'ABANDON', ['intake_abandoned']],
    // split_proposed
    ['split_proposed', 'CONFIRM_SPLIT', ['split_finalized']],
    ['split_proposed', 'MERGE_ISSUES', ['split_proposed']],
    ['split_proposed', 'EDIT_ISSUE', ['split_proposed']],
    ['split_proposed', 'ADD_ISSUE', ['split_proposed']],
    ['split_proposed', 'REJECT_SPLIT', ['split_finalized']],
    ['split_proposed', 'ABANDON', ['intake_abandoned']],
    // split_finalized
    ['split_finalized', 'START_CLASSIFICATION', ['classification_in_progress']],
    ['split_finalized', 'ABANDON', ['intake_abandoned']],
    // classification_in_progress
    [
      'classification_in_progress',
      'LLM_CLASSIFY_SUCCESS',
      ['needs_tenant_input', 'tenant_confirmation_pending'],
    ],
    ['classification_in_progress', 'LLM_FAIL', ['llm_error_retryable', 'llm_error_terminal']],
    ['classification_in_progress', 'ABANDON', ['intake_abandoned']],
    // needs_tenant_input
    ['needs_tenant_input', 'ANSWER_FOLLOWUPS', ['classification_in_progress']],
    ['needs_tenant_input', 'SUBMIT_ADDITIONAL_MESSAGE', ['needs_tenant_input']],
    ['needs_tenant_input', 'ABANDON', ['intake_abandoned']],
    // tenant_confirmation_pending
    ['tenant_confirmation_pending', 'CONFIRM_SUBMISSION', ['submitted']],
    ['tenant_confirmation_pending', 'STALENESS_DETECTED', ['split_finalized']],
    ['tenant_confirmation_pending', 'SUBMIT_ADDITIONAL_MESSAGE', ['tenant_confirmation_pending']],
    ['tenant_confirmation_pending', 'ABANDON', ['intake_abandoned']],
    // submitted
    ['submitted', 'SUBMIT_INITIAL_MESSAGE', ['submitted']],
    ['submitted', 'RESUME', ['submitted']],
    // llm_error_retryable
    ['llm_error_retryable', 'RETRY_LLM', ['split_in_progress', 'classification_in_progress']],
    ['llm_error_retryable', 'RESUME', ['llm_error_retryable']],
    ['llm_error_retryable', 'ABANDON', ['intake_abandoned']],
    // llm_error_terminal
    ['llm_error_terminal', 'RESUME', ['llm_error_terminal']],
    ['llm_error_terminal', 'ABANDON', ['intake_abandoned']],
    // intake_abandoned
    [
      'intake_abandoned',
      'RESUME',
      [
        'intake_started',
        'unit_selection_required',
        'unit_selected',
        'split_proposed',
        'split_finalized',
        'needs_tenant_input',
        'tenant_confirmation_pending',
      ],
    ],
    ['intake_abandoned', 'EXPIRE', ['intake_expired']],
    // intake_expired
    ['intake_expired', 'CREATE_CONVERSATION', ['unit_selected', 'unit_selection_required']],
  ];

  it.each(expectedTransitions)('from %s + %s → %s', (state, trigger, expectedTargets) => {
    const transitions = TRANSITION_MATRIX[state as ConversationState];
    expect(transitions).toBeDefined();
    const targets = transitions![trigger as TransitionTrigger];
    expect(targets).toBeDefined();
    expect([...(targets as ConversationState[])].sort()).toEqual([...expectedTargets].sort());
  });
});

describe('isPhotoAction', () => {
  it('returns true for UPLOAD_PHOTO_INIT', () => {
    expect(isPhotoAction(ActionType.UPLOAD_PHOTO_INIT)).toBe(true);
  });

  it('returns true for UPLOAD_PHOTO_COMPLETE', () => {
    expect(isPhotoAction(ActionType.UPLOAD_PHOTO_COMPLETE)).toBe(true);
  });

  it('returns false for non-photo actions', () => {
    expect(isPhotoAction(ActionType.SELECT_UNIT)).toBe(false);
    expect(isPhotoAction(ActionType.CONFIRM_SPLIT)).toBe(false);
  });
});

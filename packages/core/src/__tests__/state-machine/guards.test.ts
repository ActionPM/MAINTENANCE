import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import {
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
  type TransitionContext,
} from '../../state-machine/guards.js';

describe('resolveSelectUnit', () => {
  it('returns unit_selected when unit_id provided and authorized', () => {
    const ctx: TransitionContext = {
      authorized_unit_ids: ['u1', 'u2'],
      selected_unit_id: 'u1',
    };
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBe(ConversationState.UNIT_SELECTED);
  });

  it('returns unit_selection_required when multiple units and no selection', () => {
    const ctx: TransitionContext = {
      authorized_unit_ids: ['u1', 'u2'],
      selected_unit_id: null,
    };
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBe(ConversationState.UNIT_SELECTION_REQUIRED);
  });

  it('returns unit_selected when single authorized unit', () => {
    const ctx: TransitionContext = {
      authorized_unit_ids: ['u1'],
      selected_unit_id: null,
    };
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBe(ConversationState.UNIT_SELECTED);
  });

  it('returns null when unit_id not in authorized list', () => {
    const ctx: TransitionContext = {
      authorized_unit_ids: ['u1'],
      selected_unit_id: 'u_invalid',
    };
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBeNull();
  });
});

describe('resolveSubmitInitialMessage', () => {
  it('returns split_in_progress when unit is resolved', () => {
    expect(resolveSubmitInitialMessage({ unit_resolved: true })).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });

  it('returns null when unit is not resolved', () => {
    expect(resolveSubmitInitialMessage({ unit_resolved: false })).toBeNull();
  });
});

describe('resolveLlmFailure', () => {
  it('returns retryable on first failure', () => {
    expect(resolveLlmFailure({ retry_count: 0 })).toBe(ConversationState.LLM_ERROR_RETRYABLE);
  });

  it('returns terminal after max retries', () => {
    expect(resolveLlmFailure({ retry_count: 1 })).toBe(ConversationState.LLM_ERROR_TERMINAL);
  });
});

describe('resolveLlmClassifySuccess', () => {
  it('returns tenant_confirmation_pending when no fields need input', () => {
    expect(resolveLlmClassifySuccess({ fields_needing_input: [] })).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });

  it('returns needs_tenant_input when fields need clarification', () => {
    expect(resolveLlmClassifySuccess({ fields_needing_input: ['Maintenance_Object'] })).toBe(ConversationState.NEEDS_TENANT_INPUT);
  });
});

describe('resolveRetryLlm', () => {
  it('returns split_in_progress when prior state was split_in_progress', () => {
    expect(resolveRetryLlm({ prior_state: ConversationState.SPLIT_IN_PROGRESS })).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });

  it('returns classification_in_progress when prior state was classification_in_progress', () => {
    expect(resolveRetryLlm({ prior_state: ConversationState.CLASSIFICATION_IN_PROGRESS })).toBe(ConversationState.CLASSIFICATION_IN_PROGRESS);
  });

  it('returns null for invalid prior state', () => {
    expect(resolveRetryLlm({ prior_state: ConversationState.SUBMITTED })).toBeNull();
  });
});

describe('resolveAbandonResume', () => {
  it('returns the stored prior state', () => {
    expect(resolveAbandonResume({ prior_state: ConversationState.NEEDS_TENANT_INPUT })).toBe(ConversationState.NEEDS_TENANT_INPUT);
  });

  it('returns null when no prior state stored', () => {
    expect(resolveAbandonResume({ prior_state: null })).toBeNull();
  });

  it('returns null when prior state is a terminal state', () => {
    expect(resolveAbandonResume({ prior_state: ConversationState.INTAKE_EXPIRED })).toBeNull();
  });
});

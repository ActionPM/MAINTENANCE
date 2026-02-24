import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType } from '@wo-agent/schemas';
import { SystemEvent } from '../../state-machine/system-events.js';
import {
  isValidTransition,
  getPossibleTargets,
} from '../../state-machine/transition.js';

describe('isValidTransition', () => {
  it('returns true for valid transitions', () => {
    expect(isValidTransition(ConversationState.INTAKE_STARTED, ActionType.SELECT_UNIT)).toBe(true);
    expect(isValidTransition(ConversationState.SPLIT_PROPOSED, ActionType.CONFIRM_SPLIT)).toBe(true);
    expect(isValidTransition(ConversationState.NEEDS_TENANT_INPUT, ActionType.ANSWER_FOLLOWUPS)).toBe(true);
  });

  it('returns true for photo actions from any state', () => {
    const states = [
      ConversationState.INTAKE_STARTED,
      ConversationState.SPLIT_IN_PROGRESS,
      ConversationState.SUBMITTED,
      ConversationState.INTAKE_EXPIRED,
      ConversationState.LLM_ERROR_TERMINAL,
    ];
    for (const state of states) {
      expect(isValidTransition(state, ActionType.UPLOAD_PHOTO_INIT)).toBe(true);
      expect(isValidTransition(state, ActionType.UPLOAD_PHOTO_COMPLETE)).toBe(true);
    }
  });

  it('returns false for invalid transitions', () => {
    expect(isValidTransition(ConversationState.INTAKE_STARTED, ActionType.CONFIRM_SPLIT)).toBe(false);
    expect(isValidTransition(ConversationState.SUBMITTED, ActionType.ANSWER_FOLLOWUPS)).toBe(false);
    expect(isValidTransition(ConversationState.INTAKE_EXPIRED, ActionType.ABANDON)).toBe(false);
    expect(isValidTransition(ConversationState.SPLIT_PROPOSED, SystemEvent.START_CLASSIFICATION)).toBe(false);
  });

  it('returns true for system events in correct states', () => {
    expect(isValidTransition(ConversationState.SPLIT_IN_PROGRESS, SystemEvent.LLM_SPLIT_SUCCESS)).toBe(true);
    expect(isValidTransition(ConversationState.SPLIT_FINALIZED, SystemEvent.START_CLASSIFICATION)).toBe(true);
    expect(isValidTransition(ConversationState.INTAKE_ABANDONED, SystemEvent.EXPIRE)).toBe(true);
  });
});

describe('getPossibleTargets', () => {
  it('returns target states for valid transitions', () => {
    expect(getPossibleTargets(ConversationState.INTAKE_STARTED, ActionType.SELECT_UNIT)).toEqual([
      ConversationState.UNIT_SELECTED,
      ConversationState.UNIT_SELECTION_REQUIRED,
    ]);
  });

  it('returns same state for photo actions', () => {
    expect(getPossibleTargets(ConversationState.SPLIT_PROPOSED, ActionType.UPLOAD_PHOTO_INIT)).toEqual([
      ConversationState.SPLIT_PROPOSED,
    ]);
  });

  it('returns empty array for invalid transitions', () => {
    expect(getPossibleTargets(ConversationState.INTAKE_STARTED, ActionType.CONFIRM_SPLIT)).toEqual([]);
  });

  it('returns single target for deterministic transitions', () => {
    expect(getPossibleTargets(ConversationState.TENANT_CONFIRMATION_PENDING, ActionType.CONFIRM_SUBMISSION)).toEqual([
      ConversationState.SUBMITTED,
    ]);
  });
});

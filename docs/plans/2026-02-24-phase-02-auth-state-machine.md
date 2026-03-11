# Phase 2: Auth/Session Scaffolding + Conversation State Machine

> **For Claude:** REQUIRED SUB-SKILLS: Invoke `@state-machine-implementation` before any state machine code. Invoke `@schema-first-development` before creating the new module. Invoke `@append-only-events` skill when relevant.

**Goal:** Build the conversation state machine (full transition matrix from spec §11.2), JWT auth scaffolding, session lifecycle management, and draft discovery — the foundation the orchestrator (Phase 3) plugs into.

**Architecture:** Pure-function state machine validates transitions against an authoritative matrix encoded as data. Auth layer provides JWT creation/verification and membership checks. Session model tracks conversation lifecycle with abandon/expire/error handling. All code lives in `packages/core`, importing types from `@wo-agent/schemas`.

**Tech Stack:** TypeScript, jose (JWT), vitest, `@wo-agent/schemas`

**Spec sections:** §9 (AuthN/AuthZ), §10 (Orchestrator contract), §11 (State machine + transition matrix), §12 (Draft discovery, abandonment, expiration)

---

## File Structure

```
packages/core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts
    ├── state-machine/
    │   ├── index.ts
    │   ├── system-events.ts
    │   ├── transition-matrix.ts
    │   ├── transition.ts
    │   └── guards.ts
    ├── auth/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── jwt.ts
    │   └── middleware.ts
    ├── session/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── session.ts
    │   └── draft-discovery.ts
    └── __tests__/
        ├── state-machine/
        │   ├── transition-matrix.test.ts
        │   ├── transition.test.ts
        │   └── guards.test.ts
        ├── auth/
        │   ├── jwt.test.ts
        │   └── middleware.test.ts
        ├── session/
        │   ├── session.test.ts
        │   └── draft-discovery.test.ts
        └── integration.test.ts
```

---

## Task 0: Initialize `packages/core` Package

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`

**Step 1: Create package.json**

```json
{
  "name": "@wo-agent/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@wo-agent/schemas": "workspace:*",
    "jose": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.3.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 4: Create empty barrel export**

Create `packages/core/src/index.ts`:

```typescript
// @wo-agent/core — barrel export
// Phase 2: Auth/Session Scaffolding + Conversation State Machine
```

**Step 5: Install dependencies**

```bash
cd /workspaces/MAINTENANCE && pnpm install
```

**Step 6: Verify setup**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm exec tsc --noEmit
```

Expected: no errors.

**Step 7: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/index.ts
git commit -m "chore: initialize packages/core for Phase 2"
```

---

## Task 1: System Events and Transition Types

**Files:**

- Create: `packages/core/src/state-machine/system-events.ts`
- Test: `packages/core/src/__tests__/state-machine/transition-matrix.test.ts`

System events are internal orchestrator triggers NOT in the 15 tenant ActionTypes (spec §11.2). They represent LLM outcomes, auto-classification starts, retries, and expiration.

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/state-machine/transition-matrix.test.ts
import { describe, it, expect } from 'vitest';
import { SystemEvent, ALL_SYSTEM_EVENTS } from '../../state-machine/system-events.js';

describe('SystemEvent', () => {
  it('defines all 6 system events from spec §11.2', () => {
    expect(ALL_SYSTEM_EVENTS).toHaveLength(6);
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_SPLIT_SUCCESS');
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_CLASSIFY_SUCCESS');
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_FAIL');
    expect(ALL_SYSTEM_EVENTS).toContain('START_CLASSIFICATION');
    expect(ALL_SYSTEM_EVENTS).toContain('RETRY_LLM');
    expect(ALL_SYSTEM_EVENTS).toContain('EXPIRE');
  });

  it('has no overlap with ActionType values', () => {
    const { ALL_ACTION_TYPES } = await import('@wo-agent/schemas');
    for (const evt of ALL_SYSTEM_EVENTS) {
      expect(ALL_ACTION_TYPES).not.toContain(evt);
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/transition-matrix.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement system-events.ts**

```typescript
// packages/core/src/state-machine/system-events.ts

/**
 * Internal system events triggered by the orchestrator (spec §11.2).
 * These are NOT tenant actions — they represent LLM outcomes,
 * auto-classification triggers, retries, and expiration.
 */
export const SystemEvent = {
  LLM_SPLIT_SUCCESS: 'LLM_SPLIT_SUCCESS',
  LLM_CLASSIFY_SUCCESS: 'LLM_CLASSIFY_SUCCESS',
  LLM_FAIL: 'LLM_FAIL',
  START_CLASSIFICATION: 'START_CLASSIFICATION',
  RETRY_LLM: 'RETRY_LLM',
  EXPIRE: 'EXPIRE',
} as const;

export type SystemEvent = (typeof SystemEvent)[keyof typeof SystemEvent];

export const ALL_SYSTEM_EVENTS: readonly SystemEvent[] = Object.values(SystemEvent);
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/transition-matrix.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/state-machine/system-events.ts packages/core/src/__tests__/state-machine/transition-matrix.test.ts
git commit -m "feat(core): add SystemEvent enum for internal orchestrator triggers"
```

---

## Task 2: Transition Matrix Data

**Files:**

- Create: `packages/core/src/state-machine/transition-matrix.ts`
- Modify: `packages/core/src/__tests__/state-machine/transition-matrix.test.ts`

The transition matrix is the **authoritative data structure** encoding every valid (state, trigger) → possible next states from spec §11.2. Photo uploads (UPLOAD_PHOTO_INIT/COMPLETE) are handled separately — they are valid from every state and never change state.

**Step 1: Add matrix completeness tests**

Append to `packages/core/src/__tests__/state-machine/transition-matrix.test.ts`:

```typescript
import { ConversationState, ALL_CONVERSATION_STATES, ActionType } from '@wo-agent/schemas';
import {
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  type TransitionTrigger,
} from '../../state-machine/transition-matrix.js';

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
    ['intake_expired', 'CREATE_CONVERSATION', ['intake_started']],
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
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/transition-matrix.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement transition-matrix.ts**

```typescript
// packages/core/src/state-machine/transition-matrix.ts
import { ConversationState, ActionType } from '@wo-agent/schemas';
import { SystemEvent } from './system-events.js';

export type TransitionTrigger = ActionType | SystemEvent;

/**
 * Photo actions are valid from EVERY state and never change the state.
 * Handled as a special case outside the matrix (spec §11.2).
 */
export const PHOTO_ACTIONS: ReadonlySet<ActionType> = new Set([
  ActionType.UPLOAD_PHOTO_INIT,
  ActionType.UPLOAD_PHOTO_COMPLETE,
]);

export function isPhotoAction(trigger: TransitionTrigger): trigger is ActionType {
  return PHOTO_ACTIONS.has(trigger as ActionType);
}

/**
 * States a conversation can resume to from intake_abandoned (spec §11.2).
 * The actual target is resolved by a guard using the stored prior_state.
 */
const ABANDON_RESUME_TARGETS: readonly ConversationState[] = [
  ConversationState.INTAKE_STARTED,
  ConversationState.UNIT_SELECTION_REQUIRED,
  ConversationState.UNIT_SELECTED,
  ConversationState.SPLIT_PROPOSED,
  ConversationState.SPLIT_FINALIZED,
  ConversationState.NEEDS_TENANT_INPUT,
  ConversationState.TENANT_CONFIRMATION_PENDING,
];

/**
 * Authoritative transition matrix (spec §11.2).
 *
 * Maps (state, trigger) → possible next states.
 * Photo actions are excluded — they are valid everywhere and never change state.
 * Multi-target entries require a guard to resolve the actual next state.
 */
export const TRANSITION_MATRIX: Record<
  ConversationState,
  Partial<Record<TransitionTrigger, readonly ConversationState[]>>
> = {
  [ConversationState.INTAKE_STARTED]: {
    [ActionType.SELECT_UNIT]: [
      ConversationState.UNIT_SELECTED,
      ConversationState.UNIT_SELECTION_REQUIRED,
    ],
    [ActionType.SUBMIT_INITIAL_MESSAGE]: [ConversationState.SPLIT_IN_PROGRESS],
    [ActionType.RESUME]: [ConversationState.INTAKE_STARTED],
  },

  [ConversationState.UNIT_SELECTION_REQUIRED]: {
    [ActionType.SELECT_UNIT]: [ConversationState.UNIT_SELECTED],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.UNIT_SELECTED]: {
    [ActionType.SUBMIT_INITIAL_MESSAGE]: [ConversationState.SPLIT_IN_PROGRESS],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SPLIT_IN_PROGRESS]: {
    [SystemEvent.LLM_SPLIT_SUCCESS]: [ConversationState.SPLIT_PROPOSED],
    [SystemEvent.LLM_FAIL]: [
      ConversationState.LLM_ERROR_RETRYABLE,
      ConversationState.LLM_ERROR_TERMINAL,
    ],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SPLIT_PROPOSED]: {
    [ActionType.CONFIRM_SPLIT]: [ConversationState.SPLIT_FINALIZED],
    [ActionType.MERGE_ISSUES]: [ConversationState.SPLIT_PROPOSED],
    [ActionType.EDIT_ISSUE]: [ConversationState.SPLIT_PROPOSED],
    [ActionType.ADD_ISSUE]: [ConversationState.SPLIT_PROPOSED],
    [ActionType.REJECT_SPLIT]: [ConversationState.SPLIT_FINALIZED],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SPLIT_FINALIZED]: {
    [SystemEvent.START_CLASSIFICATION]: [ConversationState.CLASSIFICATION_IN_PROGRESS],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.CLASSIFICATION_IN_PROGRESS]: {
    [SystemEvent.LLM_CLASSIFY_SUCCESS]: [
      ConversationState.NEEDS_TENANT_INPUT,
      ConversationState.TENANT_CONFIRMATION_PENDING,
    ],
    [SystemEvent.LLM_FAIL]: [
      ConversationState.LLM_ERROR_RETRYABLE,
      ConversationState.LLM_ERROR_TERMINAL,
    ],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.NEEDS_TENANT_INPUT]: {
    [ActionType.ANSWER_FOLLOWUPS]: [ConversationState.CLASSIFICATION_IN_PROGRESS],
    [ActionType.SUBMIT_ADDITIONAL_MESSAGE]: [ConversationState.NEEDS_TENANT_INPUT],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.TENANT_CONFIRMATION_PENDING]: {
    [ActionType.CONFIRM_SUBMISSION]: [ConversationState.SUBMITTED],
    [ActionType.SUBMIT_ADDITIONAL_MESSAGE]: [ConversationState.TENANT_CONFIRMATION_PENDING],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.SUBMITTED]: {
    [ActionType.SUBMIT_INITIAL_MESSAGE]: [ConversationState.SUBMITTED], // triggers new conversation (orchestrator handles)
    [ActionType.RESUME]: [ConversationState.SUBMITTED],
  },

  [ConversationState.LLM_ERROR_RETRYABLE]: {
    [SystemEvent.RETRY_LLM]: [
      ConversationState.SPLIT_IN_PROGRESS,
      ConversationState.CLASSIFICATION_IN_PROGRESS,
    ],
    [ActionType.RESUME]: [ConversationState.LLM_ERROR_RETRYABLE],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.LLM_ERROR_TERMINAL]: {
    [ActionType.RESUME]: [ConversationState.LLM_ERROR_TERMINAL],
    [ActionType.ABANDON]: [ConversationState.INTAKE_ABANDONED],
  },

  [ConversationState.INTAKE_ABANDONED]: {
    [ActionType.RESUME]: ABANDON_RESUME_TARGETS,
    [SystemEvent.EXPIRE]: [ConversationState.INTAKE_EXPIRED],
  },

  [ConversationState.INTAKE_EXPIRED]: {
    [ActionType.CREATE_CONVERSATION]: [ConversationState.INTAKE_STARTED],
  },
};
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/transition-matrix.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/state-machine/transition-matrix.ts packages/core/src/__tests__/state-machine/transition-matrix.test.ts
git commit -m "feat(core): add authoritative transition matrix from spec §11.2"
```

---

## Task 3: Core Transition Function

**Files:**

- Create: `packages/core/src/state-machine/transition.ts`
- Create: `packages/core/src/__tests__/state-machine/transition.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/state-machine/transition.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType } from '@wo-agent/schemas';
import { SystemEvent } from '../../state-machine/system-events.js';
import { isValidTransition, getPossibleTargets } from '../../state-machine/transition.js';

describe('isValidTransition', () => {
  it('returns true for valid transitions', () => {
    expect(isValidTransition(ConversationState.INTAKE_STARTED, ActionType.SELECT_UNIT)).toBe(true);
    expect(isValidTransition(ConversationState.SPLIT_PROPOSED, ActionType.CONFIRM_SPLIT)).toBe(
      true,
    );
    expect(
      isValidTransition(ConversationState.NEEDS_TENANT_INPUT, ActionType.ANSWER_FOLLOWUPS),
    ).toBe(true);
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
    expect(isValidTransition(ConversationState.INTAKE_STARTED, ActionType.CONFIRM_SPLIT)).toBe(
      false,
    );
    expect(isValidTransition(ConversationState.SUBMITTED, ActionType.ANSWER_FOLLOWUPS)).toBe(false);
    expect(isValidTransition(ConversationState.INTAKE_EXPIRED, ActionType.ABANDON)).toBe(false);
    expect(
      isValidTransition(ConversationState.SPLIT_PROPOSED, SystemEvent.START_CLASSIFICATION),
    ).toBe(false);
  });

  it('returns true for system events in correct states', () => {
    expect(
      isValidTransition(ConversationState.SPLIT_IN_PROGRESS, SystemEvent.LLM_SPLIT_SUCCESS),
    ).toBe(true);
    expect(
      isValidTransition(ConversationState.SPLIT_FINALIZED, SystemEvent.START_CLASSIFICATION),
    ).toBe(true);
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
    expect(
      getPossibleTargets(ConversationState.SPLIT_PROPOSED, ActionType.UPLOAD_PHOTO_INIT),
    ).toEqual([ConversationState.SPLIT_PROPOSED]);
  });

  it('returns empty array for invalid transitions', () => {
    expect(getPossibleTargets(ConversationState.INTAKE_STARTED, ActionType.CONFIRM_SPLIT)).toEqual(
      [],
    );
  });

  it('returns single target for deterministic transitions', () => {
    expect(
      getPossibleTargets(
        ConversationState.TENANT_CONFIRMATION_PENDING,
        ActionType.CONFIRM_SUBMISSION,
      ),
    ).toEqual([ConversationState.SUBMITTED]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/transition.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement transition.ts**

```typescript
// packages/core/src/state-machine/transition.ts
import type { ConversationState } from '@wo-agent/schemas';
import { TRANSITION_MATRIX, isPhotoAction, type TransitionTrigger } from './transition-matrix.js';

/**
 * Check if a transition is valid from the given state.
 * Photo actions (UPLOAD_PHOTO_INIT/COMPLETE) are always valid.
 */
export function isValidTransition(
  currentState: ConversationState,
  trigger: TransitionTrigger,
): boolean {
  if (isPhotoAction(trigger)) return true;

  const stateTransitions = TRANSITION_MATRIX[currentState];
  return trigger in (stateTransitions ?? {});
}

/**
 * Get the possible target states for a transition.
 * Returns empty array if the transition is invalid.
 * Photo actions return [currentState] (no state change).
 */
export function getPossibleTargets(
  currentState: ConversationState,
  trigger: TransitionTrigger,
): readonly ConversationState[] {
  if (isPhotoAction(trigger)) return [currentState];

  const stateTransitions = TRANSITION_MATRIX[currentState];
  return stateTransitions?.[trigger] ?? [];
}
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/transition.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/state-machine/transition.ts packages/core/src/__tests__/state-machine/transition.test.ts
git commit -m "feat(core): add transition validation functions"
```

---

## Task 4: Transition Guards

**Files:**

- Create: `packages/core/src/state-machine/guards.ts`
- Create: `packages/core/src/__tests__/state-machine/guards.test.ts`

Guards resolve multi-target transitions. The orchestrator (Phase 3) provides the context; guards are pure functions.

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/state-machine/guards.test.ts
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
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBe(
      ConversationState.UNIT_SELECTED,
    );
  });

  it('returns unit_selection_required when multiple units and no selection', () => {
    const ctx: TransitionContext = {
      authorized_unit_ids: ['u1', 'u2'],
      selected_unit_id: null,
    };
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBe(
      ConversationState.UNIT_SELECTION_REQUIRED,
    );
  });

  it('returns unit_selected when single authorized unit', () => {
    const ctx: TransitionContext = {
      authorized_unit_ids: ['u1'],
      selected_unit_id: null,
    };
    expect(resolveSelectUnit(ConversationState.INTAKE_STARTED, ctx)).toBe(
      ConversationState.UNIT_SELECTED,
    );
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
    expect(resolveSubmitInitialMessage({ unit_resolved: true })).toBe(
      ConversationState.SPLIT_IN_PROGRESS,
    );
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
    expect(resolveLlmClassifySuccess({ fields_needing_input: [] })).toBe(
      ConversationState.TENANT_CONFIRMATION_PENDING,
    );
  });

  it('returns needs_tenant_input when fields need clarification', () => {
    expect(resolveLlmClassifySuccess({ fields_needing_input: ['Maintenance_Object'] })).toBe(
      ConversationState.NEEDS_TENANT_INPUT,
    );
  });
});

describe('resolveRetryLlm', () => {
  it('returns split_in_progress when prior state was split_in_progress', () => {
    expect(resolveRetryLlm({ prior_state: ConversationState.SPLIT_IN_PROGRESS })).toBe(
      ConversationState.SPLIT_IN_PROGRESS,
    );
  });

  it('returns classification_in_progress when prior state was classification_in_progress', () => {
    expect(resolveRetryLlm({ prior_state: ConversationState.CLASSIFICATION_IN_PROGRESS })).toBe(
      ConversationState.CLASSIFICATION_IN_PROGRESS,
    );
  });

  it('returns null for invalid prior state', () => {
    expect(resolveRetryLlm({ prior_state: ConversationState.SUBMITTED })).toBeNull();
  });
});

describe('resolveAbandonResume', () => {
  it('returns the stored prior state', () => {
    expect(resolveAbandonResume({ prior_state: ConversationState.NEEDS_TENANT_INPUT })).toBe(
      ConversationState.NEEDS_TENANT_INPUT,
    );
  });

  it('returns null when no prior state stored', () => {
    expect(resolveAbandonResume({ prior_state: null })).toBeNull();
  });

  it('returns null when prior state is a terminal state', () => {
    expect(resolveAbandonResume({ prior_state: ConversationState.INTAKE_EXPIRED })).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/guards.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement guards.ts**

```typescript
// packages/core/src/state-machine/guards.ts
import { ConversationState } from '@wo-agent/schemas';

/**
 * Context provided to guards to resolve multi-target transitions.
 * The orchestrator populates this from session state and action payload.
 */
export interface TransitionContext {
  authorized_unit_ids?: readonly string[];
  selected_unit_id?: string | null;
  unit_resolved?: boolean;
  retry_count?: number;
  fields_needing_input?: readonly string[];
  prior_state?: ConversationState | null;
}

const VALID_RETRY_PRIOR_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.SPLIT_IN_PROGRESS,
  ConversationState.CLASSIFICATION_IN_PROGRESS,
]);

const TERMINAL_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.SUBMITTED,
  ConversationState.INTAKE_EXPIRED,
  ConversationState.LLM_ERROR_TERMINAL,
]);

/**
 * Resolve SELECT_UNIT target state.
 * - Single authorized unit → auto-select → unit_selected
 * - Multiple units + valid selection → unit_selected
 * - Multiple units + no selection → unit_selection_required
 * - Invalid unit_id → null (rejected)
 */
export function resolveSelectUnit(
  _currentState: ConversationState,
  ctx: TransitionContext,
): ConversationState | null {
  const units = ctx.authorized_unit_ids ?? [];
  const selected = ctx.selected_unit_id ?? null;

  if (units.length === 1) {
    return ConversationState.UNIT_SELECTED;
  }

  if (selected === null) {
    return ConversationState.UNIT_SELECTION_REQUIRED;
  }

  if (!units.includes(selected)) {
    return null; // unauthorized unit
  }

  return ConversationState.UNIT_SELECTED;
}

/**
 * Guard for SUBMIT_INITIAL_MESSAGE — requires unit resolved (spec §11.2).
 */
export function resolveSubmitInitialMessage(
  ctx: Pick<TransitionContext, 'unit_resolved'>,
): ConversationState | null {
  return ctx.unit_resolved ? ConversationState.SPLIT_IN_PROGRESS : null;
}

/**
 * Resolve LLM_FAIL target — retryable on first failure, terminal after.
 */
export function resolveLlmFailure(ctx: Pick<TransitionContext, 'retry_count'>): ConversationState {
  return (ctx.retry_count ?? 0) < 1
    ? ConversationState.LLM_ERROR_RETRYABLE
    : ConversationState.LLM_ERROR_TERMINAL;
}

/**
 * Resolve LLM_CLASSIFY_SUCCESS — needs input or ready for confirmation.
 */
export function resolveLlmClassifySuccess(
  ctx: Pick<TransitionContext, 'fields_needing_input'>,
): ConversationState {
  const fields = ctx.fields_needing_input ?? [];
  return fields.length > 0
    ? ConversationState.NEEDS_TENANT_INPUT
    : ConversationState.TENANT_CONFIRMATION_PENDING;
}

/**
 * Resolve RETRY_LLM — return to the LLM in-progress state that failed.
 */
export function resolveRetryLlm(
  ctx: Pick<TransitionContext, 'prior_state'>,
): ConversationState | null {
  const prior = ctx.prior_state ?? null;
  if (prior === null || !VALID_RETRY_PRIOR_STATES.has(prior)) {
    return null;
  }
  return prior;
}

/**
 * Resolve RESUME from intake_abandoned — return to stored prior state.
 */
export function resolveAbandonResume(
  ctx: Pick<TransitionContext, 'prior_state'>,
): ConversationState | null {
  const prior = ctx.prior_state ?? null;
  if (prior === null || TERMINAL_STATES.has(prior)) {
    return null;
  }
  return prior;
}
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/state-machine/guards.test.ts
```

Expected: ALL PASS

**Step 5: Create state-machine barrel export**

Create `packages/core/src/state-machine/index.ts`:

```typescript
export { SystemEvent, ALL_SYSTEM_EVENTS } from './system-events.js';
export type { SystemEvent as SystemEventType } from './system-events.js';

export {
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  type TransitionTrigger,
} from './transition-matrix.js';

export { isValidTransition, getPossibleTargets } from './transition.js';

export {
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
  type TransitionContext,
} from './guards.js';
```

**Step 6: Commit**

```bash
git add packages/core/src/state-machine/
git commit -m "feat(core): add transition guards for conditional state resolution"
```

---

## Task 5: Auth Types and JWT Config

**Files:**

- Create: `packages/core/src/auth/types.ts`

Pure type definitions — no tests needed for types alone.

**Step 1: Implement auth types**

```typescript
// packages/core/src/auth/types.ts
import type { AuthContext } from '@wo-agent/schemas';

/**
 * JWT payload shape embedded in access tokens.
 * Maps to AuthContext fields for server-side extraction.
 */
export interface JwtPayload {
  readonly sub: string; // tenant_user_id
  readonly account_id: string; // tenant_account_id
  readonly unit_ids: readonly string[]; // authorized_unit_ids
  readonly iat?: number;
  readonly exp?: number;
  readonly iss?: string;
  readonly aud?: string;
}

/**
 * Configuration for JWT token creation and verification.
 */
export interface JwtConfig {
  readonly accessTokenSecret: Uint8Array;
  readonly refreshTokenSecret: Uint8Array;
  readonly accessTokenExpiry: string; // e.g., '15m'
  readonly refreshTokenExpiry: string; // e.g., '7d'
  readonly issuer: string;
  readonly audience: string;
}

/**
 * Token pair returned on successful authentication.
 */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * Result of token verification — success or typed error.
 */
export type TokenVerifyResult =
  | { readonly valid: true; readonly payload: JwtPayload }
  | { readonly valid: false; readonly error: AuthError };

/**
 * Auth-specific error codes.
 */
export type AuthErrorCode =
  | 'TOKEN_MISSING'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'UNIT_NOT_AUTHORIZED'
  | 'MEMBERSHIP_CHECK_FAILED';

export interface AuthError {
  readonly code: AuthErrorCode;
  readonly message: string;
}

/**
 * Convert a verified JWT payload to the schemas AuthContext.
 */
export function toAuthContext(payload: JwtPayload): AuthContext {
  return {
    tenant_user_id: payload.sub,
    tenant_account_id: payload.account_id,
    authorized_unit_ids: payload.unit_ids,
  };
}
```

**Step 2: Commit**

```bash
git add packages/core/src/auth/types.ts
git commit -m "feat(core): add auth types for JWT payload, config, and errors"
```

---

## Task 6: JWT Utilities

**Files:**

- Create: `packages/core/src/auth/jwt.ts`
- Create: `packages/core/src/__tests__/auth/jwt.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/auth/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { createTokenPair, verifyAccessToken, verifyRefreshToken } from '../../auth/jwt.js';
import type { JwtConfig } from '../../auth/types.js';

const TEST_CONFIG: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('test-access-secret-at-least-32-chars!!'),
  refreshTokenSecret: new TextEncoder().encode('test-refresh-secret-at-least-32-chars!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent-test',
  audience: 'wo-agent-test',
};

describe('createTokenPair', () => {
  it('creates an access token and refresh token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1', 'u2'] },
      TEST_CONFIG,
    );
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });
});

describe('verifyAccessToken', () => {
  it('verifies a valid access token and returns payload', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1'] },
      TEST_CONFIG,
    );
    const result = await verifyAccessToken(pair.accessToken, TEST_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('user-1');
      expect(result.payload.account_id).toBe('acct-1');
      expect(result.payload.unit_ids).toEqual(['u1']);
    }
  });

  it('rejects a tampered token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: [] },
      TEST_CONFIG,
    );
    const result = await verifyAccessToken(pair.accessToken + 'tampered', TEST_CONFIG);
    expect(result.valid).toBe(false);
  });

  it('rejects a refresh token used as access token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: [] },
      TEST_CONFIG,
    );
    const result = await verifyAccessToken(pair.refreshToken, TEST_CONFIG);
    expect(result.valid).toBe(false);
  });
});

describe('verifyRefreshToken', () => {
  it('verifies a valid refresh token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1'] },
      TEST_CONFIG,
    );
    const result = await verifyRefreshToken(pair.refreshToken, TEST_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('user-1');
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/auth/jwt.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement jwt.ts**

```typescript
// packages/core/src/auth/jwt.ts
import { SignJWT, jwtVerify } from 'jose';
import type { JwtConfig, JwtPayload, TokenPair, TokenVerifyResult } from './types.js';

/**
 * Create an access + refresh token pair for a tenant.
 */
export async function createTokenPair(
  payload: Pick<JwtPayload, 'sub' | 'account_id' | 'unit_ids'>,
  config: JwtConfig,
): Promise<TokenPair> {
  const accessToken = await new SignJWT({
    account_id: payload.account_id,
    unit_ids: payload.unit_ids,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.accessTokenExpiry)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(config.accessTokenSecret);

  const refreshToken = await new SignJWT({
    account_id: payload.account_id,
    unit_ids: payload.unit_ids,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.refreshTokenExpiry)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .sign(config.refreshTokenSecret);

  return { accessToken, refreshToken };
}

async function verifyToken(
  token: string,
  secret: Uint8Array,
  config: JwtConfig,
): Promise<TokenVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: config.issuer,
      audience: config.audience,
    });

    return {
      valid: true,
      payload: {
        sub: payload.sub!,
        account_id: payload.account_id as string,
        unit_ids: payload.unit_ids as string[],
        iat: payload.iat,
        exp: payload.exp,
        iss: payload.iss,
        aud: payload.aud as string | undefined,
      },
    };
  } catch {
    return {
      valid: false,
      error: { code: 'TOKEN_INVALID', message: 'Token verification failed' },
    };
  }
}

/**
 * Verify an access token. Returns typed payload or error.
 */
export async function verifyAccessToken(
  token: string,
  config: JwtConfig,
): Promise<TokenVerifyResult> {
  return verifyToken(token, config.accessTokenSecret, config);
}

/**
 * Verify a refresh token. Returns typed payload or error.
 */
export async function verifyRefreshToken(
  token: string,
  config: JwtConfig,
): Promise<TokenVerifyResult> {
  return verifyToken(token, config.refreshTokenSecret, config);
}
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/auth/jwt.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/core/src/auth/jwt.ts packages/core/src/__tests__/auth/jwt.test.ts
git commit -m "feat(core): add JWT creation and verification with jose"
```

---

## Task 7: Auth Middleware

**Files:**

- Create: `packages/core/src/auth/middleware.ts`
- Create: `packages/core/src/__tests__/auth/middleware.test.ts`

Framework-agnostic pure functions. Next.js wiring happens in Phase 3.

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/auth/middleware.test.ts
import { describe, it, expect } from 'vitest';
import { extractAuthFromHeader, validateUnitAccess } from '../../auth/middleware.js';
import { createTokenPair } from '../../auth/jwt.js';
import type { JwtConfig } from '../../auth/types.js';

const TEST_CONFIG: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('test-access-secret-at-least-32-chars!!'),
  refreshTokenSecret: new TextEncoder().encode('test-refresh-secret-at-least-32-chars!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent-test',
  audience: 'wo-agent-test',
};

describe('extractAuthFromHeader', () => {
  it('extracts AuthContext from a valid Bearer token', async () => {
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1', 'u2'] },
      TEST_CONFIG,
    );
    const result = await extractAuthFromHeader(`Bearer ${pair.accessToken}`, TEST_CONFIG);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.authContext.tenant_user_id).toBe('user-1');
      expect(result.authContext.tenant_account_id).toBe('acct-1');
      expect(result.authContext.authorized_unit_ids).toEqual(['u1', 'u2']);
    }
  });

  it('returns error for missing header', async () => {
    const result = await extractAuthFromHeader(undefined, TEST_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('TOKEN_MISSING');
    }
  });

  it('returns error for malformed header', async () => {
    const result = await extractAuthFromHeader('NotBearer xyz', TEST_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('TOKEN_INVALID');
    }
  });

  it('returns error for invalid token', async () => {
    const result = await extractAuthFromHeader('Bearer invalid.token.here', TEST_CONFIG);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('TOKEN_INVALID');
    }
  });
});

describe('validateUnitAccess', () => {
  it('returns true when unit_id is in authorized list', () => {
    expect(validateUnitAccess(['u1', 'u2', 'u3'], 'u2')).toBe(true);
  });

  it('returns false when unit_id is not in authorized list', () => {
    expect(validateUnitAccess(['u1', 'u2'], 'u_other')).toBe(false);
  });

  it('returns false for empty authorized list', () => {
    expect(validateUnitAccess([], 'u1')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/auth/middleware.test.ts
```

Expected: FAIL

**Step 3: Implement middleware.ts**

```typescript
// packages/core/src/auth/middleware.ts
import type { AuthContext } from '@wo-agent/schemas';
import type { AuthError, JwtConfig } from './types.js';
import { toAuthContext } from './types.js';
import { verifyAccessToken } from './jwt.js';

export type AuthExtractionResult =
  | { readonly valid: true; readonly authContext: AuthContext }
  | { readonly valid: false; readonly error: AuthError };

/**
 * Extract AuthContext from an Authorization header value.
 * Expects "Bearer <token>" format. Returns typed error on failure.
 */
export async function extractAuthFromHeader(
  authHeader: string | undefined | null,
  config: JwtConfig,
): Promise<AuthExtractionResult> {
  if (!authHeader) {
    return {
      valid: false,
      error: { code: 'TOKEN_MISSING', message: 'Authorization header is required' },
    };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return {
      valid: false,
      error: { code: 'TOKEN_INVALID', message: 'Expected Bearer token format' },
    };
  }

  const result = await verifyAccessToken(parts[1], config);
  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return { valid: true, authContext: toAuthContext(result.payload) };
}

/**
 * Check if a unit_id is in the tenant's authorized list (spec §9).
 * Tenant cannot set unit/property IDs — server derives from membership.
 */
export function validateUnitAccess(authorizedUnitIds: readonly string[], unitId: string): boolean {
  return authorizedUnitIds.includes(unitId);
}
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/auth/middleware.test.ts
```

Expected: ALL PASS

**Step 5: Create auth barrel export**

Create `packages/core/src/auth/index.ts`:

```typescript
export type {
  JwtPayload,
  JwtConfig,
  TokenPair,
  TokenVerifyResult,
  AuthErrorCode,
  AuthError,
} from './types.js';
export { toAuthContext } from './types.js';

export { createTokenPair, verifyAccessToken, verifyRefreshToken } from './jwt.js';

export type { AuthExtractionResult } from './middleware.js';
export { extractAuthFromHeader, validateUnitAccess } from './middleware.js';
```

**Step 6: Commit**

```bash
git add packages/core/src/auth/
git commit -m "feat(core): add auth middleware with JWT extraction and membership checks"
```

---

## Task 8: Conversation Session Types and Creation

**Files:**

- Create: `packages/core/src/session/types.ts`
- Create: `packages/core/src/session/session.ts`
- Create: `packages/core/src/__tests__/session/session.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/session/session.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { createSession, updateSessionState, touchActivity } from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';

describe('createSession', () => {
  it('creates a session in intake_started state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1', 'u2'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });

    expect(session.conversation_id).toBe('conv-1');
    expect(session.state).toBe(ConversationState.INTAKE_STARTED);
    expect(session.unit_id).toBeNull();
    expect(session.authorized_unit_ids).toEqual(['u1', 'u2']);
    expect(session.prior_state_before_error).toBeNull();
    expect(session.created_at).toBeTruthy();
    expect(session.last_activity_at).toBeTruthy();
  });
});

describe('updateSessionState', () => {
  it('updates the state and last_activity_at', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });

    const updated = updateSessionState(session, ConversationState.UNIT_SELECTED);
    expect(updated.state).toBe(ConversationState.UNIT_SELECTED);
    expect(updated.last_activity_at).not.toBe(session.last_activity_at);
  });

  it('stores prior state when transitioning to error state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });

    const inProgress = updateSessionState(session, ConversationState.SPLIT_IN_PROGRESS);
    const errored = updateSessionState(inProgress, ConversationState.LLM_ERROR_RETRYABLE);
    expect(errored.prior_state_before_error).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });

  it('stores prior state when transitioning to abandoned', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });

    const withUnit = updateSessionState(session, ConversationState.UNIT_SELECTED);
    const abandoned = updateSessionState(withUnit, ConversationState.INTAKE_ABANDONED);
    expect(abandoned.prior_state_before_error).toBe(ConversationState.UNIT_SELECTED);
  });

  it('does not overwrite prior state for non-error transitions', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });

    const updated = updateSessionState(session, ConversationState.UNIT_SELECTED);
    expect(updated.prior_state_before_error).toBeNull();
  });
});

describe('touchActivity', () => {
  it('updates last_activity_at without changing state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });

    const touched = touchActivity(session);
    expect(touched.state).toBe(session.state);
    expect(touched.last_activity_at).not.toBe(session.last_activity_at);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/session/session.test.ts
```

Expected: FAIL

**Step 3: Implement types.ts**

```typescript
// packages/core/src/session/types.ts
import type { ConversationState, PinnedVersions } from '@wo-agent/schemas';

/**
 * Server-side conversation session (spec §11, §12).
 * This is the authoritative state — ConversationSnapshot (from schemas)
 * is the client-facing projection produced from this.
 */
export interface ConversationSession {
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly state: ConversationState;
  readonly unit_id: string | null;
  readonly authorized_unit_ids: readonly string[];
  readonly pinned_versions: PinnedVersions;
  readonly prior_state_before_error: ConversationState | null;
  readonly draft_photo_ids: readonly string[];
  readonly created_at: string;
  readonly last_activity_at: string;
}

export interface CreateSessionInput {
  readonly conversation_id: string;
  readonly tenant_user_id: string;
  readonly tenant_account_id: string;
  readonly authorized_unit_ids: readonly string[];
  readonly pinned_versions: PinnedVersions;
}
```

**Step 4: Implement session.ts**

```typescript
// packages/core/src/session/session.ts
import { ConversationState } from '@wo-agent/schemas';
import type { ConversationSession, CreateSessionInput } from './types.js';

const ERROR_STATES: ReadonlySet<ConversationState> = new Set([
  ConversationState.LLM_ERROR_RETRYABLE,
  ConversationState.LLM_ERROR_TERMINAL,
  ConversationState.INTAKE_ABANDONED,
]);

/**
 * Create a new conversation session in intake_started state.
 */
export function createSession(input: CreateSessionInput): ConversationSession {
  const now = new Date().toISOString();
  return {
    conversation_id: input.conversation_id,
    tenant_user_id: input.tenant_user_id,
    tenant_account_id: input.tenant_account_id,
    state: ConversationState.INTAKE_STARTED,
    unit_id: null,
    authorized_unit_ids: input.authorized_unit_ids,
    pinned_versions: input.pinned_versions,
    prior_state_before_error: null,
    draft_photo_ids: [],
    created_at: now,
    last_activity_at: now,
  };
}

/**
 * Transition session to a new state.
 * Stores prior state when entering error/abandoned states (for RESUME/RETRY recovery).
 */
export function updateSessionState(
  session: ConversationSession,
  newState: ConversationState,
): ConversationSession {
  const priorState = ERROR_STATES.has(newState) ? session.state : session.prior_state_before_error;
  return {
    ...session,
    state: newState,
    prior_state_before_error: priorState,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Update last_activity_at without changing state (e.g., for photo uploads).
 */
export function touchActivity(session: ConversationSession): ConversationSession {
  return {
    ...session,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Set the resolved unit_id on the session.
 */
export function setSessionUnit(session: ConversationSession, unitId: string): ConversationSession {
  return {
    ...session,
    unit_id: unitId,
    last_activity_at: new Date().toISOString(),
  };
}
```

**Step 5: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/session/session.test.ts
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/core/src/session/types.ts packages/core/src/session/session.ts packages/core/src/__tests__/session/session.test.ts
git commit -m "feat(core): add conversation session model with state tracking"
```

---

## Task 9: Draft Discovery

**Files:**

- Create: `packages/core/src/session/draft-discovery.ts`
- Create: `packages/core/src/__tests__/session/draft-discovery.test.ts`

Spec §12.1: `GET /conversations/drafts` returns resumable drafts for a tenant, ordered by `last_activity_at`, max 3 shown. Resumed conversations retain pinned versions.

**Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/session/draft-discovery.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import { filterResumableDrafts } from '../../session/draft-discovery.js';
import type { ConversationSession } from '../../session/types.js';
import { createSession } from '../../session/session.js';

function makeSession(overrides: Partial<ConversationSession>): ConversationSession {
  const base = createSession({
    conversation_id: 'conv-default',
    tenant_user_id: 'user-1',
    tenant_account_id: 'acct-1',
    authorized_unit_ids: ['u1'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'gpt-4',
      prompt_version: '1.0.0',
    },
  });
  return { ...base, ...overrides };
}

describe('filterResumableDrafts', () => {
  it('returns only sessions in resumable states', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', state: ConversationState.NEEDS_TENANT_INPUT }),
      makeSession({ conversation_id: 'c2', state: ConversationState.SUBMITTED }),
      makeSession({ conversation_id: 'c3', state: ConversationState.SPLIT_PROPOSED }),
      makeSession({ conversation_id: 'c4', state: ConversationState.INTAKE_EXPIRED }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result.map((s) => s.conversation_id)).toEqual(['c1', 'c3']);
  });

  it('filters by tenant_user_id', () => {
    const sessions = [
      makeSession({
        conversation_id: 'c1',
        tenant_user_id: 'user-1',
        state: ConversationState.SPLIT_PROPOSED,
      }),
      makeSession({
        conversation_id: 'c2',
        tenant_user_id: 'user-2',
        state: ConversationState.SPLIT_PROPOSED,
      }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].conversation_id).toBe('c1');
  });

  it('sorts by last_activity_at descending (most recent first)', () => {
    const sessions = [
      makeSession({
        conversation_id: 'c1',
        state: ConversationState.SPLIT_PROPOSED,
        last_activity_at: '2026-01-01T00:00:00Z',
      }),
      makeSession({
        conversation_id: 'c2',
        state: ConversationState.NEEDS_TENANT_INPUT,
        last_activity_at: '2026-01-03T00:00:00Z',
      }),
      makeSession({
        conversation_id: 'c3',
        state: ConversationState.UNIT_SELECTION_REQUIRED,
        last_activity_at: '2026-01-02T00:00:00Z',
      }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result.map((s) => s.conversation_id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('limits to 3 results', () => {
    const sessions = [
      makeSession({
        conversation_id: 'c1',
        state: ConversationState.SPLIT_PROPOSED,
        last_activity_at: '2026-01-04T00:00:00Z',
      }),
      makeSession({
        conversation_id: 'c2',
        state: ConversationState.NEEDS_TENANT_INPUT,
        last_activity_at: '2026-01-03T00:00:00Z',
      }),
      makeSession({
        conversation_id: 'c3',
        state: ConversationState.UNIT_SELECTION_REQUIRED,
        last_activity_at: '2026-01-02T00:00:00Z',
      }),
      makeSession({
        conversation_id: 'c4',
        state: ConversationState.LLM_ERROR_RETRYABLE,
        last_activity_at: '2026-01-01T00:00:00Z',
      }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.conversation_id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns empty array when no resumable drafts exist', () => {
    const sessions = [
      makeSession({ conversation_id: 'c1', state: ConversationState.SUBMITTED }),
      makeSession({ conversation_id: 'c2', state: ConversationState.INTAKE_EXPIRED }),
    ];
    const result = filterResumableDrafts(sessions, 'user-1');
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/session/draft-discovery.test.ts
```

Expected: FAIL

**Step 3: Implement draft-discovery.ts**

```typescript
// packages/core/src/session/draft-discovery.ts
import { RESUMABLE_STATES } from '@wo-agent/schemas';
import type { ConversationSession } from './types.js';

const MAX_DRAFTS = 3;

/**
 * Filter and sort resumable drafts for a tenant (spec §12.1).
 *
 * Resumable states: unit_selection_required, split_proposed,
 * classification_in_progress, needs_tenant_input,
 * tenant_confirmation_pending, llm_error_retryable, intake_abandoned.
 *
 * Sorted by last_activity_at descending, limited to 3.
 * Resumed conversations retain their pinned versions.
 */
export function filterResumableDrafts(
  sessions: readonly ConversationSession[],
  tenantUserId: string,
): ConversationSession[] {
  return sessions
    .filter((s) => s.tenant_user_id === tenantUserId && RESUMABLE_STATES.has(s.state))
    .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
    .slice(0, MAX_DRAFTS);
}
```

**Step 4: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/session/draft-discovery.test.ts
```

Expected: ALL PASS

**Step 5: Create session barrel export**

Create `packages/core/src/session/index.ts`:

```typescript
export type { ConversationSession, CreateSessionInput } from './types.js';
export { createSession, updateSessionState, touchActivity, setSessionUnit } from './session.js';
export { filterResumableDrafts } from './draft-discovery.js';
```

**Step 6: Commit**

```bash
git add packages/core/src/session/
git commit -m "feat(core): add draft discovery with resumable state filtering"
```

---

## Task 10: Abandonment and Expiration

**Files:**

- Modify: `packages/core/src/session/session.ts`
- Modify: `packages/core/src/__tests__/session/session.test.ts`

Spec §12.3: Unseen artifacts expire after 60 min. Abandoned conversations can be resumed or expired by system.

**Step 1: Add failing tests**

Append to `packages/core/src/__tests__/session/session.test.ts`:

```typescript
import {
  markAbandoned,
  markExpired,
  isExpired,
  type ExpirationConfig,
} from '../../session/session.js';

describe('markAbandoned', () => {
  it('transitions to intake_abandoned and stores prior state', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });
    const withUnit = updateSessionState(session, ConversationState.UNIT_SELECTED);
    const abandoned = markAbandoned(withUnit);
    expect(abandoned.state).toBe(ConversationState.INTAKE_ABANDONED);
    expect(abandoned.prior_state_before_error).toBe(ConversationState.UNIT_SELECTED);
  });
});

describe('markExpired', () => {
  it('transitions to intake_expired', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });
    const abandoned = markAbandoned(session);
    const expired = markExpired(abandoned);
    expect(expired.state).toBe(ConversationState.INTAKE_EXPIRED);
  });
});

describe('isExpired', () => {
  const config: ExpirationConfig = { abandonedExpiryMs: 60 * 60 * 1000 }; // 1 hour

  it('returns false for non-abandoned sessions', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });
    expect(isExpired(session, config)).toBe(false);
  });

  it('returns true when abandoned session exceeds expiry time', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });
    const abandoned = markAbandoned(session);
    const oldAbandoned = {
      ...abandoned,
      last_activity_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    };
    expect(isExpired(oldAbandoned, config)).toBe(true);
  });

  it('returns false when abandoned session is within expiry window', () => {
    const session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0.0',
        schema_version: '1.0.0',
        model_id: 'gpt-4',
        prompt_version: '1.0.0',
      },
    });
    const abandoned = markAbandoned(session);
    expect(isExpired(abandoned, config)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/session/session.test.ts
```

Expected: FAIL — missing exports.

**Step 3: Add implementations to session.ts**

Append to `packages/core/src/session/session.ts`:

```typescript
export interface ExpirationConfig {
  readonly abandonedExpiryMs: number;
}

/**
 * Mark a session as abandoned, storing the prior state for possible RESUME.
 */
export function markAbandoned(session: ConversationSession): ConversationSession {
  return updateSessionState(session, ConversationState.INTAKE_ABANDONED);
}

/**
 * Mark an abandoned session as expired (system event).
 */
export function markExpired(session: ConversationSession): ConversationSession {
  return {
    ...session,
    state: ConversationState.INTAKE_EXPIRED,
    last_activity_at: new Date().toISOString(),
  };
}

/**
 * Check if an abandoned session has exceeded the expiry window.
 */
export function isExpired(session: ConversationSession, config: ExpirationConfig): boolean {
  if (session.state !== ConversationState.INTAKE_ABANDONED) return false;
  const elapsed = Date.now() - new Date(session.last_activity_at).getTime();
  return elapsed > config.abandonedExpiryMs;
}
```

**Step 4: Update session barrel export**

Update `packages/core/src/session/index.ts` to include new exports:

```typescript
export type { ConversationSession, CreateSessionInput } from './types.js';
export {
  createSession,
  updateSessionState,
  touchActivity,
  setSessionUnit,
  markAbandoned,
  markExpired,
  isExpired,
  type ExpirationConfig,
} from './session.js';
export { filterResumableDrafts } from './draft-discovery.js';
```

**Step 5: Run test to verify it passes**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test -- src/__tests__/session/session.test.ts
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/core/src/session/
git commit -m "feat(core): add abandonment, expiration, and expired-check logic"
```

---

## Task 11: Integration Tests

**Files:**

- Create: `packages/core/src/__tests__/integration.test.ts`

End-to-end scenarios testing state machine + session + auth together.

**Step 1: Write integration tests**

```typescript
// packages/core/src/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationState, ActionType } from '@wo-agent/schemas';
import { SystemEvent } from '../state-machine/system-events.js';
import { isValidTransition, getPossibleTargets } from '../state-machine/transition.js';
import {
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
} from '../state-machine/guards.js';
import {
  createSession,
  updateSessionState,
  markAbandoned,
  markExpired,
  isExpired,
  setSessionUnit,
} from '../session/session.js';
import { filterResumableDrafts } from '../session/draft-discovery.js';
import { createTokenPair, verifyAccessToken } from '../auth/jwt.js';
import { extractAuthFromHeader } from '../auth/middleware.js';
import type { JwtConfig } from '../auth/types.js';

const TEST_JWT_CONFIG: JwtConfig = {
  accessTokenSecret: new TextEncoder().encode('integration-test-access-secret-32!!'),
  refreshTokenSecret: new TextEncoder().encode('integration-test-refresh-secret-32!'),
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  issuer: 'wo-agent-test',
  audience: 'wo-agent-test',
};

describe('Integration: full happy-path lifecycle', () => {
  it('walks through intake_started → submitted', () => {
    // 1. Create session
    let session = createSession({
      conversation_id: 'conv-1',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0',
        schema_version: '1.0',
        model_id: 'gpt-4',
        prompt_version: '1.0',
      },
    });
    expect(session.state).toBe(ConversationState.INTAKE_STARTED);

    // 2. SELECT_UNIT (single unit → auto-select)
    expect(isValidTransition(session.state, ActionType.SELECT_UNIT)).toBe(true);
    const unitTarget = resolveSelectUnit(session.state, {
      authorized_unit_ids: ['u1'],
      selected_unit_id: null,
    });
    expect(unitTarget).toBe(ConversationState.UNIT_SELECTED);
    session = updateSessionState(session, unitTarget!);
    session = setSessionUnit(session, 'u1');
    expect(session.state).toBe(ConversationState.UNIT_SELECTED);

    // 3. SUBMIT_INITIAL_MESSAGE
    expect(isValidTransition(session.state, ActionType.SUBMIT_INITIAL_MESSAGE)).toBe(true);
    const msgTarget = resolveSubmitInitialMessage({ unit_resolved: true });
    session = updateSessionState(session, msgTarget!);
    expect(session.state).toBe(ConversationState.SPLIT_IN_PROGRESS);

    // 4. LLM_SPLIT_SUCCESS (system)
    expect(isValidTransition(session.state, SystemEvent.LLM_SPLIT_SUCCESS)).toBe(true);
    session = updateSessionState(session, ConversationState.SPLIT_PROPOSED);

    // 5. CONFIRM_SPLIT
    expect(isValidTransition(session.state, ActionType.CONFIRM_SPLIT)).toBe(true);
    session = updateSessionState(session, ConversationState.SPLIT_FINALIZED);

    // 6. START_CLASSIFICATION (system)
    expect(isValidTransition(session.state, SystemEvent.START_CLASSIFICATION)).toBe(true);
    session = updateSessionState(session, ConversationState.CLASSIFICATION_IN_PROGRESS);

    // 7. LLM_CLASSIFY_SUCCESS → no follow-ups needed
    const classTarget = resolveLlmClassifySuccess({ fields_needing_input: [] });
    expect(classTarget).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    session = updateSessionState(session, classTarget);

    // 8. CONFIRM_SUBMISSION
    expect(isValidTransition(session.state, ActionType.CONFIRM_SUBMISSION)).toBe(true);
    session = updateSessionState(session, ConversationState.SUBMITTED);
    expect(session.state).toBe(ConversationState.SUBMITTED);
  });
});

describe('Integration: error recovery with retry', () => {
  it('handles LLM failure → retry → success', () => {
    let session = createSession({
      conversation_id: 'conv-2',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0',
        schema_version: '1.0',
        model_id: 'gpt-4',
        prompt_version: '1.0',
      },
    });

    session = updateSessionState(session, ConversationState.UNIT_SELECTED);
    session = updateSessionState(session, ConversationState.SPLIT_IN_PROGRESS);

    // LLM fails (first failure → retryable)
    const failTarget = resolveLlmFailure({ retry_count: 0 });
    expect(failTarget).toBe(ConversationState.LLM_ERROR_RETRYABLE);
    session = updateSessionState(session, failTarget);
    expect(session.prior_state_before_error).toBe(ConversationState.SPLIT_IN_PROGRESS);

    // RETRY_LLM → back to split_in_progress
    const retryTarget = resolveRetryLlm({ prior_state: session.prior_state_before_error });
    expect(retryTarget).toBe(ConversationState.SPLIT_IN_PROGRESS);
    session = updateSessionState(session, retryTarget!);
    expect(session.state).toBe(ConversationState.SPLIT_IN_PROGRESS);
  });
});

describe('Integration: abandon and resume', () => {
  it('abandons and resumes to prior state', () => {
    let session = createSession({
      conversation_id: 'conv-3',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0',
        schema_version: '1.0',
        model_id: 'gpt-4',
        prompt_version: '1.0',
      },
    });

    session = updateSessionState(session, ConversationState.NEEDS_TENANT_INPUT);
    session = markAbandoned(session);
    expect(session.state).toBe(ConversationState.INTAKE_ABANDONED);
    expect(session.prior_state_before_error).toBe(ConversationState.NEEDS_TENANT_INPUT);

    // Resume
    const resumeTarget = resolveAbandonResume({ prior_state: session.prior_state_before_error });
    expect(resumeTarget).toBe(ConversationState.NEEDS_TENANT_INPUT);
    session = updateSessionState(session, resumeTarget!);
    expect(session.state).toBe(ConversationState.NEEDS_TENANT_INPUT);
  });
});

describe('Integration: draft discovery with auth', () => {
  it('creates auth, creates sessions, filters drafts', async () => {
    // Create auth token
    const pair = await createTokenPair(
      { sub: 'user-1', account_id: 'acct-1', unit_ids: ['u1'] },
      TEST_JWT_CONFIG,
    );
    const authResult = await extractAuthFromHeader(`Bearer ${pair.accessToken}`, TEST_JWT_CONFIG);
    expect(authResult.valid).toBe(true);
    if (!authResult.valid) return;

    const { tenant_user_id } = authResult.authContext;

    // Create sessions in various states
    const sessions = [
      {
        ...createSession({
          conversation_id: 'c1',
          tenant_user_id,
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['u1'],
          pinned_versions: {
            taxonomy_version: '1.0',
            schema_version: '1.0',
            model_id: 'gpt-4',
            prompt_version: '1.0',
          },
        }),
        state: ConversationState.NEEDS_TENANT_INPUT as ConversationState,
        last_activity_at: '2026-01-02T00:00:00Z',
      },
      {
        ...createSession({
          conversation_id: 'c2',
          tenant_user_id,
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['u1'],
          pinned_versions: {
            taxonomy_version: '1.0',
            schema_version: '1.0',
            model_id: 'gpt-4',
            prompt_version: '1.0',
          },
        }),
        state: ConversationState.SUBMITTED as ConversationState,
        last_activity_at: '2026-01-03T00:00:00Z',
      },
      {
        ...createSession({
          conversation_id: 'c3',
          tenant_user_id,
          tenant_account_id: 'acct-1',
          authorized_unit_ids: ['u1'],
          pinned_versions: {
            taxonomy_version: '1.0',
            schema_version: '1.0',
            model_id: 'gpt-4',
            prompt_version: '1.0',
          },
        }),
        state: ConversationState.SPLIT_PROPOSED as ConversationState,
        last_activity_at: '2026-01-01T00:00:00Z',
      },
    ];

    const drafts = filterResumableDrafts(sessions, tenant_user_id);
    expect(drafts).toHaveLength(2); // c1 (needs_tenant_input) + c3 (split_proposed); c2 is submitted
    expect(drafts[0].conversation_id).toBe('c1'); // more recent
    expect(drafts[1].conversation_id).toBe('c3');
  });
});

describe('Integration: photo uploads never change state', () => {
  it('allows photo upload in every state without transition', () => {
    const allStates = Object.values(ConversationState);
    for (const state of allStates) {
      expect(isValidTransition(state, ActionType.UPLOAD_PHOTO_INIT)).toBe(true);
      expect(isValidTransition(state, ActionType.UPLOAD_PHOTO_COMPLETE)).toBe(true);
      expect(getPossibleTargets(state, ActionType.UPLOAD_PHOTO_INIT)).toEqual([state]);
      expect(getPossibleTargets(state, ActionType.UPLOAD_PHOTO_COMPLETE)).toEqual([state]);
    }
  });
});

describe('Integration: follow-up loop', () => {
  it('cycles through classification → follow-ups → re-classification', () => {
    let session = createSession({
      conversation_id: 'conv-4',
      tenant_user_id: 'user-1',
      tenant_account_id: 'acct-1',
      authorized_unit_ids: ['u1'],
      pinned_versions: {
        taxonomy_version: '1.0',
        schema_version: '1.0',
        model_id: 'gpt-4',
        prompt_version: '1.0',
      },
    });

    // Fast-forward to classification
    session = updateSessionState(session, ConversationState.CLASSIFICATION_IN_PROGRESS);

    // Classify → needs input
    const target1 = resolveLlmClassifySuccess({ fields_needing_input: ['Maintenance_Object'] });
    expect(target1).toBe(ConversationState.NEEDS_TENANT_INPUT);
    session = updateSessionState(session, target1);

    // Answer follow-ups → back to classification
    expect(isValidTransition(session.state, ActionType.ANSWER_FOLLOWUPS)).toBe(true);
    session = updateSessionState(session, ConversationState.CLASSIFICATION_IN_PROGRESS);

    // Classify again → all good
    const target2 = resolveLlmClassifySuccess({ fields_needing_input: [] });
    expect(target2).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
    session = updateSessionState(session, target2);
    expect(session.state).toBe(ConversationState.TENANT_CONFIRMATION_PENDING);
  });
});
```

**Step 2: Run all tests**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test
```

Expected: ALL PASS

**Step 3: Commit**

```bash
git add packages/core/src/__tests__/integration.test.ts
git commit -m "test(core): add integration tests for full lifecycle scenarios"
```

---

## Task 12: Barrel Exports and Final Verification

**Files:**

- Modify: `packages/core/src/index.ts`

**Step 1: Wire up the barrel export**

```typescript
// packages/core/src/index.ts
// @wo-agent/core — barrel export
// Phase 2: Auth/Session Scaffolding + Conversation State Machine

// --- State Machine ---
export {
  SystemEvent,
  ALL_SYSTEM_EVENTS,
  TRANSITION_MATRIX,
  PHOTO_ACTIONS,
  isPhotoAction,
  isValidTransition,
  getPossibleTargets,
  resolveSelectUnit,
  resolveSubmitInitialMessage,
  resolveLlmFailure,
  resolveLlmClassifySuccess,
  resolveRetryLlm,
  resolveAbandonResume,
} from './state-machine/index.js';
export type { TransitionTrigger, TransitionContext } from './state-machine/index.js';

// --- Auth ---
export {
  toAuthContext,
  createTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  extractAuthFromHeader,
  validateUnitAccess,
} from './auth/index.js';
export type {
  JwtPayload,
  JwtConfig,
  TokenPair,
  TokenVerifyResult,
  AuthErrorCode,
  AuthError,
  AuthExtractionResult,
} from './auth/index.js';

// --- Session ---
export {
  createSession,
  updateSessionState,
  touchActivity,
  setSessionUnit,
  markAbandoned,
  markExpired,
  isExpired,
  filterResumableDrafts,
} from './session/index.js';
export type { ConversationSession, CreateSessionInput, ExpirationConfig } from './session/index.js';
```

**Step 2: Run full test suite**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm test
```

Expected: ALL PASS

**Step 3: Run typecheck**

```bash
cd /workspaces/MAINTENANCE/packages/core && pnpm exec tsc --noEmit
```

Expected: no errors.

**Step 4: Run schemas tests to verify no regressions**

```bash
cd /workspaces/MAINTENANCE/packages/schemas && pnpm test
```

Expected: 85 tests pass (unchanged).

**Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): Phase 2 complete — state machine, auth, session management"
```

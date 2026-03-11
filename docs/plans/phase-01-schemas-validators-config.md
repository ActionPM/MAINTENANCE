# Phase 1: Schemas + Validators + Config Objects

**Build sequence step:** 1 of 13 (spec §28)
**Prerequisite:** None (this is the foundation)
**Governed by:** schema-first-development skill, project-conventions skill

---

## Overview

Phase 1 establishes the entire schema and validation foundation. Every subsequent phase depends on these artifacts existing and being tested. The deliverables are:

1. **Workspace infrastructure** — pnpm monorepo, TypeScript config, test runner
2. **11 JSON Schema / config files** in `packages/schemas/` (spec §29)
3. **TypeScript types** aligned to each schema
4. **Validator functions** using Ajv, with typed error returns
5. **Config objects** for rate limits, state enums, action types, confidence thresholds, follow-up caps
6. **Tests** for every validator (valid + invalid data) and every config object

---

## Batch 1 — Workspace Infrastructure

> Goal: A working pnpm monorepo where `pnpm install && pnpm typecheck` passes.

### Task 1.1: Root workspace setup

**Files to create:**

- `package.json` (root — private, workspaces config, shared scripts)
- `pnpm-workspace.yaml` (packages glob)
- `.gitignore`
- `.nvmrc` (pin Node version)

**Acceptance criteria:**

- `pnpm install` succeeds
- Root `package.json` has scripts: `test`, `lint`, `typecheck`
- Workspaces: `packages/*`, `packages/adapters/*`, `apps/*`

### Task 1.2: Root TypeScript config

**Files to create:**

- `tsconfig.base.json` (shared compiler options: strict, ESNext, NodeNext)

**Acceptance criteria:**

- Strict mode enabled (`strict: true`)
- `moduleResolution: "NodeNext"`, `module: "NodeNext"`
- No `outDir` — each package sets its own

### Task 1.3: `@wo-agent/schemas` package scaffold

**Files to create:**

- `packages/schemas/package.json` (name: `@wo-agent/schemas`, dependencies: ajv)
- `packages/schemas/tsconfig.json` (extends root base)
- `packages/schemas/vitest.config.ts`
- `packages/schemas/src/index.ts` (barrel export)

**Dependencies:**

- `ajv` (JSON Schema validator)
- `ajv-formats` (format validation — uuid, date-time, uri)
- `vitest` (dev dependency)
- `typescript` (dev dependency)

**Acceptance criteria:**

- `pnpm --filter @wo-agent/schemas test` runs (even if 0 tests)
- `pnpm --filter @wo-agent/schemas typecheck` passes
- Package exports from `src/index.ts`

---

## Batch 2 — Taxonomy + Core Enums + Config Objects

> Goal: All enums and configuration constants are defined as typed, importable objects. No free-text categories anywhere.

### Task 2.1: Taxonomy schema file

**File:** `packages/schemas/taxonomy.json`
**Source:** Copy verbatim from `docs/taxonomy.json` (already authored)

**What this contains:**

- `Category`, `Location`, `Sub_Location`, `Maintenance_Category`, `Maintenance_Object`, `Maintenance_Problem`, `Management_Category`, `Management_Object`, `Priority`

**Acceptance criteria:**

- File is byte-identical to `docs/taxonomy.json`
- A TypeScript type `Taxonomy` is exported that types each key as `readonly string[]`
- A loader function reads and parses the file at build/import time

### Task 2.2: Taxonomy TypeScript types + loader

**File:** `packages/schemas/src/taxonomy.ts`

**Deliverables:**

- `Taxonomy` interface (each field is `readonly string[]`)
- `TaxonomyFieldName` union type of all field keys
- `loadTaxonomy()` function that reads + validates `taxonomy.json`
- Per-field union types derived at build time (e.g., `Category`, `Location`, etc.)
- `isTaxonomyValue(field, value)` type guard

**Acceptance criteria:**

- `loadTaxonomy()` returns typed taxonomy object
- `isTaxonomyValue('Category', 'maintenance')` returns `true`
- `isTaxonomyValue('Category', 'freetext_garbage')` returns `false`

### Task 2.3: Conversation state enum + config

**File:** `packages/schemas/src/conversation-states.ts`

**Deliverables (from spec §11.1):**

```
ConversationState enum:
  Core: intake_started, unit_selection_required, unit_selected, split_in_progress,
        split_proposed, split_finalized, classification_in_progress, needs_tenant_input,
        tenant_confirmation_pending, submitted
  Failure: llm_error_retryable, llm_error_terminal, intake_abandoned, intake_expired
```

- `RESUMABLE_STATES` set (spec §12.1): `unit_selection_required`, `split_proposed`, `classification_in_progress`, `needs_tenant_input`, `tenant_confirmation_pending`, `llm_error_retryable`, `intake_abandoned`

**Acceptance criteria:**

- All 14 states defined, no extras
- `RESUMABLE_STATES` matches spec §12.1 exactly

### Task 2.4: Work order status enum

**File:** `packages/schemas/src/work-order-status.ts`

**Deliverables (from spec §1.5):**

```
WorkOrderStatus enum: created, action_required, scheduled, resolved, cancelled
```

**Acceptance criteria:**

- 5 statuses, matches spec §1.5

### Task 2.5: Action types enum

**File:** `packages/schemas/src/action-types.ts`

**Deliverables (from spec §10.3):**

```
ActionType enum:
  CREATE_CONVERSATION, SELECT_UNIT, SUBMIT_INITIAL_MESSAGE, SUBMIT_ADDITIONAL_MESSAGE,
  CONFIRM_SPLIT, MERGE_ISSUES, EDIT_ISSUE, ADD_ISSUE, REJECT_SPLIT,
  ANSWER_FOLLOWUPS, CONFIRM_SUBMISSION, UPLOAD_PHOTO_INIT, UPLOAD_PHOTO_COMPLETE,
  RESUME, ABANDON
```

- `ActorType` enum: `tenant | system | agent | pm_user`

**Acceptance criteria:**

- 15 action types, matches spec §10.3
- 4 actor types, matches spec §10.2

### Task 2.6: Rate limits config

**File:** `packages/schemas/src/rate-limits.ts`

**Deliverables (from spec §8):**

```typescript
interface RateLimitConfig {
  max_messages_per_minute_per_user: number; // default: 10
  max_new_conversations_per_day_per_user: number; // default: 20
  max_photo_uploads_per_conversation: number; // default: 10
  max_photo_size_mb: number; // default: 10
  max_message_chars: number; // default: 8000
  max_issues_per_conversation: number; // default: 10
  max_issue_text_chars: number; // default: 500
}
```

- `DEFAULT_RATE_LIMITS` constant with defaults
- JSON Schema for rate limit config (for per-client overrides)

**Acceptance criteria:**

- All 7 limits defined with spec §8 defaults
- Schema validates custom overrides (partial overrides allowed)

### Task 2.7: Confidence thresholds + follow-up caps config

**File:** `packages/schemas/src/confidence-config.ts`

**Deliverables (from spec §14.3 + §15):**

```typescript
interface ConfidenceConfig {
  high_threshold: number; // 0.85
  medium_threshold: number; // 0.65
  model_hint_min: number; // 0.2
  model_hint_max: number; // 0.95
  weights: {
    cue_strength: number; // 0.40
    completeness: number; // 0.25
    model_hint: number; // 0.20
    disagreement: number; // 0.10
    ambiguity_penalty: number; // 0.05
  };
}

interface FollowUpCaps {
  max_questions_per_turn: number; // 3
  max_turns: number; // 8
  max_total_questions: number; // 9
  max_reasks_per_field: number; // 2
}
```

- `DEFAULT_CONFIDENCE_CONFIG` and `DEFAULT_FOLLOWUP_CAPS` constants

**Acceptance criteria:**

- Weights sum correctly (0.40+0.25+0.20+0.10+0.05 = 1.0)
- All values match spec §14.3 and §15

### Task 2.8: Version pinning types

**File:** `packages/schemas/src/version-pinning.ts`

**Deliverables (from spec §5.2):**

```typescript
interface PinnedVersions {
  taxonomy_version: string;
  schema_version: string;
  model_id: string;
  prompt_version: string;
}
```

**Acceptance criteria:**

- Type exported and usable for conversation records

### Task 2.9: Tests for Batch 2

**File:** `packages/schemas/src/__tests__/enums-and-config.test.ts`

**Test cases:**

- Taxonomy loads and all fields have at least 1 value
- `isTaxonomyValue` returns correct for valid/invalid values
- All 14 conversation states are defined
- `RESUMABLE_STATES` is subset of all states
- All 5 WO statuses defined
- All 15 action types defined
- Rate limit defaults match spec §8
- Confidence weights sum to 1.0
- Follow-up caps match spec §15

---

## Batch 3 — Core JSON Schemas (Orchestrator, Split, Classification)

> Goal: The three most critical schema files exist with full JSON Schema definitions.

### Task 3.1: `orchestrator_action.schema.json`

**File:** `packages/schemas/orchestrator_action.schema.json`

**Defines (from spec §10.2):**

**OrchestratorActionRequest:**

- `conversation_id` — string or null (null for CREATE_CONVERSATION)
- `action_type` — enum of all 15 action types
- `actor` — enum: tenant | system | agent | pm_user
- `tenant_input` — object, shape varies by action_type (use discriminated union / oneOf)
- `idempotency_key` — string (required for side-effect actions)
- `auth_context` — object: `tenant_user_id`, `tenant_account_id`, `authorized_unit_ids[]`

**OrchestratorActionResponse:**

- `conversation_snapshot` — current state, metadata
- `ui_directive` — messages[], quick_replies[], forms[], upload_prompts[]
- `artifacts` — refs with hashes, timestamps, `presented_to_tenant` flag
- `pending_side_effects[]`
- `errors[]` — typed, user-safe: `{ code, message, field? }`

**Key `tenant_input` shapes by action (define as `oneOf` / discriminated):**

- `CREATE_CONVERSATION`: `{}` (empty)
- `SELECT_UNIT`: `{ unit_id: string }`
- `SUBMIT_INITIAL_MESSAGE`: `{ message: string }` (max 8000 chars)
- `SUBMIT_ADDITIONAL_MESSAGE`: `{ message: string }`
- `CONFIRM_SPLIT`: `{}`
- `MERGE_ISSUES`: `{ issue_ids: string[] }` (min 2)
- `EDIT_ISSUE`: `{ issue_id: string, summary: string }` (max 500 chars)
- `ADD_ISSUE`: `{ summary: string }` (max 500 chars)
- `REJECT_SPLIT`: `{}`
- `ANSWER_FOLLOWUPS`: `{ answers: Array<{ question_id: string, answer: any }> }`
- `CONFIRM_SUBMISSION`: `{}`
- `UPLOAD_PHOTO_INIT`: `{ filename: string, content_type: string, size_bytes: number }`
- `UPLOAD_PHOTO_COMPLETE`: `{ photo_id: string, storage_key: string, sha256: string }`
- `RESUME`: `{}`
- `ABANDON`: `{}`

**Acceptance criteria:**

- Valid JSON Schema (draft 2020-12 or draft-07)
- All 15 action types have their `tenant_input` shape defined
- Required fields enforced
- `maxLength` on message (8000) and summary (500) fields
- `minItems` / `maxItems` on arrays where spec defines limits

### Task 3.2: `issue_split.schema.json`

**File:** `packages/schemas/issue_split.schema.json`

**Defines (from llm-tool-contracts skill):**

**IssueSplitterInput:**

- `raw_text` — string (max 8000 chars)
- `conversation_id` — string
- `taxonomy_version`, `model_id`, `prompt_version` — string

**IssueSplitterOutput:**

- `issues` — array of `{ issue_id: string, summary: string (max 500), raw_excerpt: string }`
- `issue_count` — integer, must equal `issues.length`
- Constraints: `issues` minItems 1, maxItems 10

**Acceptance criteria:**

- Schema enforces min/max on issues array
- Schema enforces maxLength on summary (500)
- `issue_count` is required integer

### Task 3.3: Classification output schema

**File:** `packages/schemas/classification.schema.json`

**Defines (from llm-tool-contracts skill):**

**IssueClassifierInput:**

- `issue_id`, `issue_summary`, `raw_excerpt` — string
- `followup_answers?` — array of `{ field_target: string, answer: string | boolean }`
- `taxonomy_version`, `model_id`, `prompt_version` — string
- `cue_scores?` — object (field → number)

**IssueClassifierOutput:**

- `issue_id` — string
- `classification` — object (field_name → taxonomy enum value)
- `model_confidence` — object (field_name → number 0..1)
- `missing_fields` — string[]
- `needs_human_triage` — boolean

**Acceptance criteria:**

- `classification` values validated against taxonomy enum values
- `model_confidence` values constrained to [0, 1]
- `needs_human_triage` has default `false`

### Task 3.4: Tests for Batch 3 schemas

**File:** `packages/schemas/src/__tests__/core-schemas.test.ts`

**Test cases per schema:**

- Valid payload passes validation
- Missing required field fails
- Extra unknown fields behavior defined (either reject or allow per schema)
- Boundary values: max length strings, max/min array sizes
- Invalid enum values rejected
- Each `tenant_input` variant validates correctly for its action type

---

## Batch 4 — Follow-up, Work Order, Photo Schemas

> Goal: Complete remaining data-model schemas.

### Task 4.1: `followup_request.schema.json`

**File:** `packages/schemas/followup_request.schema.json`

**Defines (from llm-tool-contracts skill):**

**FollowUpGeneratorInput:**

- `issue_id` — string
- `classification` — object (field → string)
- `confidence_by_field` — object (field → number)
- `missing_fields` — string[]
- `fields_needing_input` — string[]
- `previous_questions` — array of `{ field_target: string, times_asked: number }`
- `turn_number` — integer (min 1)
- `total_questions_asked` — integer (min 0)
- `taxonomy_version`, `prompt_version` — string

**Acceptance criteria:**

- `turn_number` minimum 1
- `total_questions_asked` minimum 0
- `previous_questions.times_asked` minimum 0

### Task 4.2: `followups.schema.json`

**File:** `packages/schemas/followups.schema.json`

**Defines (from llm-tool-contracts skill + spec §7.1):**

**FollowUpGeneratorOutput:**

- `questions` — array (maxItems 3) of:
  - `question_id` — string
  - `field_target` — string
  - `prompt` — string
  - `options` — string[]
  - `answer_type` — enum: `enum | yes_no | text`

**FollowUpEvent (spec §7.1 minimum schema):**

- `event_id`, `conversation_id`, `issue_id` — string
- `turn_number` — integer
- `questions_asked` — array (same structure as output questions)
- `answers_received` — array of `{ question_id: string, answer: any, received_at: date-time }` (nullable until tenant responds)
- `created_at` — date-time

**Acceptance criteria:**

- `questions` maxItems 3 enforced
- `answer_type` enum strictly `enum | yes_no | text`
- Event schema has all fields from spec §7.1

### Task 4.3: `work_order.schema.json`

**File:** `packages/schemas/work_order.schema.json`

**Defines (from spec §6):**

- `work_order_id`, `issue_group_id`, `issue_id` — string (uuid)
- `client_id`, `property_id`, `unit_id` — string (uuid)
- `tenant_user_id`, `tenant_account_id` — string (uuid)
- `status` — enum: created, action_required, scheduled, resolved, cancelled
- `status_history` — array of `{ status: enum, changed_at: date-time, actor: enum }`
- `raw_text` — string
- `summary_confirmed` — string
- `photos` — array of photo references
- `classification` — object (taxonomy enums)
- `confidence_by_field` — object
- `missing_fields` — string[]
- `pets_present` — enum: yes, no, unknown
- `risk_flags` — object (safety flags)
- `needs_human_triage` — boolean
- `created_at`, `updated_at` — date-time
- `row_version` — integer (min 1)
- `pinned_versions` — object (taxonomy_version, schema_version, model_id, prompt_version)

**Acceptance criteria:**

- All ID fields use uuid format
- Status enum matches spec §1.5
- `pets_present` is strictly yes/no/unknown
- `row_version` has minimum 1, default 1

### Task 4.4: `photo.schema.json`

**File:** `packages/schemas/photo.schema.json`

**Defines (from spec §19):**

- `photo_id` — string (uuid)
- `conversation_id` — string (uuid)
- `work_order_id` — string (uuid, nullable — null during intake)
- `filename` — string
- `content_type` — string (image/jpeg, image/png, image/heic, image/webp)
- `size_bytes` — integer (max 10MB = 10485760)
- `sha256` — string (hex, 64 chars)
- `storage_key` — string
- `scanned_status` — enum: pending, clean, infected, error
- `uploaded_by` — string (uuid)
- `created_at` — date-time

**Acceptance criteria:**

- `size_bytes` has maximum 10485760
- `sha256` pattern enforced (64 hex chars)
- `scanned_status` enum has all 4 values
- `content_type` enum limited to supported image types

### Task 4.5: Tests for Batch 4 schemas

**File:** `packages/schemas/src/__tests__/data-model-schemas.test.ts`

**Test cases:**

- Valid follow-up request/response passes
- Follow-up questions capped at 3
- Valid work order passes
- WO with invalid status rejected
- WO missing required IDs rejected
- Valid photo passes
- Photo over max size rejected
- Photo with invalid scanned_status rejected

---

## Batch 5 — Risk, Emergency, SLA, Cue Schemas

> Goal: Complete the configuration-type schema files.

### Task 5.1: `risk_protocols.json`

**File:** `packages/schemas/risk_protocols.json`

**Defines (from spec §17):**

```json
{
  "version": "1.0.0",
  "triggers": [
    {
      "trigger_id": "string",
      "name": "string",
      "grammar": {
        "keyword_any": ["string"],
        "regex_any": ["string"],
        "taxonomy_path_any": ["category.subcategory.value"]
      },
      "requires_confirmation": true,
      "severity": "emergency | high | medium",
      "mitigation_template_id": "string"
    }
  ],
  "mitigation_templates": [
    {
      "template_id": "string",
      "name": "string",
      "message_template": "string",
      "safety_instructions": ["string"]
    }
  ]
}
```

**Acceptance criteria:**

- At least one example trigger (e.g., fire, flood, gas leak)
- Grammar supports keyword_any, regex_any, taxonomy_path_any
- `requires_confirmation` boolean on every trigger
- Mitigation templates linked by ID

### Task 5.2: `emergency_escalation_plans.json`

**File:** `packages/schemas/emergency_escalation_plans.json`

**Defines (from spec §1.6):**

```json
{
  "version": "1.0.0",
  "plans": [
    {
      "plan_id": "string",
      "building_id": "string",
      "contact_chain": [
        { "role": "building_manager", "contact_id": "string", "name": "string", "phone": "string" },
        { "role": "property_manager", "contact_id": "string", "name": "string", "phone": "string" },
        {
          "role": "senior_property_manager",
          "contact_id": "string",
          "name": "string",
          "phone": "string"
        },
        {
          "role": "fallback_after_hours",
          "contact_id": "string",
          "name": "string",
          "phone": "string"
        }
      ],
      "exhaustion_behavior": {
        "internal_alert": true,
        "tenant_message_template": "string",
        "retry_after_minutes": 15
      }
    }
  ]
}
```

**Acceptance criteria:**

- Per-building configurable chain
- Chain order matches spec §1.6: Building Manager → PM → Senior PM → fallback
- Exhaustion behavior defined with retry option

### Task 5.3: `sla_policies.json`

**File:** `packages/schemas/sla_policies.json`

**Defines (from spec §22):**

```json
{
  "version": "1.0.0",
  "client_defaults": {
    "emergency": { "response_hours": 1, "resolution_hours": 24 },
    "high": { "response_hours": 4, "resolution_hours": 48 },
    "normal": { "response_hours": 24, "resolution_hours": 168 },
    "low": { "response_hours": 48, "resolution_hours": 336 }
  },
  "overrides": [
    {
      "taxonomy_path": "maintenance.plumbing.flood",
      "response_hours": 1,
      "resolution_hours": 12
    }
  ]
}
```

**Acceptance criteria:**

- Client defaults keyed by Priority enum values
- Taxonomy-path overrides supported
- Hours are positive integers

### Task 5.4: `classification_cues.json`

**File:** `packages/schemas/classification_cues.json`

**Defines (from spec §14.4):**

- Structure: `{ version, fields: { [field_name]: { [label]: { keywords: string[], regex: string[] } } } }`
- Must cover at minimum: `Maintenance_Category`, `Maintenance_Object`, `Maintenance_Problem`
- Labels MUST match `taxonomy.json` values exactly

**Seed data (from spec §14.4 + expanded):**

- `Maintenance_Category`: plumbing, electrical, hvac, pest_control, appliance, locksmith, flooring, carpentry, general_maintenance (keywords for each)
- `Maintenance_Object`: toilet, sink, faucet, drain, pipe, shower, breaker, outlet, light, thermostat, door, lock, key, fridge, dishwasher, oven, stove, washer, dryer (keywords for each)
- `Maintenance_Problem`: leak, clog, not_working, flood, infestation, broken_damaged, safety_risk, smell (keywords for each)
- `Management_Category`: accounting, lease, general (keywords for each)

**Acceptance criteria:**

- All label values exist in `taxonomy.json` (validated by test)
- At least 3 keywords per populated label
- Structure matches spec §14.4 exactly

### Task 5.5: Tests for Batch 5 schemas

**File:** `packages/schemas/src/__tests__/config-schemas.test.ts`

**Test cases:**

- Risk protocol triggers have required grammar fields
- Emergency plans have complete contact chains
- SLA policies cover all Priority values
- Classification cues labels match taxonomy.json values exactly
- No cue label exists that isn't in taxonomy

---

## Batch 6 — Validator Infrastructure + Per-Schema Validators

> Goal: A reusable validation function and per-schema validator exports, all tested.

### Task 6.1: Generic JSON Schema validator

**File:** `packages/schemas/src/validator.ts`

**Deliverables:**

```typescript
// Core validate function using Ajv
function validate<T>(data: unknown, schemaId: string): ValidationResult<T>;

interface ValidationResult<T> {
  valid: boolean;
  data?: T; // typed data if valid
  errors?: ValidationError[];
}

interface ValidationError {
  path: string; // JSON pointer to the failing field
  message: string; // human-readable error message
  keyword: string; // Ajv keyword (e.g., "required", "enum", "maxLength")
}
```

- Pre-compiled Ajv instance with all schemas registered
- Format validators for uuid, date-time, uri
- `addSchema()` for dynamic schema registration

**Acceptance criteria:**

- Valid data returns `{ valid: true, data: T }`
- Invalid data returns `{ valid: false, errors: [...] }` with useful paths
- All schemas from packages/schemas/ are pre-registered

### Task 6.2: Per-schema validator functions

**File:** `packages/schemas/src/validators/index.ts` (barrel)
**Files:** One file per schema group:

- `packages/schemas/src/validators/orchestrator-action.ts`
- `packages/schemas/src/validators/issue-split.ts`
- `packages/schemas/src/validators/classification.ts`
- `packages/schemas/src/validators/followups.ts`
- `packages/schemas/src/validators/work-order.ts`
- `packages/schemas/src/validators/photo.ts`
- `packages/schemas/src/validators/risk-protocols.ts`
- `packages/schemas/src/validators/escalation-plans.ts`
- `packages/schemas/src/validators/sla-policies.ts`
- `packages/schemas/src/validators/classification-cues.ts`

**Each file exports:**

```typescript
function validateOrchestratorActionRequest(
  data: unknown,
): ValidationResult<OrchestratorActionRequest>;
function validateOrchestratorActionResponse(
  data: unknown,
): ValidationResult<OrchestratorActionResponse>;
// etc.
```

**Acceptance criteria:**

- Every schema file has a corresponding typed validator
- Validators return typed results, not raw Ajv output
- All validators exported from barrel

### Task 6.3: Taxonomy cross-validation

**File:** `packages/schemas/src/validators/taxonomy-cross-validator.ts`

**Purpose:** Validate that classification outputs reference only values that exist in `taxonomy.json`. This is the **domain validation** layer for category gating (spec §5.3).

**Deliverables:**

```typescript
function validateClassificationAgainstTaxonomy(
  classification: Record<string, string>,
  taxonomy: Taxonomy,
): DomainValidationResult;

interface DomainValidationResult {
  valid: boolean;
  contradictory: boolean; // category gating violation
  invalidValues: Array<{ field: string; value: string; allowed: string[] }>;
  crossDomainViolations: string[]; // e.g., "management category with maintenance fields"
}
```

**Acceptance criteria:**

- Detects values not in taxonomy
- Detects category gating contradictions (maintenance category + management fields, etc.)
- Returns structured errors, not just boolean

### Task 6.4: Cue dictionary validator

**File:** `packages/schemas/src/validators/cue-dictionary-validator.ts`

**Purpose:** Validate that `classification_cues.json` labels match `taxonomy.json` exactly.

**Deliverables:**

```typescript
function validateCueDictionary(
  cues: CueDictionary,
  taxonomy: Taxonomy,
): ValidationResult<CueDictionary>;
```

**Acceptance criteria:**

- Every label in cues exists in the corresponding taxonomy field
- Every field name in cues exists as a taxonomy field
- Returns errors for orphaned labels

### Task 6.5: Comprehensive validator tests

**File:** `packages/schemas/src/__tests__/validators.test.ts`

**Test cases:**

- Generic validator: valid data passes, invalid data returns typed errors
- Orchestrator action: valid request for each action type passes
- Orchestrator action: missing required fields rejected
- Orchestrator action: invalid action_type rejected
- Issue split: valid output passes, empty issues array rejected, 11 issues rejected
- Classification: valid output passes, non-taxonomy enum value rejected
- Classification: category gating — management category with maintenance fields detected
- Follow-up: valid output passes, 4 questions rejected (max 3)
- Work order: valid WO passes, invalid status rejected
- Photo: valid photo passes, oversized rejected
- Taxonomy cross-validator: contradictory classifications detected
- Cue dictionary: orphaned labels detected

---

## Batch 7 — Barrel Exports + Integration Test + Cleanup

> Goal: Package is complete, fully typed, fully tested, and exports a clean public API.

### Task 7.1: Update barrel export (`src/index.ts`)

**File:** `packages/schemas/src/index.ts`

**Exports:**

```typescript
// Schemas (as importable objects)
export { taxonomySchema } from './taxonomy';
export { orchestratorActionSchema } from './schemas/orchestrator-action';
// ... etc

// Types
export type { Taxonomy, TaxonomyFieldName, Category, Location, ... } from './taxonomy';
export type { OrchestratorActionRequest, OrchestratorActionResponse, ... } from './types/orchestrator-action';
export type { IssueSplitterInput, IssueSplitterOutput } from './types/issue-split';
export type { IssueClassifierInput, IssueClassifierOutput } from './types/classification';
export type { FollowUpGeneratorInput, FollowUpGeneratorOutput } from './types/followups';
export type { WorkOrder } from './types/work-order';
export type { Photo } from './types/photo';
export type { PinnedVersions } from './version-pinning';
export type { ValidationResult, ValidationError, DomainValidationResult } from './validator';

// Enums + Config
export { ConversationState, RESUMABLE_STATES } from './conversation-states';
export { WorkOrderStatus } from './work-order-status';
export { ActionType, ActorType } from './action-types';
export { DEFAULT_RATE_LIMITS } from './rate-limits';
export { DEFAULT_CONFIDENCE_CONFIG, DEFAULT_FOLLOWUP_CAPS } from './confidence-config';

// Validators
export { validate } from './validator';
export { validateOrchestratorActionRequest, validateOrchestratorActionResponse } from './validators/orchestrator-action';
export { validateIssueSplitterOutput } from './validators/issue-split';
export { validateClassifierOutput } from './validators/classification';
export { validateFollowUpOutput } from './validators/followups';
export { validateWorkOrder } from './validators/work-order';
export { validatePhoto } from './validators/photo';
export { validateClassificationAgainstTaxonomy } from './validators/taxonomy-cross-validator';
export { validateCueDictionary } from './validators/cue-dictionary-validator';

// Taxonomy
export { loadTaxonomy, isTaxonomyValue } from './taxonomy';
```

**Acceptance criteria:**

- Single import path: `import { ... } from '@wo-agent/schemas'`
- No circular dependencies
- `pnpm --filter @wo-agent/schemas typecheck` passes

### Task 7.2: Integration test

**File:** `packages/schemas/src/__tests__/integration.test.ts`

**Test cases:**

- Import everything from barrel — no errors
- Build a complete valid OrchestratorActionRequest for each action type and validate
- Build a complete valid WorkOrder and validate
- Build a classification output, validate against schema, then cross-validate against taxonomy
- Load taxonomy, load cues, validate cues against taxonomy
- Round-trip: create valid data → validate → get typed result → access fields

### Task 7.3: Verify TDD compliance + clean up

- Ensure every schema file has at least one passing positive test and one failing negative test
- Ensure all tests pass: `pnpm --filter @wo-agent/schemas test`
- Ensure typecheck passes: `pnpm --filter @wo-agent/schemas typecheck`
- Verify no `any` types leaked into public API

---

## Dependency Graph

```
Batch 1 (infrastructure)
  └── Batch 2 (enums + config)
        └── Batch 3 (core schemas: orchestrator, split, classification)
        └── Batch 4 (data model schemas: WO, photo, followups)
        └── Batch 5 (config schemas: risk, emergency, SLA, cues)
              └── Batch 6 (validators — needs all schemas)
                    └── Batch 7 (barrel + integration)
```

Batches 3, 4, and 5 can be worked in parallel once Batch 2 is complete.
Batch 6 requires all schema files to exist.
Batch 7 is the final integration pass.

---

## Files Created (complete list)

### New directories

```
packages/
packages/schemas/
packages/schemas/src/
packages/schemas/src/types/
packages/schemas/src/validators/
packages/schemas/src/__tests__/
```

### Root files

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
.gitignore
.nvmrc
```

### packages/schemas/ files

```
package.json
tsconfig.json
vitest.config.ts

# Schema / config JSON files (11)
taxonomy.json
orchestrator_action.schema.json
issue_split.schema.json
classification.schema.json
followup_request.schema.json
followups.schema.json
work_order.schema.json
photo.schema.json
risk_protocols.json
emergency_escalation_plans.json
sla_policies.json
classification_cues.json

# TypeScript source
src/index.ts
src/taxonomy.ts
src/conversation-states.ts
src/work-order-status.ts
src/action-types.ts
src/rate-limits.ts
src/confidence-config.ts
src/version-pinning.ts
src/validator.ts
src/validators/index.ts
src/validators/orchestrator-action.ts
src/validators/issue-split.ts
src/validators/classification.ts
src/validators/followups.ts
src/validators/work-order.ts
src/validators/photo.ts
src/validators/risk-protocols.ts
src/validators/escalation-plans.ts
src/validators/sla-policies.ts
src/validators/classification-cues.ts
src/validators/taxonomy-cross-validator.ts
src/validators/cue-dictionary-validator.ts

# Type definition files
src/types/orchestrator-action.ts
src/types/issue-split.ts
src/types/classification.ts
src/types/followups.ts
src/types/work-order.ts
src/types/photo.ts

# Test files
src/__tests__/enums-and-config.test.ts
src/__tests__/core-schemas.test.ts
src/__tests__/data-model-schemas.test.ts
src/__tests__/config-schemas.test.ts
src/__tests__/validators.test.ts
src/__tests__/integration.test.ts
```

**Total new files:** ~50
**Total new directories:** ~7

---

## Exit Criteria for Phase 1

All of the following must be true before moving to Phase 2:

- [ ] `pnpm install` succeeds from clean state
- [ ] `pnpm --filter @wo-agent/schemas typecheck` passes with zero errors
- [ ] `pnpm --filter @wo-agent/schemas test` passes with zero failures
- [ ] All 11 schema/config JSON files exist in `packages/schemas/`
- [ ] Every schema has a typed validator function
- [ ] Every validator has tests for valid AND invalid data
- [ ] Taxonomy cross-validation detects category gating contradictions
- [ ] Cue dictionary labels validated against taxonomy (no orphans)
- [ ] All enums match spec exactly (14 states, 5 WO statuses, 15 action types, 4 actors)
- [ ] Rate limits, confidence config, follow-up caps match spec defaults
- [ ] Clean public API from `@wo-agent/schemas` barrel export
- [ ] No `any` types in public API
- [ ] No circular dependencies

---

## Spec References

| Section | What it governs                                        |
| ------- | ------------------------------------------------------ |
| §2      | Non-negotiables (all 7 apply)                          |
| §4      | Tech stack (TypeScript, pnpm, JSON Schema)             |
| §5      | Taxonomy, version pinning, category gating             |
| §6      | Core data model (WorkOrder fields)                     |
| §7      | Event schemas (followup_events minimum schema)         |
| §8      | Rate limits and payload caps                           |
| §10     | Orchestrator action request/response                   |
| §11     | Conversation states + transition matrix                |
| §14     | Classification, confidence heuristic, cue dictionaries |
| §15     | Follow-up caps                                         |
| §17     | Risk protocols + emergency escalation                  |
| §19     | Photo schema                                           |
| §22     | SLA policies                                           |
| §27     | Repo structure                                         |
| §28     | Build sequence (Phase 1)                               |
| §29     | Required artifacts list                                |

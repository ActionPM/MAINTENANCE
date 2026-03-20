# CEO Demo UI — Implementation Plan

**Date**: 2026-03-18
**Goal**: A polished, guided demo UI that showcases every capability of the Work Order Triage Agent for the CEO. One-click start, deterministic results, full lifecycle visibility.

---

## Current State

The app has a complete working backend (35 API routes, 14 states, 15 action types, full orchestrator) and a functional chat UI (8 components covering every state). However, the current experience has gaps for a CEO demo:

| What exists | What's missing for CEO demo |
|---|---|
| Dev login page at `/dev/login` (3 personas) | No guided experience — CEO won't know what to type |
| Full chat flow: split → classify → followup → confirm → WO | LLM stubs return single-issue splits, empty followup questions |
| Risk detection + emergency confirmation UI | No curated scenario that reliably triggers emergency flow |
| Work order creation + IDs displayed | No way to VIEW work orders after submission |
| Real LLM works (ANTHROPIC_API_KEY configured) | Real LLM is unpredictable for a demo — may not showcase all features |
| In-memory stores work without DATABASE_URL | — |

## Design Decisions

1. **Demo fixtures are a global local-dev toggle**, not route-scoped. The orchestrator factory is a `globalThis` singleton shared across all routes. When `USE_DEMO_FIXTURES=true` is set, **every** chat flow in that process uses fixtures — both `/dev/demo` scenarios and the regular `/` chat. This is intentional: the singleton architecture makes per-route LLM switching impractical without significant plumbing, and for local dev the simpler toggle is sufficient. To switch back to real LLM, unset the variable and restart the dev server.

2. **3 curated scenarios** that each showcase different capabilities:
   - **Happy Path**: Single maintenance issue → classification → confirm → WO created
   - **Multi-Issue**: 3 issues → split review (edit/merge/add) → diverse classification → follow-up questions → grouped WOs
   - **Emergency**: Flood keywords → risk detection → safety mitigations → emergency confirmation → WO with risk flags

3. **Work order viewer** at `/dev/work-orders` — post-submission page showing classification, confidence scores, risk flags, and record bundle data. Scoped to what the existing `RecordBundle` type returns (no event timeline, no related WOs — those aren't in the current API surface).

4. **No new packages or dependencies** — everything built with existing React + CSS Modules + Next.js App Router.

5. **Env var gating**: Demo fixtures activated by `USE_DEMO_FIXTURES=true` (already-configured env vars cover auth + unit resolver).

---

## Batch 1: Demo Fixture Adapters

> **Purpose**: Replace the simple LLM stubs with rich, deterministic adapters that always produce interesting multi-step flows. These are the engine that makes the demo showcase all capabilities.

### Task 1.1: Create demo splitter fixture

**File**: `apps/web/src/lib/demo-fixtures/demo-splitter.ts`

Create a deterministic splitter that pattern-matches on input text to produce scenario-appropriate splits:

```typescript
// Must satisfy: (input: IssueSplitterInput) => Promise<IssueSplitterOutput>
// Pattern-match on input.raw_text:
//
// SCENARIO A (multi-issue, contains "faucet" + "light" + "cockroach"):
//   → 3 issues: plumbing leak, flickering light, pest sighting
//
// SCENARIO B (emergency, contains "flood" or "water everywhere"):
//   → 1 issue: major water leak (risk scanner handles emergency detection)
//
// SCENARIO C (single issue, default):
//   → 1 issue: summary = first 200 chars of raw_text
//
// Each SplitIssue needs: issue_id (randomUUID), summary, raw_excerpt
```

**Type contract** (from `@wo-agent/schemas`):
```typescript
interface IssueSplitterOutput {
  issues: readonly SplitIssue[];  // { issue_id, summary, raw_excerpt }
  issue_count: number;
}
```

**Acceptance**: Calling with multi-issue scenario text returns 3 issues with distinct summaries.

---

### Task 1.2: Create demo classifier fixture

**File**: `apps/web/src/lib/demo-fixtures/demo-classifier.ts`

Create a deterministic classifier that returns realistic taxonomy labels with varying confidence levels. **Every value must exist in `taxonomy.json` and every parent→child pair must be valid in `taxonomy_constraints.json`**. The classifier pipeline in `callIssueClassifier` validates taxonomy membership, and `start-classification.ts` validates hierarchical constraints — invalid chains trigger a constrained retry then `needs_human_triage`, which would break the intended follow-up demo path.

```typescript
// Must satisfy the issueClassifier signature from OrchestratorDependencies
// Pattern-match on input.issue_summary to determine classification.
//
// CONSTRAINT CHAINS (verified against taxonomy_constraints.json):
//
// ── "faucet" / "leak" / "plumbing" ──────────────────────────────
//   Category:               maintenance
//   Location:               suite
//   Sub_Location:           kitchen        (suite → kitchen ✓)
//   Maintenance_Category:   plumbing       (kitchen → plumbing ✓)
//   Maintenance_Object:     faucet         (plumbing → faucet ✓)
//   Maintenance_Problem:    leak           (faucet → leak ✓)
//   Management_Category:    not_applicable (maintenance gating)
//   Management_Object:      not_applicable (maintenance gating)
//   Priority:               normal
//   confidence: ALL HIGH (0.85–0.95) → no followups needed
//
// ── "light" / "hallway" ─────────────────────────────────────────
//   Category:               maintenance
//   Location:               building_interior  (NOT suite — hallways_stairwells is a child of building_interior)
//   Sub_Location:           hallways_stairwells (building_interior → hallways_stairwells ✓)
//   Maintenance_Category:   electrical          (hallways_stairwells → electrical ✓)
//   Maintenance_Object:     light               (electrical → light ✓)
//   Maintenance_Problem:    not_working         (light → not_working ✓)
//   Management_Category:    not_applicable
//   Management_Object:      not_applicable
//   Priority:               normal
//   confidence: Location=0.55, Sub_Location=0.45 (LOW → triggers followups)
//              rest HIGH (0.85–0.95)
//
// ── "cockroach" / "pest" ────────────────────────────────────────
//   Category:               maintenance
//   Location:               suite
//   Sub_Location:           bathroom       (suite → bathroom ✓)
//   Maintenance_Category:   pest_control   (bathroom → pest_control ✓)
//   Maintenance_Object:     cockroaches    (pest_control → cockroaches ✓)
//   Maintenance_Problem:    infestation    (cockroaches → infestation ✓)
//   Management_Category:    not_applicable
//   Management_Object:      not_applicable
//   Priority:               normal
//   confidence: Sub_Location=0.40 (LOW → triggers followup)
//              rest HIGH (0.85–0.95)
//
// ── Default (no keyword match) ──────────────────────────────────
//   Category:               maintenance
//   Location:               suite
//   Sub_Location:           general        (suite → general ✓)
//   Maintenance_Category:   general_maintenance (general → general_maintenance ✓)
//   Maintenance_Object:     other_object   (general_maintenance → other_object ✓)
//   Maintenance_Problem:    not_working    (other_object → not_working ✓)
//   Management_Category:    not_applicable
//   Management_Object:      not_applicable
//   Priority:               normal
//   confidence: ALL 0.50
//
// Return: missing_fields=[], needs_human_triage=false for all cases.
```

**Acceptance**: Plumbing issue gets high-confidence classification. Light issue has low-confidence Location + Sub_Location. Pest issue has low-confidence Sub_Location. All constraint chains are valid (no hierarchy violations).

---

### Task 1.3: Create demo follow-up generator fixture

**File**: `apps/web/src/lib/demo-fixtures/demo-followup-generator.ts`

Create a deterministic follow-up generator that returns meaningful questions for low-confidence fields:

```typescript
// Must satisfy: (input: FollowUpGeneratorInput) => Promise<FollowUpGeneratorOutput>
//
// Match on field_target to produce relevant questions:
//
// Location (low confidence):
//   { question_id: uuid, field_target: "Location", answer_type: "enum",
//     prompt: "Where exactly is this issue? Is it inside your unit or in a common area?",
//     options: ["suite", "building_interior", "building_exterior"] }
//
// Sub_Location (low confidence):
//   { question_id: uuid, field_target: "Sub_Location", answer_type: "enum",
//     prompt: "Which room or area is this in?",
//     options: ["kitchen", "bathroom", "bedroom", "hallways_stairwells", "general"] }
//
// Maintenance_Problem (low confidence):
//   { question_id: uuid, field_target: "Maintenance_Problem", answer_type: "text",
//     prompt: "Can you describe what's happening with the issue in more detail?",
//     options: [] }
//
// If no fields need followup, return { questions: [] }
```

**Type contract**:
```typescript
interface FollowUpQuestion {
  question_id: string;
  field_target: string;
  prompt: string;
  options: readonly string[];
  answer_type: 'enum' | 'yes_no' | 'text';
}
interface FollowUpGeneratorOutput {
  questions: readonly FollowUpQuestion[];
}
```

**Acceptance**: When classifier produces low-confidence Location + Sub_Location for the light issue, this generator returns 2 enum questions with valid taxonomy options.

---

### Task 1.4: Create demo fixture barrel export + index

**File**: `apps/web/src/lib/demo-fixtures/index.ts`

Barrel export all three fixtures:

```typescript
export { createDemoSplitter } from './demo-splitter.js';
export { createDemoClassifier } from './demo-classifier.js';
export { createDemoFollowupGenerator } from './demo-followup-generator.js';
```

Each fixture should be a factory function (e.g., `createDemoSplitter()`) that returns the adapter function, keeping the same pattern as `createLlmDependencies()` in core.

**Acceptance**: All three exports resolve correctly. TypeScript compiles with no errors.

---

### Task 1.5: Automated tests for demo fixtures

**File**: `apps/web/src/lib/demo-fixtures/__tests__/demo-fixtures.test.ts`

Unit tests covering:

1. **Demo splitter**:
   - Multi-issue text ("faucet" + "light" + "cockroach") → returns 3 issues with distinct summaries
   - Emergency text ("flooding") → returns 1 issue
   - Default text → returns 1 issue with truncated summary

2. **Demo classifier — taxonomy validity**:
   - For each keyword pattern (faucet, light, cockroach, default): call classifier, then verify every returned classification value exists in `taxonomy.json` using `loadTaxonomy()`
   - For each: verify `validateHierarchicalConstraints()` returns `valid: true` against `taxonomyConstraints`
   - Verify category gating: Category=maintenance → Management_Category=not_applicable, Management_Object=not_applicable

3. **Demo classifier — confidence targeting**:
   - Faucet issue: ALL confidence values ≥ 0.7 (no followups triggered)
   - Light issue: Location < 0.7 AND Sub_Location < 0.7 (will trigger followups)
   - Cockroach issue: Sub_Location < 0.7 (will trigger followup)

4. **Demo followup generator**:
   - When `fields_needing_input` includes `Location` → returns question with `answer_type: 'enum'` and options that are valid Location values
   - When `fields_needing_input` includes `Sub_Location` → returns question with valid Sub_Location options
   - When `fields_needing_input` is empty → returns `{ questions: [] }`

Import `loadTaxonomy`, `taxonomyConstraints`, `validateHierarchicalConstraints` from `@wo-agent/schemas` for validation.

**Acceptance**: `pnpm --filter @wo-agent/web exec vitest run src/lib/demo-fixtures/__tests__/demo-fixtures.test.ts` passes.

---

### Batch 1 Review Checkpoint

- [ ] `pnpm typecheck` passes
- [ ] Demo splitter returns 1 or 3 issues depending on input text
- [ ] Demo classifier returns valid taxonomy values with varying confidence
- [ ] Demo followup generator returns questions for low-confidence fields
- [ ] All classification values exist in `packages/schemas/taxonomy.json`
- [ ] All constraint chains pass `validateHierarchicalConstraints()` (automated test)
- [ ] Fixture tests pass: `pnpm --filter @wo-agent/web exec vitest run src/lib/demo-fixtures/__tests__/demo-fixtures.test.ts`

---

## Batch 2: Wire Fixtures into Orchestrator Factory

> **Purpose**: Make the demo fixtures available to the orchestrator when `USE_DEMO_FIXTURES=true`, so the CEO demo page produces deterministic, rich results.

### Task 2.1: Wire demo fixtures into orchestrator-factory.ts

**File**: `apps/web/src/lib/orchestrator-factory.ts`

Modify `ensureInitialized()` to check for `USE_DEMO_FIXTURES=true` env var. When set, use demo fixtures instead of both real LLM adapters AND the simple stubs. This is a **global process-wide switch** — since the factory is a `globalThis` singleton, all routes (including `/`) will use fixtures when the var is set.

```typescript
// In ensureInitialized(), after the existing llmDeps block:
//
// Priority order:
// 1. USE_DEMO_FIXTURES=true → use demo fixtures (deterministic, all routes)
// 2. ANTHROPIC_API_KEY set → use real LLM adapters
// 3. Neither → use existing simple stubs (current behavior)
//
// Only the issueSplitter, issueClassifier, and followUpGenerator need swapping.
// The rest of the deps (stores, notification service, risk protocols, etc.) stay the same.
```

Key insertion point: around lines 348-413 where `issueSplitter`, `issueClassifier`, and `followUpGenerator` are set on the `deps` object. Add a conditional block before the existing fallback.

**Acceptance**: With `USE_DEMO_FIXTURES=true`, the orchestrator uses demo fixtures for ALL routes. Without it, existing behavior is unchanged (real LLM or simple stubs).

---

### Task 2.2: Add USE_DEMO_FIXTURES to env files

**File**: `apps/web/.env.local` (add to existing)

Add `USE_DEMO_FIXTURES=true` alongside the existing dev auth vars.

**File**: `.env.example` (document the option)

Add a comment block explaining `USE_DEMO_FIXTURES`:
```
# Set to "true" to use deterministic demo fixtures for LLM tools
# (predictable multi-issue splits, classification, follow-up questions).
# Overrides both real LLM and simple stubs. Designed for CEO/stakeholder demos.
# USE_DEMO_FIXTURES=true
```

**Acceptance**: Env var documented and set in local dev config.

---

### Task 2.3: Automated test for factory demo-fixtures branch

**File**: `apps/web/src/lib/__tests__/orchestrator-factory-demo-fixtures.test.ts`

Extends the existing factory test at `apps/web/src/lib/__tests__/orchestrator-factory-llm.test.ts` (which only covers the ANTHROPIC_API_KEY set/unset split) with a new test file for the demo-fixtures branch:

1. **USE_DEMO_FIXTURES=true overrides ANTHROPIC_API_KEY**: Set both env vars. Verify the factory selects demo fixtures (e.g., call splitter with multi-issue text, assert 3 issues returned — real LLM would not produce deterministic 3-issue split).

2. **USE_DEMO_FIXTURES=true overrides simple stubs**: Unset ANTHROPIC_API_KEY, set USE_DEMO_FIXTURES=true. Verify demo fixtures are used (simple stub would return 1 issue for any input).

3. **USE_DEMO_FIXTURES absent falls through**: Unset USE_DEMO_FIXTURES. Verify existing behavior (real LLM or simple stubs depending on API key).

Note: Since the factory is a `globalThis` singleton, tests must clear `globalThis.__woAgentDeps` before each test to force re-initialization.

**Acceptance**: `pnpm --filter @wo-agent/web exec vitest run src/lib/__tests__/orchestrator-factory-demo-fixtures.test.ts` passes.

---

### Task 2.4: Verify demo fixtures produce full flow (manual)

**Manual verification**:

1. Start dev server: `pnpm --filter @wo-agent/web dev`
2. Navigate to `/dev/login`, pick Alice
3. Start conversation, type the multi-issue scenario text
4. Verify: 3 issues appear in split review
5. Confirm split → classification runs → follow-up questions appear
6. Answer follow-ups → confirmation panel shows 3 classified issues
7. Confirm submission → WO IDs shown

**Acceptance**: Full flow completes without errors. All 3 issues classified. Follow-up questions appear for at least 1 issue.

---

### Batch 2 Review Checkpoint

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (no regressions)
- [ ] Demo fixtures used by ALL routes when `USE_DEMO_FIXTURES=true`
- [ ] Existing behavior unchanged when `USE_DEMO_FIXTURES` is absent/false (real LLM if API key set, simple stubs otherwise)
- [ ] Manual flow test passes with all 3 scenarios

---

## Batch 3: CEO Demo Landing Page

> **Purpose**: A polished entry point at `/dev/demo` that gives the CEO context about the product and lets them launch curated demo scenarios with one click.

### Task 3.1: Create demo landing page

**File**: `apps/web/src/app/dev/demo/page.tsx`

Client component with:

**Header section**:
- Product name: "Service Request Intake & Triage Agent"
- One-line value prop: "AI-powered maintenance request processing with authoritative taxonomy classification"
- Brief description (2-3 sentences): What it does, why it matters (categorization integrity, trend analysis, automated triage)

**Scenario cards** (3 cards in a grid):

1. **"Standard Request"** — Single maintenance issue
   - Description: "A tenant reports a leaking kitchen faucet. Watch the agent classify it, assign taxonomy labels, and create a work order."
   - Pre-filled message: `"My kitchen faucet has been dripping constantly for the past two days. Water is pooling under the sink."`
   - Capabilities shown: Basic flow, taxonomy classification, work order creation

2. **"Multi-Issue Report"** — 3 issues in one message
   - Description: "A tenant describes multiple problems at once. The agent splits them into separate issues, classifies each differently, and asks follow-up questions for uncertain fields."
   - Pre-filled message: `"Hi, I have a few problems. The kitchen faucet is leaking and there's water under the sink. Also, the hallway light near my front door has been flickering on and off for a week. And I think I saw a cockroach in the bathroom last night."`
   - Capabilities shown: Multi-issue splitting, split review (edit/merge/add), diverse classification, follow-up questions, grouped work orders

3. **"Emergency Detection"** — Risk trigger scenario
   - Description: "A tenant reports a flooding emergency. The agent detects the risk, shows safety instructions, and offers emergency escalation before creating the work order."
   - Pre-filled message: `"There's water flooding from the pipe under my kitchen sink, it's everywhere on the floor and it won't stop! The water is spreading to the hallway."`
   - Capabilities shown: Emergency keyword detection, safety mitigations, emergency confirm/decline, risk flags on work order

**Each card has a "Launch Demo" button** that:
1. Calls `/api/dev/auth/demo-login` with persona `bob` (3 units — shows unit selector)
2. Redirects to `/?token=...&units=...&demo_scenario=<scenario_key>&demo_message=<encoded_message>`

**Architecture section** (collapsible or below cards):
- Brief bullet list of what's under the hood: 14 conversation states, deterministic state machine, schema-locked LLM outputs, append-only event log, idempotency, emergency routing
- Tech stack one-liner: Next.js 15 + TypeScript + PostgreSQL + Claude AI

**Styling**: CSS Modules (consistent with rest of app). Clean, professional. Max-width 960px centered. Cards in responsive grid (1-col mobile, 3-col desktop).

**Acceptance**: Page renders at `/dev/demo` with 3 scenario cards. Each "Launch Demo" button authenticates and redirects with scenario params.

---

### Task 3.2: Handle demo scenario params in chat shell

**File**: `apps/web/src/app/page.tsx`

Read `demo_scenario` and `demo_message` from URL search params (in addition to existing `token` and `units`). Pass them to `ChatShell`:

```typescript
// New props: demoScenario?: string, demoMessage?: string
```

**File**: `apps/web/src/components/chat-shell.tsx`

When `demoMessage` is provided:
1. After conversation is created and unit is selected (or auto-selected for single-unit personas), automatically populate the message input with the demo message text
2. Show a subtle banner at the top: "Demo Mode — [scenario name]" with a link back to `/dev/demo`
3. Do NOT auto-submit — let the CEO click Send to feel in control of the flow

When `demoScenario` is provided:
- Map scenario key to a human-readable name for the banner
- For `bob` persona (3 units), add a hint: "Select a unit to begin" near the unit selector

**Acceptance**: Launching from demo page → chat opens with pre-filled message. Banner visible. CEO sends message and flow proceeds.

---

### Task 3.3: Add step progress indicator to chat shell (demo mode only)

**File**: `apps/web/src/components/chat-shell.tsx` (or new `demo-progress.tsx` component)

When in demo mode (demoScenario is set), show a lightweight progress bar/step indicator above the chat messages:

```
[1. Send Message] → [2. Review Split] → [3. Classify] → [4. Follow-ups] → [5. Confirm] → [6. Done!]
```

Highlight the current step based on conversation state:
- `intake_started` / `unit_selection_required` / `unit_selected` → Step 1
- `split_in_progress` / `split_proposed` → Step 2
- `split_finalized` / `classification_in_progress` → Step 3
- `needs_tenant_input` → Step 4
- `tenant_confirmation_pending` → Step 5
- `submitted` → Step 6

Steps that don't apply (e.g., no follow-ups for single-issue scenario) are skipped visually (grayed out and auto-advance).

**Styling**: Horizontal pill steps. Active = blue, completed = green check, upcoming = gray. CSS Modules.

**Acceptance**: Progress indicator visible in demo mode, tracks state correctly, hidden in non-demo mode.

---

### Batch 3 Review Checkpoint

- [ ] `/dev/demo` page renders with 3 scenario cards
- [ ] Each "Launch Demo" button authenticates and redirects with correct params
- [ ] Chat opens with pre-filled demo message
- [ ] Demo banner and progress indicator visible
- [ ] Progress indicator tracks state transitions correctly
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @wo-agent/web test` passes

---

## Batch 4: Work Order Detail View

> **Purpose**: After submission, let the CEO see the actual work orders created — with full classification, confidence scores, risk flags, and the record bundle.

### Task 4.1: Create work order list page

**File**: `apps/web/src/app/dev/work-orders/page.tsx`

Client component that:
1. Reads `token` from URL params (passed through from chat flow)
2. Calls `GET /api/work-orders` with auth header
3. Displays a card list of all work orders for the authenticated tenant

Each card shows:
- Work order ID (truncated UUID)
- Issue summary
- Status badge (created, action_required, scheduled, resolved, cancelled)
- Category + Priority labels
- Risk flag indicator (if has_emergency or high severity)
- Created timestamp
- Click → navigates to detail page

**Styling**: Same CSS Modules approach. Cards in vertical stack, max-width 720px.

**Acceptance**: Page lists all work orders. Cards show key info. Clickable to detail.

---

### Task 4.2: Create work order detail page

**File**: `apps/web/src/app/dev/work-orders/[id]/page.tsx`

Client component that:
1. Calls `GET /api/work-orders/:id` for the work order
2. Calls `GET /api/work-orders/:id/record-bundle` for the full bundle
3. Displays comprehensive WO detail view

**Sections**:

**Header**: WO ID, status badge, created date

**Issue Summary**: Full summary text + raw excerpt from tenant

**Classification Table**: 9 taxonomy fields in a 2-column table (Field | Value), with each value shown as a styled label. Fields that are `not_applicable` (e.g., Management fields on maintenance issues) shown grayed out.

**Confidence Scores**: Horizontal bar chart or progress bars for each field's confidence (0-1 scale). Color-coded: green (>0.8), yellow (0.5-0.8), red (<0.5).

**Risk Assessment** (if risk_flags present):
- Severity badge (emergency/high/medium)
- Trigger names that matched
- Whether emergency was confirmed

**Record Bundle** (from `GET /api/work-orders/:id/record-bundle` — `RecordBundle` type):
- **Urgency Basis**: `has_emergency`, `highest_severity`, `trigger_ids` — rendered as risk badge + trigger list
- **Status History**: `readonly StatusHistoryEntry[]` — timeline of status transitions (CREATED → etc.)
- **Communications**: `readonly CommunicationEntry[]` — notification log (channel, type, status, timestamps)
- **SLA Schedule**: `SlaMetadata` — priority, response_hours, resolution_hours, response_due_at, resolution_due_at
- **Resolution**: `ResolutionInfo` — resolved boolean, final_status, resolved_at

Note: The `RecordBundle` type does NOT include a raw event timeline or related work orders. Those would require expanding the API surface (out of scope). The detail page shows only what the existing API returns.

**Pinned Versions**: Small footer showing taxonomy_version, schema_version, model_id (from WO object, not bundle)

**Styling**: Clean detail page. Sections separated by subtle dividers. Professional look suitable for CEO viewing.

**Acceptance**: Full WO detail renders with classification table, confidence bars, risk info, and record bundle fields (urgency basis, status history, communications, SLA schedule, resolution).

---

### Task 4.3: Link submitted state to work order viewer

**File**: `apps/web/src/components/status-indicator.tsx`

When `state === 'submitted'` and `workOrderIds` are present:
- Change each WO ID from plain text to a clickable link
- Link destination: `/dev/work-orders/${id}?token=${token}`
- Add a "View all work orders" link below the list

To pass the token, add an optional `token` prop to StatusIndicator.

**File**: `apps/web/src/components/chat-shell.tsx`

Pass `token` prop down to StatusIndicator when rendering for the submitted state.

**Acceptance**: After submission, WO IDs are clickable links. Clicking opens the detail page with full classification + confidence + risk info.

---

### Batch 4 Review Checkpoint

- [ ] `/dev/work-orders` lists all WOs for authenticated tenant
- [ ] `/dev/work-orders/[id]` shows full detail with classification, confidence, risk
- [ ] WO IDs in submitted state are clickable links
- [ ] Record bundle renders: urgency basis, status history, communications, SLA schedule, resolution
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @wo-agent/web test` passes (no regressions to existing component tests)

---

## Batch 5: Polish & End-to-End Verification

> **Purpose**: Final integration, visual polish, and full walkthrough of all 3 scenarios.

### Task 5.1: Add "Back to Demo" navigation

**Files**: Multiple pages

Add consistent navigation:
- `/dev/demo` → "Launch Demo" → chat page (already done)
- Chat page (demo mode) → banner has "Back to Scenarios" link → `/dev/demo`
- Submitted state → "View Work Orders" + "Try Another Scenario" → `/dev/demo`
- WO detail page → "Back to Work Orders" breadcrumb → `/dev/work-orders?token=...`
- WO list page → "Back to Demo" link → `/dev/demo`

**Acceptance**: CEO can navigate between all pages without getting stuck. Clear path forward at every step.

---

### Task 5.2: Visual polish pass

**Files**: All new CSS Module files

Review and polish:
- Consistent color palette with existing app (primary blue #0066cc, borders #e0e0e0, backgrounds #f8f9fa)
- Responsive design (works on laptop screen ~1200px and tablet ~768px)
- Loading states for all API calls (skeleton/spinner)
- Error states with retry options
- Ensure demo landing page looks professional enough for CEO audience
- Confidence bars are visually clear
- Risk badges are prominent (red for emergency, orange for high)

**Acceptance**: Visual review passes. No broken layouts on 1200px and 768px viewports.

---

### Task 5.3: Full end-to-end walkthrough of all 3 scenarios

**Manual verification** — walk through each scenario start to finish:

**Scenario 1 (Standard Request)**:
1. `/dev/demo` → click "Launch Demo" on Standard Request
2. Bob's 3 units shown → select unit-201
3. Pre-filled message visible → click Send
4. 1 issue in split review → Confirm
5. Classification runs → Confirmation panel with taxonomy labels
6. Confirm submission → WO created
7. Click WO ID → detail page shows classification + confidence (all high)

**Scenario 2 (Multi-Issue Report)**:
1. `/dev/demo` → click "Launch Demo" on Multi-Issue Report
2. Select unit → send pre-filled message
3. 3 issues in split review → demonstrate Edit on one, then Confirm
4. Classification → follow-up questions appear for 1-2 issues
5. Answer follow-ups → confirmation panel with 3 issues
6. Confirm → 3 WOs created with shared issue_group_id
7. View WOs → each has different classification, some with lower confidence

**Scenario 3 (Emergency Detection)**:
1. `/dev/demo` → click "Launch Demo" on Emergency Detection
2. Select unit → send pre-filled message
3. Risk detected → safety mitigation message shown → emergency confirm/decline buttons
4. Confirm emergency → 1 issue in split review → Confirm
5. Classification → confirmation panel shows risk flags
6. Confirm → WO created with emergency risk flags
7. View WO → risk assessment section shows flood trigger, emergency severity

**Acceptance**: All 3 scenarios complete without errors. Every major capability demonstrated.

---

### Task 5.4: Run full test suite

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @wo-agent/web build
```

**Acceptance**: All 4 commands pass with zero errors.

---

### Batch 5 Review Checkpoint

- [ ] All 3 scenarios work end-to-end
- [ ] Navigation is seamless between all pages
- [ ] Visual polish is professional/CEO-appropriate
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` all pass
- [ ] No regressions to existing functionality

---

## Files Created/Modified Summary

### New Files (12)
| File | Purpose |
|---|---|
| `apps/web/src/lib/demo-fixtures/demo-splitter.ts` | Deterministic multi-issue splitter |
| `apps/web/src/lib/demo-fixtures/demo-classifier.ts` | Deterministic taxonomy classifier |
| `apps/web/src/lib/demo-fixtures/demo-followup-generator.ts` | Deterministic follow-up question generator |
| `apps/web/src/lib/demo-fixtures/index.ts` | Barrel export |
| `apps/web/src/lib/demo-fixtures/__tests__/demo-fixtures.test.ts` | Fixture unit tests (taxonomy validity, constraint chains, confidence targeting) |
| `apps/web/src/lib/__tests__/orchestrator-factory-demo-fixtures.test.ts` | Factory branch test (USE_DEMO_FIXTURES priority) |
| `apps/web/src/app/dev/demo/page.tsx` | CEO demo landing page |
| `apps/web/src/app/dev/demo/demo.module.css` | Demo page styles |
| `apps/web/src/app/dev/work-orders/page.tsx` | Work order list page |
| `apps/web/src/app/dev/work-orders/[id]/page.tsx` | Work order detail page |
| `apps/web/src/components/demo-progress.tsx` | Step progress indicator |
| `apps/web/src/components/demo-progress.module.css` | Step progress indicator styles |

### Modified Files (5)
| File | Change |
|---|---|
| `apps/web/src/lib/orchestrator-factory.ts` | Wire demo fixtures when `USE_DEMO_FIXTURES=true` |
| `apps/web/src/app/page.tsx` | Read demo scenario/message params, pass to ChatShell |
| `apps/web/src/components/chat-shell.tsx` | Demo banner, pre-filled message, progress indicator |
| `apps/web/src/components/status-indicator.tsx` | Clickable WO links |
| `.env.example` | Document `USE_DEMO_FIXTURES` |

### Env Changes
| Variable | Value | Where |
|---|---|---|
| `USE_DEMO_FIXTURES` | `true` | `apps/web/.env.local` |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Demo fixture classification values not in taxonomy.json | Task 1.5 automated test validates every value against `loadTaxonomy()` and `validateHierarchicalConstraints()`. |
| Constraint chain violations → needs_human_triage | Task 1.5 explicitly tests each chain against `taxonomyConstraints`. Catches issues before wiring. |
| Factory wiring picks wrong LLM branch | Task 2.3 automated test covers all 3 priority branches (demo fixtures > real LLM > simple stubs). |
| State machine rejects unexpected transitions | Demo fixtures don't change state logic — only LLM outputs. Transition matrix unchanged. |
| Existing tests break | Every batch runs `pnpm test` before proceeding. No core logic modified. |
| CEO finds flow confusing | Progress indicator + pre-filled messages + demo banner provide context at every step. |
| Follow-up questions don't trigger | Demo classifier intentionally returns low confidence on specific fields to guarantee followup flow. Task 1.5 verifies confidence targeting. |
| USE_DEMO_FIXTURES affects non-demo routes | By design (documented in Design Decision 1 + Scope Caveat). Toggle off and restart for real LLM. |

---

## What This Does NOT Change

- No modifications to core packages (`packages/core/`, `packages/schemas/`, `packages/db/`)
- No changes to the state machine, transition matrix, or action handlers
- No changes to existing API routes
- No changes to production auth, rate limiting, or security headers
- No new npm dependencies
- No expansion of the `RecordBundle` API surface — WO detail page only renders fields the existing type exposes

## Scope Caveat: Global LLM Toggle

When `USE_DEMO_FIXTURES=true` is set, **all** chat flows in the process use demo fixtures (both `/dev/demo` and `/`). This is a process-wide setting, not route-scoped. To use the real LLM, unset the var and restart. This is acceptable for local dev but means you cannot demo fixtures on one tab while using real LLM on another in the same dev server.

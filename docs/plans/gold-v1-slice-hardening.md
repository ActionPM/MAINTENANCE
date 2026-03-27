# Plan: Gold-v1 Weak Slice Hardening (HVAC / Emergency / Multi-Issue)

**Created**: 2026-03-26
**Status**: Complete (closeout executed 2026-03-27 per `docs/plans/gold-v1-closeout-addendum.md`)
**Predecessor**: `docs/plans/live-confidence-followup-drift-hardening.md` (executed 2026-03-26)
**Artifact**: `packages/evals/baselines/gold-v1-anthropic-baseline.json` (promoted 2026-03-27 — field_accuracy=0.8236, schema_invalid_rate=0, contradiction_after_retry_rate=0)

---

## Diagnosis

The gold-v1 provider eval (167 examples, 214 results) established a provisional anthropic baseline with overall `field_accuracy = 0.7894`. Three slices underperform significantly:

| Slice       | field_accuracy | Results | Primary Failure Mode                                                 |
| ----------- | -------------- | ------- | -------------------------------------------------------------------- |
| hvac        | 0.6889         | 29      | Maintenance_Object missing/wrong (55% error rate); weak cue coverage |
| emergency   | 0.7358         | 13      | Priority misclassified (83% error: 10/12 emergency→high or normal)   |
| multi_issue | 0.7605         | 81      | Location/Sub_Location omission + Priority drift + 1 schema_fail      |

Each slice has a distinct root cause. The plan addresses them in sequential batches (Batches 1→2 share `classification_cues.json` and `version-pinning.ts`; Batch 3 is cross-cutting and runs after both). See §Dependency Graph for execution order.

---

## Root Cause Analysis

### HVAC (field_accuracy = 0.6889)

**Primary failure**: Maintenance_Object. Of 29 results, ~16 have wrong or missing Maintenance_Object. The classifier frequently omits the field entirely (the v2 evidence-based prompt allows omission) when it cannot identify a specific HVAC component, but the gold set expects `needs_object` for those cases.

**Cue gap**: The hvac Maintenance_Category entry has only 8 keywords (`heat`, `furnace`, `thermostat`, `vent`, `air conditioning`, `heating`, `hvac`, `radiator`) and one weak regex (`\bac\b`). Missing: `heater`, `baseboard`, `boiler`, `cooling`, `air conditioner`, `ductwork`, `air handler`, `compressor`, `ventilation`. The `radiator` Maintenance_Object cue has only 3 keywords (`radiator`, `baseboard heater`, `heating unit`).

**Secondary failure**: Location/Sub_Location missing in ~13/29 results. HVAC complaints often describe symptoms ("no heat") without naming a room. The classifier correctly omits unsupported fields per v2 prompt rules, but the gold set expects `Location=suite, Sub_Location=general` as a default for in-unit HVAC issues.

**Confidence pattern**: Maintenance_Category confidence hovers at 0.62-0.67 (barely medium-band). Maintenance_Object confidence is 0.39-0.54 (low-band). The weak cue_strength drives weak confidence, which drives over-asking.

### Emergency (field_accuracy = 0.7358)

**Primary failure**: Priority field. 10 of 12 emergency examples are classified as `high` (9) or `normal` (1). The other 8 fields average ~96% accuracy — this is a single-field failure.

**Cue gap**: Priority.emergency has only 5 keywords: `flood`, `fire`, `gas leak`, `burst pipe`, `sewage`. Zero of the 12 emergency examples contain any of these exact phrases. The gold set's emergency cases use real-world language:

- "no heat" (2 examples) — in Priority.**high** keywords, not emergency
- "water leak" / "leak" (4 examples) — in Priority.**normal** keywords
- "sparks" / "burnt" / "safety issue" (4 examples) — `sparks` is in high; the rest have no cue match at all
- "falling off" / "smoke alarm" / "burning smell" (2 examples) — no cue match

**Prompt-cue disconnect**: The PRIORITY_GUIDANCE_BLOCK says `"emergency": immediate safety risk (fire, gas leak, flooding, no heat in winter, structural danger)` — but the cue dictionary doesn't operationalize "no heat", "structural danger", "burning smell", or "safety risk" as emergency keywords. The model reads the guidance and assigns `high`; the cues don't pull it up to `emergency`.

**Risk protocol mismatch**: `risk_protocols.json` classifies "no heat" and "electrical safety" as severity `high`, not `emergency`. The gold set expects `emergency`. This is a labeling authority conflict — the gold set's Priority labels may reflect a stricter standard than the risk protocols encode.

### Multi-Issue (field_accuracy = 0.7605, schema_invalid_rate = 0.0123)

**Schema failure**: 1 result (gold-v1-SR-1018 issue 1, "Switchboard is out of order"). The model returned `Maintenance_Problem="needs_object"`, but `needs_object` is only valid for the `Maintenance_Object` field. Expected: `Maintenance_Problem="not_working"`. This is a field-value confusion — the model placed the right placeholder in the wrong field.

**Field accuracy**: The 80 OK results have error distributed across all non-Category fields:

- Sub_Location: 36 errors (most common)
- Location: 31 errors
- Priority: 29 errors
- Maintenance_Category/Object/Problem: ~26 errors each
- Management fields: 4 errors total (negligible)

**Pattern**: Multi-issue results are inherently harder because:

1. The split produces shorter per-issue text fragments, reducing cue signal density
2. Location/Sub_Location often appear once in the message header, not repeated per issue
3. Priority is harder to infer when the message mixes routine and urgent issues

**Split quality**: The split logic itself appears sound — no split failures detected. Degradation is purely in per-issue classification accuracy under reduced context.

---

## Scope and Non-Goals

**In scope**:

- Expand cue dictionaries for HVAC and Priority fields
- Add targeted prompt guidance for HVAC component identification (version-gated)
- Expand Priority cues for undisputed emergency scenarios only (fire, flood, gas, structural, burning)
- Fix the `needs_object` field-confusion schema failure pattern
- Establish improved provider baselines

**Not in scope**:

- Changing the confidence formula or thresholds (the predecessor plan already addressed this)
- Changing the splitter or how multi-issue messages are decomposed
- Changing the general-purpose evidence-based prompt omission rules for Location/Sub_Location (the rules that determine when these fields are dropped from the prompt for all categories)
- Expanding the gold set or relabeling existing examples
- **Promoting electrical safety scenarios to emergency** — "sparks", "exposed wires", and generic electrical safety language remain at Priority=high per `risk_protocols.json`. This plan's Batch 2b now covers whole-suite vital-service loss and real access/security failures only; electrical safety stays at `high` unless a separate policy decision changes `risk_protocols.json`.

**In scope but narrow**: Task 1.3 adds an HVAC-specific Location/Sub_Location default rule — "if the issue is clearly in-unit, set Location=suite, Sub_Location=general." This is a targeted prompt hint for HVAC issues only, not a change to the general omission machinery. It addresses the specific failure mode where 13/31 HVAC results omit Location entirely because the tenant says "my heat" without naming a room.

---

## Batch 1 — HVAC Cue + Prompt Hardening

### Task 1.1: Expand HVAC Maintenance_Category cues

**File**: `packages/schemas/classification_cues.json`

**Change**: Replace the `hvac` entry under `Maintenance_Category`:

```json
"hvac": {
  "keywords": [
    "heat", "furnace", "thermostat", "vent", "air conditioning",
    "heating", "hvac", "radiator",
    "heater", "baseboard", "boiler", "cooling", "air conditioner",
    "ductwork", "air handler", "compressor", "ventilation",
    "central air", "no heat", "no cooling", "cold air"
  ],
  "regex": [
    "\\b(heat(er|ing)?|furnace|boiler|baseboard)\\b",
    "\\b(air\\s*(conditioning|conditioner|handler)|central\\s*air)\\b",
    "\\bac\\b"
  ]
}
```

**Rationale**: The gold set uses colloquial terms ("heater", "baseboard", "boiler", "ventilation") that the current 8-keyword list misses. The regex `\bac\b` is retained but supplemented with multi-word patterns.

**Risk**: "vent" and "ventilation" overlap with exhaust fans (bathroom fan, range hood). The ambiguity penalty in the confidence formula handles this — when both hvac and appliance cues fire, ambiguity rises and the field stays in `fieldsNeedingInput`. Adding "ventilation" increases the match surface but doesn't force a wrong classification.

**Acceptance**: Messages containing "heater", "baseboard", "boiler", "air conditioner", "no cooling", "ventilation" produce cue_strength >= 0.6 for Maintenance_Category=hvac.

---

### Task 1.2: Expand HVAC-related Maintenance_Object cues

**File**: `packages/schemas/classification_cues.json`

**Changes** (update existing entries and add new ones):

**radiator** (currently 3 keywords):

```json
"radiator": {
  "keywords": [
    "radiator", "baseboard heater", "heating unit",
    "baseboard", "heat register", "heating element"
  ],
  "regex": ["\\b(baseboard|radiator)\\s*(heater|unit)?\\b"]
}
```

**thermostat** (currently 2 keywords):

```json
"thermostat": {
  "keywords": [
    "thermostat", "temperature control", "temp control",
    "temperature dial", "heating control", "programmable thermostat"
  ],
  "regex": ["\\b(thermo(stat)?|temp(erature)?\\s*control)\\b"]
}
```

**exhaust_fan** (currently 5 keywords + 1 regex — no change needed, already adequate).

**New entry — needs_object HVAC hints**: Not a cue dictionary change. The `needs_object` value already has cues in Maintenance_Object. The issue is that the classifier omits Maintenance_Object entirely when it can't identify the component. This is a prompt-level fix (Task 1.3).

**Acceptance**: "The baseboard is not heating" produces cue_strength >= 0.6 for Maintenance_Object=radiator. "Temperature control broken" produces cue_strength >= 0.6 for Maintenance_Object=thermostat.

---

### Task 1.3: Add HVAC prompt guidance (version-gated)

**File**: `packages/core/src/llm/prompts/classifier-prompt.ts`

**Change**: Add a new version constant and extend the domain hints block:

```typescript
export const HVAC_HINTS_VERSION = '2.3.0';
```

Add to both v1 and v2 prompt builders, gated on `promptVersion >= 2.3.0`:

```
HVAC CLASSIFICATION HINTS:
- When the tenant describes a heating/cooling problem but does not name the specific component,
  set Maintenance_Object to "needs_object" (do NOT omit the field).
- "Baseboard", "baseboard heater", and "heating unit" map to Maintenance_Object "radiator".
- "Furnace", "boiler", and "heating system" indicate Maintenance_Category "hvac" with
  Maintenance_Object "needs_object" unless the tenant names a specific part.
- If the issue is clearly in-unit (e.g., "my heat", "in my apartment"), set Location to "suite"
  and Sub_Location to "general" even without a specific room name.
```

**Version-pinning semantics**: Sessions pinned to <= 2.2.0 will NOT receive HVAC hints. Only new sessions (pinned to 2.3.0+) get the new text.

**Acceptance**:

- `buildClassifierSystemPrompt(taxonomy, '2.3.0')` includes "HVAC CLASSIFICATION HINTS"
- `buildClassifierSystemPrompt(taxonomy, '2.2.0')` does NOT include HVAC hints
- `buildClassifierSystemPrompt(taxonomy, '2.2.0')` still includes domain hints and Priority guidance

---

### Task 1.4: Bump PROMPT_VERSION

**File**: `packages/schemas/src/version-pinning.ts`

**Change**: `PROMPT_VERSION = '2.2.0'` → `PROMPT_VERSION = '2.3.0'`

**Verification**: All existing prompt version gates (EVIDENCE_BASED_PROMPT_VERSION=2.0.0, PRIORITY_GUIDANCE_VERSION=2.1.0, DOMAIN_HINTS_VERSION=2.2.0, HVAC_HINTS_VERSION=2.3.0) compare correctly with `compareSemver`.

**Acceptance**: `PROMPT_VERSION` exports as `'2.3.0'`. All previous prompt features still active for new sessions.

---

### Task 1.5: Bump CUE_VERSION

**File**: `packages/schemas/src/version-pinning.ts`

**Change**: `CUE_VERSION = '1.5.0'` → `CUE_VERSION = '1.6.0'`

**Acceptance**: `CUE_VERSION` exports as `'1.6.0'`.

---

### Task 1.6: Unit tests for HVAC cue expansion

**File**: `packages/core/src/__tests__/classifier/cue-scoring.test.ts`

**New test suite: "HVAC cue coverage"**:

1. "heater not working" → Maintenance_Category cue topLabel=hvac, score >= 0.6
2. "baseboard is cold" → Maintenance_Category=hvac AND Maintenance_Object topLabel=radiator
3. "boiler making noise" → Maintenance_Category=hvac, score >= 0.6
4. "air conditioner leaking" → Maintenance_Category=hvac, score >= 0.6
5. "no cooling in apartment" → Maintenance_Category=hvac, score >= 0.6
6. "temperature control broken" → Maintenance_Object topLabel=thermostat, score >= 0.6
7. "ventilation not working" → Maintenance_Category=hvac (may have ambiguity with exhaust_fan — that's OK)

**Acceptance**: All 7 tests pass.

---

### Task 1.7: Prompt-level tests for HVAC hints and version gating

**File**: `packages/core/src/__tests__/classifier/classifier-prompt-constraints.test.ts`

**Add tests to existing "domain hints version gating" suite**:

1. V2 prompt at version 2.3.0 includes "HVAC CLASSIFICATION HINTS"
2. V1 prompt at version 2.3.0 includes "HVAC CLASSIFICATION HINTS"
3. V2 prompt at version 2.2.0 does NOT include "HVAC CLASSIFICATION HINTS"
4. V2 prompt at version 2.3.0 still includes domain hints and Priority guidance

**Acceptance**: All 4 tests pass.

---

### Review checkpoint: Batch 1

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Batch 1 is cue expansion + version-gated prompt guidance. No confidence formula or policy changes.

---

## Batch 2 — Emergency Priority Cue Hardening (Undisputed Items Only)

> **Authority-conflict note**: The gold set labels certain scenarios as `emergency` that
> `risk_protocols.json` classifies as severity `high` — specifically: "no heat" (trigger
> `no-heat-001`, severity high) and "electrical safety" (trigger `safety-001`, severity high).
> This batch does NOT encode those disputed escalations. It only adds emergency cues
> (no prompt rules) for scenarios where `risk_protocols.json` already agrees the severity is
> `emergency` (fire, flood, gas leak) or where no operational definition exists yet
> (structural collapse, CO detector, burning smell). The disputed items are held in
> Batch 2b, gated on a stakeholder decision — see §Batch 2b below.

### Task 2.1: Expand Priority.emergency cues (undisputed only)

**File**: `packages/schemas/classification_cues.json`

**Change**: Replace the Priority.emergency entry (currently 5 keywords, 0 regex) with cues that align with `risk_protocols.json` severity=emergency triggers, plus scenarios with no existing operational definition:

```json
"emergency": {
  "keywords": [
    "flood", "flooding", "flooded",
    "fire", "flames",
    "gas leak", "smell gas", "natural gas",
    "burst pipe", "water everywhere",
    "sewage",
    "structural", "falling off", "collapsed",
    "burning", "burning smell", "smoke",
    "carbon monoxide"
  ],
  "regex": [
    "\\b(fire|flood(ing|ed)?|burst\\s+pipe)\\b",
    "\\b(gas\\s+leak|smell(ing)?\\s+gas)\\b",
    "\\b(burn(ing|t)|smoke|smoking|flames?)\\b",
    "\\b(falling\\s+off|collaps(ed|ing)|structur(al|e)\\s+(damage|danger|failure))\\b"
  ]
}
```

**What is included** (undisputed):

- Fire/flames/burning/smoke — `risk_protocols.json` fire-001 severity=emergency
- Flood/burst pipe — `risk_protocols.json` flood-001 severity=emergency
- Gas leak — `risk_protocols.json` gas-001 severity=emergency
- Structural collapse/falling — no operational definition exists; clearly life-safety
- Carbon monoxide — no operational definition exists; clearly life-safety
- Burning smell — fire precursor; aligned with fire-001 trigger grammar ("burning" is already in fire-001 keyword_any)

**What is NOT included** (disputed — see Batch 2b):

- "no heat", "no heating", "freezing" — `risk_protocols.json` no-heat-001 says severity=**high**
- "no electricity", "no power", "blown fuse" — no risk protocol exists; gold set says emergency
- "sparks", "sparking", "exposed wires", "electrical fire" — `risk_protocols.json` safety-001 says severity=**high**
- "safety issue", "unsafe", "hazard" — generic terms; gold set maps to emergency but operational policy is ambiguous

**Acceptance**: "flood in apartment" → Priority cue topLabel=emergency. "burning smell from outlet" → Priority cue topLabel=emergency. "gas leak" → Priority cue topLabel=emergency. "no heat" does NOT match Priority.emergency cues (remains in Priority.high per current operational policy).

---

### Task 2.2: Expand Priority.high cues

**File**: `packages/schemas/classification_cues.json`

**Change**: Extend Priority.high (currently 5 keywords):

```json
"high": {
  "keywords": [
    "no water", "no hot water",
    "sparks", "sparking", "exposed wires",
    "infestation", "dangerous", "mold",
    "broken lock", "locked out", "major leak",
    "water damage", "pest", "rodent", "cockroach",
    "no heat", "no heating", "freezing",
    "no electricity", "no power",
    "safety issue", "unsafe", "hazard"
  ],
  "regex": [
    "\\b(no\\s+(water|hot\\s+water|heat|heating|electricity|power))\\b",
    "\\b(locked\\s+out|broken\\s+lock)\\b",
    "\\b(water\\s+damage|major\\s+leak)\\b",
    "\\b(spark(s|ing)?|exposed\\s+wires?)\\b",
    "\\b(safety\\s+(issue|risk|hazard)|unsafe|danger(ous)?)\\b"
  ]
}
```

**Rationale**: The disputed items (whole-suite utility loss, electrical safety, generic safety language, and access/security failures) are initially placed in Priority.high where the current cue set already catches them. This strengthens the cue signal for high-priority scenarios without front-running policy. Batch 2b then promotes the stakeholder-approved subset: whole-suite loss of heat, water, or electricity, plus true lockout / cannot-secure cases. Electrical safety remains in Priority.high unless a later policy change says otherwise.

**Acceptance**: "no heat in apartment" → Priority cue topLabel=high. "no hot water" → Priority cue topLabel=high. "sparking outlet" → Priority cue topLabel=high. "major leak in ceiling" → Priority cue topLabel=high.

---

### Task 2.3: Unit tests for Priority cue expansion

**File**: `packages/core/src/__tests__/classifier/cue-scoring.test.ts`

**New test suite: "Priority cue coverage"**:

1. "flood in apartment" → Priority cue topLabel=emergency, score >= 0.6
2. "burning smell from outlet" → Priority cue topLabel=emergency, score >= 0.6
3. "gas leak in kitchen" → Priority cue topLabel=emergency, score >= 0.6
4. "falling off the wall" → Priority cue topLabel=emergency
5. "no heat in apartment" → Priority cue topLabel=**high** (not emergency — operational policy)
6. "sparking outlet" → Priority cue topLabel=**high** (not emergency — operational policy)
7. "safety issue with electrical" → Priority cue topLabel=**high**
8. "no hot water" → Priority cue topLabel=high
9. "major leak in ceiling" → Priority cue topLabel=high
10. "leak" → Priority cue topLabel=normal (unchanged)
11. "cosmetic scratch" → Priority cue topLabel=low (unchanged)

**Acceptance**: All 11 tests pass. Tests 5-7 explicitly verify that disputed items stay in Priority.high.

---

### Review checkpoint: Batch 2

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Batch 2 is cue expansion only — no prompt escalation rules. No confidence formula changes.

---

## Batch 2b — Vital-Service + Access/Security Escalation (APPROVED POLICY)

> **Status**: APPROVED. Stakeholder guidance now resolves the Batch 2 authority gap for
> whole-suite vital-service loss and true access/security failures. This batch does NOT
> promote electrical safety language to `emergency`; those scenarios remain `high` per
> `risk_protocols.json` until a separate policy decision says otherwise.

### Approved Policy

Treat these conditions as Priority=`emergency`:

- Loss of heat for the entire suite
- Loss of electricity for the entire suite
- Loss of water for the entire suite
- Inability to access the building or the suite
- Inability to secure the building or the suite (for example, doors will not lock)
- Tenant locked out of the suite

Do NOT treat these conditions as Priority=`emergency`:

- Partial outages affecting one room, fixture, or area only
- No hot water, even if suite-wide
- Intercom failure when a key or fob still provides access
- Lost or replacement fob requests unless the tenant is actually locked out
- Door defects that are inconvenient but still allow the suite/building to be secured
- Electrical safety issues such as sparks or exposed wires; these remain `high` in this plan

### Tasks

- **Task 2b.1**: Update `packages/schemas/classification_cues.json` to promote whole-suite vital-service loss cues from Priority.high to Priority.emergency. Add explicit suite-wide phrases and regex for:
  - "no heat in the whole apartment/unit/suite"
  - "no power/no electricity in the whole apartment/unit/suite"
  - "no water in the whole apartment/unit/suite"
  Keep generic "no heat", "no power", and "no water" cues in Priority.high unless the text clearly implies the entire suite.
- **Task 2b.2**: Update `packages/schemas/classification_cues.json` to promote access/security emergencies to Priority.emergency:
  - "locked out", "can't get into the suite", "can't get into the building"
  - "door won't lock", "can't lock the door", "can't secure the unit/building"
  Add counter-cues so these remain below emergency when the text says access still works (`key still works`, `fob still works`) or the door still locks.
- **Task 2b.3**: Update `packages/schemas/risk_protocols.json`:
  - Change `no-heat-001` to severity=`emergency`, but narrow its grammar to whole-suite heat loss
  - Add new emergency triggers for whole-suite no electricity, whole-suite no water, lockout / no access, and cannot-secure scenarios
  - Leave `safety-001` at severity=`high`
- **Task 2b.4**: Add `PRIORITY_ESCALATION_BLOCK` to `packages/core/src/llm/prompts/classifier-prompt.ts`, version-gated to `2.4.0+`:
  ```
  PRIORITY ESCALATION RULES:
  - Entire-suite loss of heat, electricity, or water is "emergency".
  - Inability to access or secure the building or suite is "emergency".
  - Partial outages (one room, one fixture, one area) are not "emergency".
  - "No hot water" is not "emergency".
  - Intercom-only failures and lost/replacement fob requests are not "emergency" unless they cause a real lockout.
  - Electrical safety issues remain "high" in this version; do not promote them to "emergency" without a separate policy update.
  ```
- **Task 2b.5**: Update `packages/schemas/src/version-pinning.ts` — bump `PROMPT_VERSION` from `2.3.0` to `2.4.0`, bump `CUE_VERSION` from `1.6.0` to `1.7.0`, and export the new prompt-gate constant.
- **Task 2b.6**: Extend `packages/core/src/__tests__/classifier/cue-scoring.test.ts` with regressions that cover:
  - "no heat in entire apartment" -> emergency
  - "no heat in bedroom only" -> high
  - "no water anywhere in the suite" -> emergency
  - "kitchen sink has no water but bathroom works" -> high or normal, not emergency
  - "no electricity in the whole unit" -> emergency
  - "locked out of my apartment" -> emergency
  - "intercom is broken but my fob still works" -> not emergency
  - "front door does not close automatically but still locks" -> not emergency
  - "no hot water" -> not emergency
- **Task 2b.7**: Add prompt-level tests that verify the `2.4.0` gate enables the new Priority escalation block while `2.3.0` remains limited to HVAC hints plus the `needs_object` guard.

---

## Batch 3 — Multi-Issue Schema Failure Fix + Cross-Cutting Prompt Guidance

### Task 3.1: Add `needs_object` field-confusion guard to classifier prompt

**File**: `packages/core/src/llm/prompts/classifier-prompt.ts`

**Change**: Extend the NEEDS_OBJECT GUIDANCE section in v2 prompt (gated on 2.3.0+):

Current text (lines 139-141):

```
NEEDS_OBJECT GUIDANCE:
- Use "needs_object" when the category/problem type is understood but the specific object cannot be identified from the text.
- Do not use "needs_object" as a lazy default — use it only when there genuinely is an object involved but it is ambiguous.
```

Add (version-gated to 2.3.0+):

```
- IMPORTANT: "needs_object" is ONLY valid for the Maintenance_Object field.
  Do NOT use "needs_object" as a value for Maintenance_Problem or any other field.
  If the problem type is unclear, use "other_problem" for Maintenance_Problem.
```

**Rationale**: The gold-v1-SR-1018 schema failure was caused by the model placing `needs_object` in the Maintenance_Problem field. The v2 prompt already says "the specific object cannot be identified" but the model sometimes confuses the concept. An explicit negative instruction prevents the specific failure mode.

**Acceptance**: V2 prompt at 2.3.0 includes the "ONLY valid for the Maintenance_Object field" text.

---

### Task 3.2: Add targeted retry hint for needs_object misplacement

**File**: `packages/core/src/classifier/issue-classifier.ts`

**Change**: In the Phase 1 retry loop (lines 58-108), when `lastSchemaError` contains a taxonomy validation failure for `Maintenance_Problem` with value `needs_object`, construct a richer `retryHint` string that the adapter will pass through to `buildClassifierUserMessage`.

Currently (line 62):

```typescript
raw = await llmCall(input, attempt > 0 ? { retryHint: 'schema_errors' } : undefined, obsCtx);
```

Change to:

```typescript
let retryHint = 'schema_errors';
if (
  Array.isArray(lastSchemaError) &&
  lastSchemaError.some(
    (e: Record<string, unknown>) => e.field === 'Maintenance_Problem' && e.value === 'needs_object',
  )
) {
  retryHint =
    'schema_errors — "needs_object" is only valid for the Maintenance_Object field, not Maintenance_Problem. Use "other_problem" or "not_working" for Maintenance_Problem.';
}
raw = await llmCall(input, attempt > 0 ? { retryHint } : undefined, obsCtx);
```

**Why issue-classifier.ts, not classifier-adapter.ts**: The retry loop and `lastSchemaError` data live in `callIssueClassifier()` (issue-classifier.ts). The adapter (`classifier-adapter.ts`) only builds the prompt and returns parsed JSON — it has no access to the validation errors that inform which corrective hint is needed. The `retryHint` string flows from issue-classifier → adapter → `buildClassifierUserMessage`, which already formats it into the retry context block.

**Rationale**: The schema-lock retry mechanism already exists (spec §2.3: "1 retry on schema validation failure"). Adding a targeted hint for this specific failure mode gives the model enough context to self-correct on retry without changing the retry count or general behavior.

**Acceptance**: When the model returns `Maintenance_Problem="needs_object"`, the retry includes the corrective hint. After retry, the model should return a valid Problem value.

---

### Task 3.3: Unit test for needs_object retry hint

**File**: `packages/core/src/__tests__/classifier/issue-classifier.test.ts`

**New test**: When the LLM returns `Maintenance_Problem: "needs_object"` (taxonomy-invalid), the retry call receives a `retryHint` string containing "only valid for Maintenance_Object".

**Acceptance**: Test passes.

---

### Task 3.4: Integration test for needs_object retry recovery

**File**: `packages/core/src/__tests__/classifier/issue-classifier.test.ts`

**Why not FixtureClassifierAdapter**: `FixtureClassifierAdapter` returns one static output per issue_id and has no sequence support. `issue-replay.ts` calls `classifierAdapter.classify()` once — it does not exercise the retry loop. The retry loop lives in `callIssueClassifier()`, so the integration test belongs at that layer.

**Test**: Create a sequencing mock `LlmClassifierFn` that returns `Maintenance_Problem: "needs_object"` on the first call (triggering taxonomy validation failure) and a corrected classification with `Maintenance_Problem: "not_working"` on the second call (retry). Pass it to `callIssueClassifier()` and verify:

1. Result status is `'ok'`
2. Output contains `Maintenance_Problem: "not_working"` (corrected value)
3. The mock was called exactly twice (initial + 1 retry)

**Acceptance**: Test passes — the pipeline recovers from the needs_object misplacement on retry via the targeted hint.

---

### Review checkpoint: Batch 3

```bash
pnpm test && pnpm typecheck && pnpm lint
```

---

## Batch 4 — Validation + Baselines

### Task 4.1: Update spec with HVAC guidance and Priority cue expansion

**File**: `docs/spec.md`

**Change**: In §14.4 (cue dictionary), add notes for both shipped and follow-on changes:

- Cue version `1.6.0` / prompt version `2.3.0`: HVAC cue expansion, HVAC prompt hints, and the `needs_object` prompt guard
- Cue version `1.7.0` / prompt version `2.4.0`: whole-suite vital-service escalation and access/security escalation rules (heat, electricity, water, lockout, cannot-secure), plus explicit exclusions for partial outages, no hot water, intercom-only failures, and lost/replacement fobs without lockout

**What this does NOT add**: No documentation claim that electrical safety was promoted to `emergency`; that remains `high` unless `risk_protocols.json` changes in a separate follow-up.

**Acceptance**: Spec text matches implementation. No contradictions with existing sections or with `risk_protocols.json`.

---

### Task 4.2: Update spec-gap-tracker

**File**: `docs/spec-gap-tracker.md`

**Changes**:

- Update evidence for S14-10 and S14-11 to reference the new cue version (1.6.0) and prompt version (2.3.0)
- Add evidence notes for the HVAC cue expansion (`1.6.0` / `2.3.0`)
- Add evidence notes for Batch 2b (`1.7.0` / `2.4.0`): whole-suite vital-service escalation and access/security escalation, including the exclusions for partial outages, no hot water, and intercom/fob cases without lockout
- Explicitly note that electrical safety remains `high`
- Update `Last updated` date
- Recount dashboard totals if any statuses changed

**Acceptance**: Tracker reflects the new cue/prompt changes.

---

### Task 4.3: Run provider-backed gold-v1 eval

**Prerequisite**: Batches 1-3 complete, all tests pass.

```bash
pnpm --filter @wo-agent/evals eval:run --dataset gold-v1 --adapter anthropic
```

**Success criteria** (compared to provisional baseline):

- `field_accuracy` > 0.7894 (improvement from baseline)
- `schema_invalid_rate` ≤ 0.0047 (no increase; ideally 0 if Task 3.1-3.2 prevents the needs_object failure)
- `contradiction_after_retry_rate` ≤ 0.0047 (no increase)
- hvac slice `field_accuracy` > 0.6889 (improvement)
- multi_issue slice `field_accuracy` > 0.7605 (improvement)
- multi_issue slice `schema_invalid_rate` = 0 (needs_object fix)

**Emergency slice note**: Batch 2b resolved whole-suite vital-service loss (heat, electricity, water) and real access/security failures (lockout, cannot-secure) as Priority=`emergency`. Only electrical-safety escalation remains out of scope — those scenarios stay at Priority=`high` per `risk_protocols.json`.

**Slice-level targets** (aspirational, not blocking):

- hvac: field_accuracy >= 0.78 (from 0.6889)
- emergency: field_accuracy improvement reflects Batch 2b escalation policy (whole-suite vital-service loss + access/security). Remaining ceiling driven by electrical-safety scenarios that stay at Priority=high
- Overall: field_accuracy >= 0.81

**Post-run**: Baseline promotion is handled in Task 4.6 (see `docs/plans/gold-v1-closeout-addendum.md`). Do not overwrite the baseline file here.

---

### Task 4.4: Run provider-backed regression eval

**Prerequisite**: Task 4.3 passes.

```bash
pnpm --filter @wo-agent/evals eval:run --dataset regression --adapter anthropic
```

**Success criteria**: No blocking-metric regression from `regression-anthropic-baseline.json`.

**Post-run**: Baseline promotion is handled in Task 4.6 (see `docs/plans/gold-v1-closeout-addendum.md`). Do not overwrite the baseline file here.

---

### Task 4.5: Run provider-backed hard eval

**Prerequisite**: Task 4.4 passes.

```bash
pnpm --filter @wo-agent/evals eval:run --dataset hard --adapter anthropic
```

**Success criteria**: No blocking-metric regression from `hard-anthropic-baseline.json`.

**Post-run**: Baseline promotion is handled in Task 4.6 (see `docs/plans/gold-v1-closeout-addendum.md`). Do not overwrite the baseline file here.

---

### Review checkpoint: Batch 4

All three provider-backed eval gates pass. Baseline promotion and evidence updates applied to worktree; commit pending.

---

## Dependency Graph

```
Batch 1 → Batch 2 (sequential — shared write surface):
  Batch 1: Task 1.1 → 1.2 → 1.3 → 1.4 + 1.5 (parallel) → 1.6 → 1.7
  Batch 2: Task 2.1 → 2.2 → 2.3

  Batches 1 and 2 are SEQUENTIAL, not parallel. Both modify:
    - packages/schemas/classification_cues.json
    - packages/schemas/src/version-pinning.ts
  Batch 1 also modifies packages/core/src/llm/prompts/classifier-prompt.ts,
  which Batch 2b also modifies. Executing them in parallel
  would cause merge conflicts on all three files.

Batch 3 (after Batches 1 + 2):
  Task 3.1 → 3.2 → 3.3 → 3.4

Batch 2b (after Batch 3 — shared prompt/version files, separate 2.4.0 gate):
  Task 2b.1 → 2b.2 → 2b.3 → 2b.4 → 2b.5 → 2b.6 + 2b.7 (parallel)

Batch 4 (after Batch 2b):
  Task 4.1 + 4.2 (parallel)
  Task 4.3 → 4.4 → 4.5 (sequential — each gate must pass)
```

---

## Assumptions

- **A1**: `ANTHROPIC_API_KEY` is available for provider-backed evals.
- **A2**: Prompt version `2.3.0` remains reserved for HVAC hints and the `needs_object` guard only. Batch 2b introduces a separate `2.4.0` gate for Priority escalation rules so the policy expansion remains isolated and auditable.
- **A3**: Cue dictionary expansion does not require taxonomy changes — all referenced values already exist in `taxonomy.json`.
- **A4**: The stakeholder decision resolves the authority conflict for whole-suite loss of heat, water, and electricity, plus access/security failures that create a real lockout or cannot-secure condition. Partial outages, no hot water, intercom-only failures, and fob issues without lockout stay below `emergency`. Electrical safety remains `high` because that policy was not changed here.
- **A5**: ~~Provisional~~ **RESOLVED 2026-03-27** — `schema_invalid_rate = 0` and `contradiction_after_retry_rate = 0` in the post-hardening provider run. The gold-v1-anthropic-baseline.json is now an accepted comparison floor, promoted in Task 4.6 (see `docs/plans/gold-v1-closeout-addendum.md`).
- **A6**: No maintenance Category cue changes in this plan (same scope restriction as predecessor). Only HVAC Maintenance_Category, Maintenance_Object, and Priority cues are expanded.
- **A7**: Multi-issue field accuracy improvement is expected as a side effect of HVAC cue hardening plus the expanded emergency rules for whole-suite outages and real lockout/cannot-secure cases. The remaining improvement ceiling is limited by electrical-safety scenarios that stay at `high`.

---

## Risk Notes

- **Batch 1**: HVAC cue expansion adds "heater", "baseboard", "ventilation" — these could cause false-positive matches on non-HVAC issues (e.g., "water heater" is plumbing). The ambiguity penalty handles this: when both plumbing and hvac cues fire, confidence drops and the field enters followup. "Water heater" is a known edge case that may need a constraint or negative cue in a future plan.
- **Batch 2**: Priority cue expansion is scoped to undisputed items only (fire, flood, gas, structural, burning). Whole-suite utility loss and access/security phrases may still sit in `high` after this batch, which is acceptable because Batch 2b handles the approved escalation policy in a separately versioned step.
- **Batch 2b**: This batch changes operational escalation behavior for whole-suite heat/water/electricity loss and real access/security failures. The main risk is overmatching partial outages or routine access issues, so the regex/counter-cue coverage needs to be suite-wide and lockout-specific. Electrical safety is intentionally excluded from the promotion logic.
- **Batch 3**: The needs_object prompt guard is a low-risk additive instruction. The retry hint is targeted to the specific failure mode.
- **Batch 4**: Provider-backed evals may show unexpected regressions on slices not targeted by this plan. If a non-targeted slice regresses, investigate before overwriting the baseline.

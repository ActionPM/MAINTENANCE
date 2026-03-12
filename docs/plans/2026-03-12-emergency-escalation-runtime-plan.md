# Emergency Escalation Runtime Plan

**Date:** 2026-03-12
**Status:** Proposed for review
**Supersedes:** Runtime-execution portion of [2026-03-03-phase-09-risk-emergency.md](./2026-03-03-phase-09-risk-emergency.md)

**Goal:** Replace the current MVP emergency router with a production-usable escalation workflow that can place real phone calls, fall back to SMS acceptance, notify already-contacted responders when the incident is claimed, and retry deterministically until the incident is accepted or the configured retry ceiling is reached.

---

## 1. Why This Plan Exists

The repo already contains first-generation building blocks for risk handling:

| Component | File | What it does | What it can't do |
|---|---|---|---|
| Trigger scanner | `packages/core/src/risk/trigger-scanner.ts` | Deterministic keyword/regex/taxonomy matching | Nothing missing — this is complete |
| Mitigation engine | `packages/core/src/risk/mitigation.ts` | Template lookup + safety message rendering | Nothing missing |
| Emergency router | `packages/core/src/risk/emergency-router.ts` | Synchronous call-until-answered through contact chain | Async workflow, retries, SMS acceptance, stand-down |
| Event builders | `packages/core/src/risk/event-builder.ts` | Append-only `risk_detected`, `escalation_attempt`, `escalation_result` events | Incident lifecycle events |
| Risk scan integration | `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts` (lines 58–100) | Scans text before splitter, sets `escalation_state: 'pending_confirmation'`, renders mitigation messages, shows confirm/decline quick replies | No handler processes the quick-reply response |
| Risk types | `packages/schemas/src/types/risk.ts` | `EscalationState`, `EscalationAttempt`, `EscalationResult`, `ContactChainEntry` | `answered: boolean` is too simple; no incident model |
| Session fields | `packages/core/src/session/types.ts` (lines 58–63) | `risk_triggers`, `escalation_state`, `escalation_plan_id` | No `building_id` |
| Risk data files | `packages/schemas/risk_protocols.json`, `packages/schemas/emergency_escalation_plans.json` | 5 triggers, 5 mitigation templates, 1 example plan | Plans are not loaded in production factory |
| Factory wiring | `apps/web/src/lib/orchestrator-factory.ts` (lines 237–243) | Injects empty `{ plans: [] }` and `async () => false` executor | Dead code — escalation cannot execute |

The current `ContactExecutor` type signature (`(contact: ContactChainEntry) => Promise<boolean>`) models a single synchronous call attempt. The required runtime behavior is an asynchronous, multi-step workflow where acceptance arrives minutes later via an inbound SMS webhook. That requires a fundamentally different execution model.

### What the required runtime behavior looks like

1. Emergency is system-triggered: LLM-assessed, deterministically rule-validated.
2. Tenant is explicitly asked to confirm the emergency before routing begins (spec §17: "Confirm emergency via yes/no before routing").
3. For each contact in the building chain:
   - place a phone call (alerting only)
   - if unanswered after 60 seconds, send an SMS prompt
   - SMS prompt offers `ACCEPT` or `IGNORE`
4. Answering the phone does not count as pickup; the responder must explicitly accept via SMS.
5. The first accepted pickup stops further escalation immediately.
6. Everyone already contacted for that incident receives a stand-down SMS naming who picked it up.
7. If the chain is exhausted, the system applies plan exhaustion behavior, waits the configured delay, and retries until someone accepts or the configured retry ceiling is reached.

---

## 2. Locked Product Decisions

The following decisions are treated as approved unless review changes them:

1. Emergency escalation remains in scope for the product.
2. Emergency escalation is the one explicit exception to the normal "no side effects before `CONFIRM_SUBMISSION`" rule, but only after explicit tenant confirmation of the emergency (spec §17 already contemplates this).
3. Phase 1 pickup confirmation is SMS-only. Voice calls are alerting only (no DTMF/IVR).
4. Email is not in the critical path for the first production slice.
5. Only contacts already reached for that incident receive the stand-down notification.
6. Phone numbers are deduped within a retry cycle.
7. If a contact ignores or does not respond, the coordinator advances to the next contact.
8. Retries restart at the top of the chain on the next cycle.
9. Default retry ceiling is 3 full cycles per incident, configurable per plan.
10. Initial rollout behind `EMERGENCY_ROUTING_ENABLED` feature flag, narrow canary only.

---

## 3. Architecture Design

### 3.1 Emergency confirmation as a sidecar action

Emergency confirmation is modeled as an **orthogonal concern**, not a conversation state fork.

The session already tracks `escalation_state` as a field alongside the main conversation `state`. This is correct: a tenant can have emergency routing in progress while their conversation continues through split/classify/confirm. The two workflows are independent.

What's missing is an **action handler** that processes the tenant's emergency confirmation response. The current code renders quick-reply buttons (`confirm_emergency` / `decline_emergency` in [submit-initial-message.ts:95–98](packages/core/src/orchestrator/action-handlers/submit-initial-message.ts#L95-L98)) but no handler processes them. Worse, these quick replies lack an `action_type` field, so the client-side dispatcher in [chat-shell.tsx:45–58](apps/web/src/components/chat-shell.tsx#L45-L58) falls through to the default case and sends them as `SUBMIT_ADDITIONAL_MESSAGE` with the value as body text — actively wrong behavior for an emergency confirmation.

**Design decision:** Add `CONFIRM_EMERGENCY` and `DECLINE_EMERGENCY` as new action types. These are **sidecar actions** — they do not change the conversation state. They change only the session's `escalation_state` field. They should be valid from any non-terminal conversation state when `escalation_state === 'pending_confirmation'`.

Implementation approach:
- Add `CONFIRM_EMERGENCY` and `DECLINE_EMERGENCY` to the `ActionType` enum in `packages/schemas/src/action-types.ts`
- Add them to the photo-action-like "valid from any state" set (they bypass the transition matrix)
- Add a dispatcher guard: reject if `session.escalation_state !== 'pending_confirmation'`
- `CONFIRM_EMERGENCY` handler: writes confirmation event, creates escalation incident, kicks off coordinator, sets `escalation_state: 'routing'`
- `DECLINE_EMERGENCY` handler: writes decline event, sets `escalation_state: 'none'`, returns safety messaging

**Rehydration after reload/resume:** The `response-builder.ts` currently only includes `quick_replies` that a handler produced in that specific request ([response-builder.ts:68](packages/core/src/orchestrator/response-builder.ts#L68)). After a page reload or session resume, a session can be in `pending_confirmation` with no confirm/decline buttons in the UI. The response builder must reconstruct emergency confirmation quick replies from session state: when `escalation_state === 'pending_confirmation'`, always include the confirm/decline quick replies in the `ui_directive`, regardless of which handler produced the response. This applies to any action response, resume responses, and the `GET /conversations/:id` read path.

### 3.2 Two-layer execution split

Split the feature into two layers:

1. **Deterministic decisioning** inside the orchestrator — runs synchronously in the action handler request/response cycle. Decides whether an emergency exists, whether the tenant confirmed, and creates the incident record.

2. **Asynchronous escalation execution** outside the request/response path — managed by an escalation coordinator that processes incidents over time via:
   - Outbound voice calls (Twilio)
   - Outbound SMS prompts (Twilio)
   - Inbound SMS replies (Twilio webhook)
   - Scheduled retries (Vercel Cron → internal API route)

The orchestrator never blocks waiting for a responder to answer.

### 3.3 Building identity in trusted scope

The escalation plan is selected by `building_id`, but `UnitResolver` currently returns only `unit_id`, `property_id`, `client_id` ([unit-resolver/types.ts](packages/core/src/unit-resolver/types.ts)).

Required changes:
- Add `building_id` to `UnitInfo` interface
- Return `building_id` from every `UnitResolver` implementation (stub, mock, production)
- Persist `building_id` on the session (add field to `ConversationSession`)
- Set `building_id` during unit resolution in `SELECT_UNIT` handler

### 3.4 Escalation data model

The current `EscalationAttempt` type uses `answered: boolean` which cannot represent the required workflow states (call placed, call timed out, SMS sent, accepted, ignored, no response).

**New domain types:**

```typescript
// Incident lifecycle
export const EscalationIncidentStatus = {
  ACTIVE: 'active',
  ACCEPTED: 'accepted',
  EXHAUSTED_RETRYING: 'exhausted_retrying',
  EXHAUSTED_FINAL: 'exhausted_final',
} as const;

// Per-contact attempt outcome
export const EscalationAttemptOutcome = {
  CALL_ANSWERED: 'call_answered',
  CALL_NO_ANSWER: 'call_no_answer',
  CALL_FAILED: 'call_failed',
  SMS_SENT: 'sms_sent',
  SMS_ACCEPTED: 'sms_accepted',
  SMS_IGNORED: 'sms_ignored',
  SMS_NO_RESPONSE: 'sms_no_response',
} as const;
```

**Mutable `escalation_incidents` store:**

Justified because:
- Delayed retries need durable scheduling state
- Inbound SMS replies need idempotent claim handling
- Stand-down notifications need fast lookup of who was already contacted
- Reconstructing workflow state from append-only events on every webhook hit is impractical

Incident fields:
- `incident_id`, `conversation_id`, `building_id`, `plan_id`
- `status` (EscalationIncidentStatus)
- `cycle_number`, `max_cycles`
- `current_contact_index` (position in chain)
- `next_action_at` (ISO timestamp — when the coordinator should next act)
- `processing_lock_until` (ISO timestamp — prevents overlapping cron runs from double-processing; see §3.5.1)
- `last_provider_action` (string — idempotency tag for the most recent outbound action, e.g. `"call:contact-bm-001:cycle-1"`; see §3.5.1)
- `accepted_by_phone` (E.164 string — canonical acceptance identity; see §3.9)
- `accepted_by_contact_id` (string — best-effort attribution from phone; may be ambiguous if phone is shared)
- `accepted_at`
- `contacted_phone_numbers` (array — for stand-down recipient selection)
- `internal_alert_sent_cycles` (array of cycle numbers where internal alert was sent)
- `row_version` (optimistic locking — critical for concurrent ACCEPT handling and cron-lock claims)
- `created_at`, `updated_at`

**Append-only risk event expansion:**

Keep existing event types and add:
- `emergency_confirmation_requested`
- `emergency_confirmed`
- `emergency_declined`
- `escalation_incident_started`
- `voice_call_initiated`
- `voice_call_completed` (with outcome)
- `sms_prompt_sent`
- `sms_reply_received` (ACCEPT or IGNORE)
- `stand_down_sent`
- `cycle_exhausted`
- `internal_alert_sent`
- `escalation_incident_closed`

### 3.5 Escalation coordinator

Replace the current synchronous `routeEmergency()` with an **escalation coordinator** that manages async execution.

The coordinator is a set of pure functions (no internal state) that operate on the `EscalationIncident` record. Each function reads the incident, performs the next action, writes the updated state, and returns.

Entry points:
1. **`startIncident()`** — called by the `CONFIRM_EMERGENCY` handler. Creates the incident record, initiates the first contact attempt.
2. **`processCallOutcome()`** — called by the voice-status webhook. If call was not answered, sends SMS fallback.
3. **`processReply()`** — called by the SMS webhook. On ACCEPT: claim incident (CAS on `row_version`), send stand-downs. On IGNORE: advance to next contact.
4. **`processDue()`** — called by cron. Handles: SMS timeout (no reply → advance), cycle exhaustion (→ retry or final), next contact attempt.

Concurrency control: `processReply()` uses CAS (compare-and-swap) on `row_version` to handle simultaneous ACCEPT replies. First writer wins; second gets a conflict and re-reads to see the incident was already accepted.

#### 3.5.1 Cron overlap and idempotency

Vercel explicitly warns that cron invocations can overlap and can be delivered more than once. `processDue()` must be safe under both conditions:

1. **Claim-before-process lock.** Before processing an incident, `processDue()` atomically sets `processing_lock_until` to `now + lock_duration` (e.g. 90 seconds) via CAS on `row_version`. The `getDueIncidents()` query filters to `next_action_at <= now AND (processing_lock_until IS NULL OR processing_lock_until <= now)`. If the CAS fails, another run already claimed the incident — skip it.

2. **Per-action idempotency.** Before placing a voice call or sending an SMS, the coordinator checks `last_provider_action` against a deterministic tag for the current action (e.g. `"call:contact-bm-001:cycle-1"`). If it matches, the action was already sent by an earlier overlapping run — skip it and advance to the next step. After a successful provider call, update `last_provider_action` atomically.

3. **Lock expiry as safety net.** If a cron run crashes mid-processing, the lock expires after `lock_duration` and the next run picks up where it left off. The idempotency tag prevents re-sending the already-completed provider action.

### 3.6 Provider layer

**Twilio for Phase 1** (voice + SMS through one provider).

New abstractions:
```typescript
export interface VoiceCallProvider {
  placeCall(to: string, twiml: string, statusCallbackUrl: string): Promise<{ callSid: string }>;
}

export interface SmsProvider {
  sendSms(to: string, body: string): Promise<{ messageSid: string }>;
}
```

Twilio-specific implementation lives in `apps/web/src/lib/emergency/` (not in core — keeps core provider-agnostic).

**Webhook surfaces:**

| Route | Purpose | Security |
|---|---|---|
| `POST /api/webhooks/twilio/voice-status` | Voice call completion/no-answer/failure | Twilio request signature validation |
| `POST /api/webhooks/twilio/sms-reply` | Inbound `ACCEPT` / `IGNORE` replies | Twilio request signature validation |
| `GET /api/cron/emergency/process-due` | Cron-triggered: process timed-out contacts, advance chain, schedule retries | `Authorization: Bearer ${CRON_SECRET}` |

**Webhook security:** All Twilio webhooks must validate the `X-Twilio-Signature` header against the request URL and params using the Twilio auth token. This prevents spoofed ACCEPT replies.

**Vercel Cron:** The `process-due` route is triggered by a Vercel Cron Job. Per [Vercel's cron documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs), cron-secured Route Handlers must be **GET** handlers. Vercel sends an `Authorization: Bearer ${CRON_SECRET}` header that the route must validate. Configure in `vercel.json`:
```json
{ "crons": [{ "path": "/api/cron/emergency/process-due", "schedule": "* * * * *" }] }
```
Recommended interval: every 60 seconds (`* * * * *`).

### 3.7 Suggested copy

**Voice call script (TwiML `<Say>`):**

> There is an active building emergency at [Building Name]. You are next in the emergency response chain because this incident has not yet been accepted. Details have been sent by text. Reply ACCEPT to take ownership or IGNORE to pass. If no one accepts, escalation will continue.

**SMS prompt:**

> Emergency at [Building Name]. Reply ACCEPT to take ownership or IGNORE to pass. Incident: [short summary].

**Stand-down SMS:**

> Emergency at [Building Name] has been accepted by [Name]. Please disregard earlier calls or texts for this incident.

**Internal alert SMS (on cycle exhaustion):**

> ALERT: Emergency escalation at [Building Name] exhausted cycle [N]/[max]. No responder has accepted. Incident: [incident_id].

### 3.8 Acceptance canonicality and phone-number dedupe

Phone numbers are deduped within a retry cycle (locked decision #6), but the same phone number can appear under multiple `contact_id` entries if one person holds multiple roles (e.g., building manager who is also fallback after-hours). This creates ambiguity when attributing acceptance.

**Design decision:** Acceptance is canonical by **phone number**, not by `contact_id`. The incident stores `accepted_by_phone` (E.164) as the authoritative acceptance identity. `accepted_by_contact_id` is set on a best-effort basis (first contact_id matching that phone in the plan). Stand-down notifications are also keyed by phone number, not contact_id.

Escalation plans should enforce unique phone numbers per building plan as a data-quality rule (validated at plan load time with a warning, not a hard error — shared numbers are unusual but not impossible in small buildings). If a shared phone accepts, stand-down still works correctly because it operates on the `contacted_phone_numbers` set, which is already deduped.

### 3.9 Sidecar actions as an architectural exception

The codebase currently has one class of matrix-bypassing action: **photo actions** (`UPLOAD_PHOTO_INIT`, `UPLOAD_PHOTO_COMPLETE`), which are valid from any state and do not change the conversation state. Emergency actions (`CONFIRM_EMERGENCY`, `DECLINE_EMERGENCY`) are a second class.

This is an explicit architectural exception, not an incidental implementation detail. The transition matrix in `packages/core/src/state-machine/transition-matrix.ts` is the authoritative source for state transitions. Actions that bypass it must be:

1. Explicitly registered in a named set (currently `PHOTO_ACTIONS`; this plan adds `EMERGENCY_ACTIONS`)
2. Guarded by their own precondition checks (photo actions are valid from every state including terminal per spec §11.2 and `transition-matrix.ts:7`; emergency actions are valid from any non-terminal state but only when `escalation_state === 'pending_confirmation'`)
3. Documented in the spec §11.2 as exceptions with clear justification

The dispatcher must enforce that no more than these two named exception sets exist. Any future sidecar action proposal must go through the same review gate.

### 3.10 Environment variables

```
EMERGENCY_ROUTING_ENABLED=false          # Feature flag / kill switch
TWILIO_ACCOUNT_SID=...                   # Twilio credentials
TWILIO_AUTH_TOKEN=...                     # Used for signature validation too
TWILIO_FROM_NUMBER=+1...                 # Outbound caller ID / SMS sender
TWILIO_WEBHOOK_BASE_URL=https://...      # Base URL for status callbacks
EMERGENCY_INTERNAL_ALERT_NUMBER=+1...    # Internal ops alert SMS recipient
EMERGENCY_MAX_CYCLES_DEFAULT=3           # Default retry ceiling
EMERGENCY_CALL_TIMEOUT_SECONDS=60        # Voice call ring timeout
EMERGENCY_SMS_REPLY_TIMEOUT_SECONDS=120  # Time to wait for SMS reply before advancing
```

---

## 4. Implementation Tracks

Work in this dependency order. Each track lists concrete file targets and tasks.

### Track 0: Policy and contract alignment

**Why first:** The runtime behavior requires a new action type not yet in the spec or transition matrix.

**Tasks:**

0.1. Add `CONFIRM_EMERGENCY` and `DECLINE_EMERGENCY` to `ActionType` in `packages/schemas/src/action-types.ts`. Add corresponding `TenantInputConfirmEmergency` and `TenantInputDeclineEmergency` (empty interfaces) and union members in `packages/schemas/src/types/orchestrator-action.ts`.

0.2. Add the new action types to the sidecar-action set in the dispatcher (similar to photo actions — valid from any non-terminal state, don't change conversation state). In `packages/core/src/state-machine/transition-matrix.ts`, add a new `EMERGENCY_ACTIONS` set alongside `PHOTO_ACTIONS`.

0.3. Fix existing quick-reply payloads in `packages/core/src/orchestrator/action-handlers/submit-initial-message.ts` (lines 95–98). Add `action_type: 'CONFIRM_EMERGENCY'` and `action_type: 'DECLINE_EMERGENCY'` to the emergency quick-reply objects so they dispatch correctly instead of falling through to `SUBMIT_ADDITIONAL_MESSAGE`.

0.4. Add `CONFIRM_EMERGENCY` and `DECLINE_EMERGENCY` case branches to the client-side quick-reply dispatcher in `apps/web/src/components/chat-shell.tsx` (lines 45–58). Wire them to corresponding methods on the `useConversation` hook. Add those methods to the hook in `apps/web/src/hooks/use-conversation.ts`.

0.5. Update `docs/spec.md` §17 to explicitly document the emergency confirmation action types, sidecar behavior, and the exception to the no-side-effects-before-confirmation rule.

0.6. Update `AGENTS.md` non-negotiable #4 to clarify: "No side effects without confirmation — `CONFIRM_SUBMISSION` for work orders, `CONFIRM_EMERGENCY` for escalation."

### Track 1: Building identity

**Why second:** No escalation plan can be selected without trusted `building_id`.

**Tasks:**

1.1. Add `building_id: string` to `UnitInfo` in `packages/core/src/unit-resolver/types.ts`.

1.2. Add `building_id: string | null` to `ConversationSession` in `packages/core/src/session/types.ts`. Initialize to `null` in `createSession()`.

1.3. Add `setBuildingId()` session mutator in `packages/core/src/session/session.ts`.

1.4. Update the `SELECT_UNIT` handler (`packages/core/src/orchestrator/action-handlers/select-unit.ts`) to persist `building_id` from the resolved `UnitInfo` onto the session.

1.5. Update all `UnitResolver` implementations (stub in tests, mock in factory, any DB-backed resolver) to return `building_id`.

1.6. Add tests: building_id flows from UnitResolver → session → confirm-emergency handler.

### Track 2: Schema and storage redesign

**Why third:** The coordinator and provider layer depend on these types and stores.

**Tasks:**

2.1. Add new types to `packages/schemas/src/types/risk.ts`: `EscalationIncidentStatus`, `EscalationAttemptOutcome`, `EscalationContactAttempt` (replaces boolean `answered`), `EscalationIncident`.

2.2. Define `EscalationIncidentStore` interface in `packages/core/src/risk/types.ts`:
```typescript
export interface EscalationIncidentStore {
  create(incident: EscalationIncident): Promise<void>;
  getById(incidentId: string): Promise<EscalationIncident | null>;
  getActiveByConversation(conversationId: string): Promise<EscalationIncident | null>;
  getDueIncidents(now: string): Promise<readonly EscalationIncident[]>;
  update(incident: EscalationIncident, expectedVersion: number): Promise<boolean>; // CAS
}
```

2.3. Implement `InMemoryEscalationIncidentStore` for tests in `packages/core/src/risk/in-memory-incident-store.ts`.

2.4. Expand `event-builder.ts` with builders for the new event types (confirmation requested/confirmed/declined, incident started, voice call, SMS prompt, reply received, stand-down, cycle exhausted, internal alert, incident closed).

2.5. Add `EscalationIncidentStore` to `OrchestratorDependencies` in `packages/core/src/orchestrator/types.ts` (optional field, like `notificationService`).

2.6. Add Postgres migration for `escalation_incidents` table in `packages/db/src/migrations/`. Include `row_version` column, index on `(status, next_action_at)` for the due-processor query.

2.7. Implement `PgEscalationIncidentStore` in `packages/db/src/repos/`.

2.8. Export new types from barrel files (`packages/schemas/src/index.ts`, `packages/core/src/index.ts`).

### Track 3: Provider layer

**Why fourth:** Once interfaces exist, external integration can be built without changing product semantics.

**Tasks:**

3.1. Define `VoiceCallProvider` and `SmsProvider` interfaces in `packages/core/src/risk/types.ts`.

3.2. Implement `TwilioVoiceProvider` in `apps/web/src/lib/emergency/twilio-voice.ts`. Uses Twilio REST API to place calls with TwiML `<Say>` and a status callback URL.

3.3. Implement `TwilioSmsProvider` in `apps/web/src/lib/emergency/twilio-sms.ts`. Sends outbound SMS via Twilio REST API.

3.4. Implement Twilio signature validation utility in `apps/web/src/lib/emergency/twilio-signature.ts`. Validates `X-Twilio-Signature` header against request URL + params + auth token.

3.5. Create `POST /api/webhooks/twilio/voice-status/route.ts`. Validates signature, parses call status, invokes coordinator's `processCallOutcome()`.

3.6. Create `POST /api/webhooks/twilio/sms-reply/route.ts`. Validates signature, parses reply body for ACCEPT/IGNORE, invokes coordinator's `processReply()`.

3.7. Create `GET /api/cron/emergency/process-due/route.ts`. Validates `Authorization: Bearer ${CRON_SECRET}` header per Vercel cron convention. Queries `getDueIncidents()`, invokes coordinator's `processDue()` for each. Must be a GET handler (Vercel cron requirement).

3.8. Add `MockVoiceProvider` and `MockSmsProvider` for tests.

### Track 4: Escalation coordinator

**Why fifth:** Core operational engine. Depends on types (Track 2) and provider interfaces (Track 3).

**Tasks:**

4.1. Implement `startIncident()` in `packages/core/src/risk/escalation-coordinator.ts`. Creates incident record, dedupes phone numbers in cycle, initiates first contact attempt (voice call via provider).

4.2. Implement `processCallOutcome()`. On no-answer/failure: send SMS fallback prompt. On answered: record attempt, wait for SMS acceptance (do not auto-accept voice pickup).

4.3. Implement `processReply()`. On ACCEPT: CAS-update incident status to `accepted`, set `accepted_by_contact_id`, send stand-down SMS to all previously contacted numbers. On IGNORE: advance `current_contact_index`, attempt next contact.

4.4. Implement `processDue()`. Handles: SMS reply timeout (advance to next contact), chain exhaustion within cycle (increment cycle, send internal alert, schedule retry or finalize), next contact attempt after scheduled delay.

4.5. Implement stand-down notification logic. Iterates `contacted_phone_numbers`, sends stand-down SMS to each except the acceptor.

4.6. Implement internal alert logic. Sends SMS to `EMERGENCY_INTERNAL_ALERT_NUMBER` on each cycle exhaustion.

4.7. Unit tests for each coordinator function:
- Plan selection by trusted `building_id`
- Phone number dedupe within cycle
- Call timeout → SMS fallback
- ACCEPT stops escalation
- IGNORE advances chain
- Stand-down recipient selection (excludes acceptor)
- Cycle exhaustion → retry scheduling
- Max-cycle termination
- Concurrent double-ACCEPT (CAS conflict → second sees already-accepted)
- Overlapping cron runs: second run skips locked incident
- Duplicate cron delivery: idempotent — does not re-send already-sent provider action
- Lock expiry: crashed run's lock expires, next run recovers
- Missing plan → safe failure + audit event

### Track 5: Orchestrator wiring and end-to-end flow

**Why sixth:** Connects everything into the product.

**Tasks:**

5.1. Implement `handleConfirmEmergency()` action handler in `packages/core/src/orchestrator/action-handlers/confirm-emergency.ts`. Guard: `escalation_state !== 'pending_confirmation'` → error. Logic: look up plan by `session.building_id`, create incident via coordinator, set `escalation_state: 'routing'`, write confirmation event.

5.2. Implement `handleDeclineEmergency()` action handler in `packages/core/src/orchestrator/action-handlers/decline-emergency.ts`. Sets `escalation_state: 'none'`, writes decline event, returns safety messaging.

5.3. Register both handlers in the dispatcher's action handler map.

5.4. Add dispatcher guard: emergency actions rejected when `escalation_state !== 'pending_confirmation'`.

5.5. Update `apps/web/src/lib/orchestrator-factory.ts`: load real `risk_protocols.json` via `loadRiskProtocols()`, load real `emergency_escalation_plans.json` via `loadEscalationPlans()`, inject real or mock incident store, inject provider adapters (gated by `EMERGENCY_ROUTING_ENABLED`), inject coordinator.

5.6. Create API route `POST /api/conversations/:id/confirm-emergency/route.ts` and `POST /api/conversations/:id/decline-emergency/route.ts`. Auth + ownership + dispatch.

5.7. Ensure emergency confirmation UI survives reload/resume. Two complementary changes:

**(a) Response builder (server-side, action responses only).** Update `packages/core/src/orchestrator/response-builder.ts` to reconstruct emergency confirmation quick replies from session state. When `session.escalation_state === 'pending_confirmation'`, append confirm/decline quick replies to the `ui_directive.quick_replies` array, regardless of which handler produced the current response. This covers RESUME and any other dispatched action that returns a fresh response while the emergency is still pending.

**(b) Client-side synthesis (read path).** `GET /conversations/:id` returns `ConversationSnapshot` only — no `ui_directive`. That contract is snapshot-only by design (spec-gap-tracker S12-01, MVP access plan §C.1) and must not be widened here. Instead, the client synthesizes the confirmation prompt: when the snapshot's `risk_summary.escalation_state === 'pending_confirmation'`, `apps/web/src/components/chat-shell.tsx` renders the confirm/decline quick replies directly from snapshot state, without requiring them in a server directive. This keeps the read endpoint contract stable while ensuring the tenant always sees the emergency confirmation UI.

5.8. Integration tests:
- Emergency keyword → risk scan → tenant confirms → incident created → escalation_state changes
- Tenant declines → no incident created, escalation_state reset
- Full cycle: confirm → voice call → SMS fallback → ACCEPT → stand-down
- Full cycle: confirm → all ignored → cycle exhausted → retry → accepted on cycle 2
- Missing building_id → safe failure
- Missing plan for building → safe failure + audit event
- Confirm emergency without pending_confirmation → rejected
- CONFIRM_EMERGENCY with `EMERGENCY_ROUTING_ENABLED=false` → fail-closed error + safe message
- Resume/reload while `pending_confirmation` → confirm/decline quick replies rehydrated in response

### Track 6: Observability, rollout, and docs

**Why last:** Needs the final runtime shape to exist.

**Tasks:**

6.1. Add structured log points in coordinator (call placed, SMS sent, reply received, incident claimed, cycle exhausted, internal alert).

6.2. Configure `EMERGENCY_ROUTING_ENABLED` feature flag with **fail-closed** behavior. When false:
- `CONFIRM_EMERGENCY` handler returns an explicit error (`EMERGENCY_ROUTING_UNAVAILABLE`) with a safe message: "Emergency routing is not currently available. If this is a life-threatening emergency, please call 911." Writes an `emergency_routing_disabled` audit event. Does **not** advance `escalation_state` to `routing` — leaves it at `pending_confirmation` so the tenant sees a clear failure, not a silent no-op.
- `DECLINE_EMERGENCY` works normally regardless of the flag.
- The cron processor skips all incidents when the flag is off.
- `startIncident()` refuses to execute and throws if called with the flag off (defense-in-depth).
- Any in-progress incidents are effectively paused until the flag is re-enabled.

6.3. Add Vercel Cron Job config for `process-due` route (every 60s).

6.4. Update `docs/spec-gap-tracker.md`: close S17-02 (router wired), S17-03 (confirmation action), S02-07 (deterministic escalation), S01-10 (per-building chain). Update S17-04 to note routing confirmation is covered but mitigation gating remains open. Add new rows for any remaining gaps.

6.5. Write operator runbook: how to configure a building plan, how to add/remove contacts, how to read escalation audit events, how to use the kill switch.

6.6. Update `docs/spec.md` §17 with the final runtime behavior.

---

## 5. Track Dependencies and Parallelization

```
Track 0 (Policy) ──────────────────────┐
                                       ▼
Track 1 (Building ID) ──────┐    Track 2 (Schema)
                             │         │
                             └────┬────┘
                                  ▼
                    ┌─── Track 3 (Provider) ───┐
                    │                          │
                    └──────────┬───────────────┘
                               ▼
                    Track 4 (Coordinator)
                               │
                               ▼
                    Track 5 (Wiring + E2E)
                               │
                               ▼
                    Track 6 (Observability)
```

- **Track 1 and Track 2** can run in parallel after Track 0
- **Track 3 provider interfaces** can be defined alongside Track 2 (implementations need Track 2 types)
- **Track 4** requires Track 2 (types) and Track 3 (provider interfaces)
- **Track 5** requires all prior tracks

---

## 6. Testing Plan

### Unit tests (Track 2–4)

- Plan selection by trusted `building_id`
- Phone number dedupe within a cycle
- Call timeout → SMS fallback behavior
- ACCEPT path (incident claimed, escalation stops)
- IGNORE path (advance to next contact)
- No response path (timeout → advance)
- Stand-down recipient selection (all contacted minus acceptor)
- Cycle exhaustion → retry scheduling
- Max-cycle termination (final exhaustion)
- Concurrent double-ACCEPT (CAS conflict resolution)
- Overlapping cron runs (processing lock prevents double-processing)
- Duplicate cron delivery (idempotent provider action tags)
- Internal alert sent on each exhausted cycle
- Event builder coverage for all new event types

### Integration tests (Track 5)

- Emergency keyword → tenant confirmation → incident start → escalation_state transitions
- Tenant decline → no incident, safe messaging
- Accepted by first contact (happy path)
- Ignored by first contact → accepted by second
- No answers → exhausted cycle → retry scheduled → accepted on cycle 2
- Stand-down sent after acceptance to previously contacted
- Missing plan → safe failure path + audit event
- Missing building_id → safe failure
- CONFIRM_EMERGENCY without pending_confirmation → rejected
- CONFIRM_EMERGENCY from wrong tenant → ownership error
- CONFIRM_EMERGENCY with routing disabled → fail-closed error, safe message, audit event
- Resume/reload with pending_confirmation → confirm/decline quick replies rehydrated

### Provider sandbox tests (Track 3)

- Twilio voice call TwiML generation
- Twilio SMS send
- Twilio webhook signature validation (valid and invalid)
- SMS reply body parsing (ACCEPT, IGNORE, garbage)

### Manual validation (Track 6)

- Canary building only
- Use **at least two distinct test phone numbers** in the canary building plan (two real phones or one real + one Twilio test number). A single contact cannot exercise chain advancement or stand-down delivery.
- Feature flag enabled
- Verify: real voice call to contact 1, real SMS prompt, IGNORE from contact 1, chain advances to contact 2
- Verify: ACCEPT from contact 2, stand-down SMS delivered to contact 1
- Verify: exhaustion path (both ignore → internal alert → retry cycle)
- Verify: kill switch disables all outbound calls/SMS immediately

---

## 7. Rollout Recommendation

Do not enable globally on first merge.

1. Merge behind `EMERGENCY_ROUTING_ENABLED=false`.
2. Configure one real building plan with **at least two distinct test phone numbers** (two real phones or one real + one Twilio test number). A single contact cannot exercise chain advancement or stand-down delivery.
3. Perform tabletop walkthrough of all paths (accept, ignore, exhaust, retry, kill switch).
4. Enable flag for canary building only.
5. Run live dry-run: trigger emergency, confirm, IGNORE from contact 1, verify chain advances to contact 2, ACCEPT from contact 2, verify stand-down SMS to contact 1.
6. Verify internal alert fires on forced exhaustion (both contacts ignore).
7. Enable for additional buildings only after provider callbacks, stand-down, and exhaustion alerts are confirmed working.

---

## 8. Out of Scope for Phase 1

- Email as an acceptance channel
- DTMF or IVR-based acceptance (voice calls are alerting only)
- Multi-building broad rollout on day one
- Responder UI dashboard
- Advanced operator analytics beyond core logging and audit events
- WebSocket or push-based escalation status updates to tenant UI (polling via `risk_summary.escalation_state` is sufficient for Phase 1)

---

## 9. Review Questions

Reviewers should confirm these before implementation starts:

1. Accept that SMS is the only pickup channel in Phase 1 (voice is alerting only).
2. Accept that the retry ceiling defaults to 3 cycles, not 5.
3. Accept adding a mutable `escalation_incidents` store alongside append-only `risk_events`.
4. Accept Twilio as the first and only provider integration.
5. Accept a narrow canary rollout before any broader enablement.
6. Accept that `CONFIRM_EMERGENCY` / `DECLINE_EMERGENCY` are sidecar actions (don't change conversation state, only `escalation_state` session field).
7. Accept Vercel Cron Jobs (60s interval) as the scheduler for the due-incident processor.

---

## 10. Spec Gap Tracker Impact

These gap tracker rows will be affected:

| ID | Current Status | Target Status | Action |
|---|---|---|---|
| S17-02 | PARTIAL | DONE | Wire real plans + coordinator into factory |
| S17-03 | PARTIAL | DONE | Add CONFIRM_EMERGENCY / DECLINE_EMERGENCY handlers |
| S17-04 | PARTIAL | PARTIAL | Routing confirmation gate added (dispatcher guard + `CONFIRM_EMERGENCY`). Mitigation-gating aspect of `requires_confirmation` (suppressing mitigation display until type confirmed) remains a separate concern — tracked but not closed by this plan |
| S02-07 | PARTIAL | DONE | Full deterministic escalation pipeline wired |
| S01-10 | PARTIAL | DONE | Per-building chain with real provider execution |
| S25-01 | MISSING | PARTIAL | Structured logs for escalation (full logging out of scope) |
| S25-04 | MISSING | PARTIAL | Internal alert on exhaustion (full alerting out of scope) |

---

## 11. Exit Criteria

This plan is complete when:

- `CONFIRM_EMERGENCY` and `DECLINE_EMERGENCY` are documented in the spec and transition rules as an explicit sidecar-action exception
- `building_id` is available in trusted runtime scope (UnitResolver → session)
- The factory loads real risk protocols and escalation plans at runtime
- A confirmed emergency creates a durable escalation incident
- The system can place a real phone call, send a real SMS prompt, process a real ACCEPT, and stop escalation
- Contacted responders receive a stand-down SMS after another responder accepts
- Exhausted chains retry deterministically until accepted or max cycles reached
- All attempt, reply, exhaustion, and closure events are preserved in append-only audit data
- Internal alert SMS fires on each cycle exhaustion
- Concurrent ACCEPT is handled safely (CAS, first-writer-wins)
- Overlapping/duplicate cron runs are handled safely (processing lock + per-action idempotency)
- Twilio webhook signatures are validated on all inbound routes
- The feature flag fails closed — `CONFIRM_EMERGENCY` returns an explicit error when `EMERGENCY_ROUTING_ENABLED=false`
- Emergency confirmation quick replies include `action_type` and are dispatched correctly by the client
- Emergency confirmation quick replies are rehydrated on resume/reload when `escalation_state === 'pending_confirmation'`
- Canary validation uses at least two contacts to prove chain advancement and stand-down
- All gap tracker rows listed above are updated

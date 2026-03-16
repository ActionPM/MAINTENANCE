# Emergency Escalation — Operator Runbook

**Last updated:** 2026-03-16

This runbook covers day-to-day operation of the emergency escalation system. For architectural design, see the plan at `docs/plans/2026-03-12-emergency-escalation-runtime-plan.md`. For spec requirements, see `docs/spec.md` §17.

---

## 1. Feature Flag (Kill Switch)

The escalation system is gated by the `EMERGENCY_ROUTING_ENABLED` environment variable.

| Value              | Behavior                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`             | Escalation is live. `CONFIRM_EMERGENCY` creates incidents and triggers voice/SMS workflow.                                                                                                                                  |
| `false` (or unset) | **Fail-closed.** `CONFIRM_EMERGENCY` returns `EMERGENCY_ROUTING_UNAVAILABLE` error with safe 911 message. Cron processor skips all incidents. `startIncident()` throws if called. `DECLINE_EMERGENCY` still works normally. |

**To disable escalation immediately:** Set `EMERGENCY_ROUTING_ENABLED=false` in the Vercel environment and redeploy. In-progress incidents are effectively paused until re-enabled.

---

## 2. Environment Variables

```
EMERGENCY_ROUTING_ENABLED=false          # Feature flag / kill switch
TWILIO_ACCOUNT_SID=...                   # Twilio credentials
TWILIO_AUTH_TOKEN=...                     # Used for webhook signature validation
TWILIO_FROM_NUMBER=+1...                 # Outbound caller ID / SMS sender (E.164)
TWILIO_WEBHOOK_BASE_URL=https://...      # Base URL for Twilio status callbacks
EMERGENCY_INTERNAL_ALERT_NUMBER=+1...    # Internal ops alert SMS recipient (E.164)
EMERGENCY_MAX_CYCLES_DEFAULT=3           # Default retry ceiling
EMERGENCY_CALL_TIMEOUT_SECONDS=60        # Voice call ring timeout
EMERGENCY_SMS_REPLY_TIMEOUT_SECONDS=120  # Time to wait for SMS reply before advancing
CRON_SECRET=...                          # Bearer token for Vercel Cron Job auth
USE_DEMO_UNIT_RESOLVER=false             # Set "true" ONLY for local dev / demos (see §9)
DEMO_BUILDING_ID=example-building-001    # Building ID returned by demo resolver (ignored if flag is off)
```

---

## 3. Configuring a Building Plan

Escalation plans are defined in `packages/schemas/emergency_escalation_plans.json`.

### Adding a new building

Add an entry to the `plans` array:

```json
{
  "plan_id": "plan-unique-id",
  "building_id": "bldg-id-from-unit-resolver",
  "building_name": "123 Main Street",
  "contact_chain": [
    {
      "contact_id": "contact-1",
      "role": "building_manager",
      "name": "Alice Smith",
      "phone": "+15551234567"
    },
    {
      "contact_id": "contact-2",
      "role": "property_manager",
      "name": "Bob Jones",
      "phone": "+15559876543"
    }
  ],
  "exhaustion_behavior": {
    "retry_after_minutes": 5,
    "internal_alert": true,
    "tenant_message": "All emergency contacts have been notified. If you need immediate help, please call 911."
  }
}
```

**Important:**

- `building_id` must match the value returned by `UnitResolver.resolve()` for units in that building.
- Phone numbers must be in E.164 format (e.g., `+15551234567`).
- Use at least 2 contacts per plan to exercise chain advancement and stand-down.
- Shared phone numbers across contacts are handled (deduped per cycle) but unusual.

### Removing a contact

Remove the entry from the `contact_chain` array. Redeploy.

### Changing order

Reorder entries in the `contact_chain` array. The system contacts them top-to-bottom.

---

## 4. How the Escalation Flow Works

1. Tenant sends a message containing emergency keywords.
2. Trigger scanner detects risk. Session enters `escalation_state: 'pending_confirmation'`.
3. Tenant sees confirm/decline quick replies.
4. **Tenant confirms** → `CONFIRM_EMERGENCY` handler:
   - Looks up plan by `building_id`
   - Creates an `EscalationIncident` record
   - Calls the first contact in the chain (voice call)
   - Sets `escalation_state: 'routing'`
5. **Voice call outcome** (Twilio webhook `POST /api/webhooks/twilio/voice-status`):
   - Regardless of answer/no-answer, sends SMS prompt to the contact
6. **SMS reply** (Twilio webhook `POST /api/webhooks/twilio/sms-reply`):
   - `ACCEPT` → incident claimed, stand-down SMS sent to all previously contacted, incident closed
   - `IGNORE` → advance to next contact in chain
7. **Timeout** (Vercel Cron `GET /api/cron/emergency/process-due`, every 60s):
   - If SMS reply timeout exceeded, advance to next contact
   - If chain exhausted, send internal alert, increment cycle, schedule retry
   - If max cycles reached, close incident as `exhausted_final`

---

## 5. Reading Escalation Audit Events

All escalation actions are recorded as append-only risk events. Key event types:

| Event Type                         | Meaning                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `risk_detected`                    | Trigger scanner found emergency keywords                |
| `emergency_confirmation_requested` | Tenant shown confirm/decline prompt                     |
| `emergency_confirmed`              | Tenant confirmed — incident created                     |
| `emergency_declined`               | Tenant declined — no incident                           |
| `escalation_incident_started`      | Incident record created, first contact attempt starting |
| `voice_call_initiated`             | Voice call placed to a contact                          |
| `voice_call_completed`             | Voice call outcome received                             |
| `sms_prompt_sent`                  | SMS prompt sent to contact                              |
| `sms_reply_received`               | Inbound SMS reply received                              |
| `stand_down_sent`                  | Stand-down SMS sent to previously contacted             |
| `cycle_exhausted`                  | All contacts in chain have been tried                   |
| `internal_alert_sent`              | Internal ops alert fired                                |
| `escalation_incident_closed`       | Incident resolved (accepted or exhausted)               |

### Querying events

Events are stored in the conversation event log. Filter by `event_type` starting with `escalation_` or `emergency_` or `risk_` or `voice_` or `sms_` or `stand_down` or `cycle_` or `internal_alert`.

---

## 6. Structured Logs

The coordinator emits structured JSON logs to stdout with `component: 'escalation_coordinator'`. Key log events:

- `incident_started` — new incident created
- `call_placed` / `call_failed` — voice call outcome
- `sms_prompt_sent` / `sms_prompt_failed` — SMS delivery
- `reply_received` — inbound SMS
- `incident_claimed` — ACCEPT processed
- `accept_cas_conflict` — concurrent ACCEPT, second writer lost
- `cycle_exhausted` — chain exhausted
- `internal_alert_sent` / `internal_alert_failed` — ops alert
- `process_due_start` / `process_due_skipped` — cron run

All log entries include `ts` (ISO 8601), `incident_id`, and `conversation_id` where applicable.

---

## 7. Cron Job

The due-incident processor runs via Vercel Cron Job:

- **Route:** `GET /api/cron/emergency/process-due`
- **Schedule:** Every 60 seconds (`* * * * *`)
- **Config:** `apps/web/vercel.json`
- **Auth:** `Authorization: Bearer ${CRON_SECRET}`
- **Behavior when flag off:** Returns `{ skipped: true }` immediately.

### Overlap safety

- Each incident is CAS-locked before processing (`processing_lock_until`).
- If a previous cron run crashed, the lock expires after 90 seconds.
- Provider actions are tagged with idempotency keys to prevent duplicate calls/SMS.

---

## 8. Safety Guards (added 2026-03-16)

### Self-call prevention

The system prevents Twilio from calling or texting its own outbound number. This is enforced at **three layers**:

1. **SMS provider** (`twilio-sms.ts`): Normalizes both numbers and throws before calling the Twilio API if `To == From`.
2. **Voice provider** (`twilio-voice.ts`): Same guard for `placeCall()`.
3. **Escalation coordinator**: Skips any contact whose phone matches `outboundFromNumber`, advances to the next contact in the chain, and logs a structured `self_target_skipped` event. Also skips internal alert SMS when the internal alert number matches the outbound sender.

Phone normalization strips formatting differences (e.g., `+1 (555) 111-1111` vs `+15551111111`), so mismatched formats cannot bypass the guard.

**If you see `self_target_skipped` in logs**, it means a contact in an escalation plan has the same phone number as `TWILIO_FROM_NUMBER`. Update the plan to use a different number for that contact.

### Webhook signature validation

Both Twilio webhook routes validate the `x-twilio-signature` header using HMAC-SHA1 with constant-time comparison:

- **SMS reply route** (`POST /api/webhooks/twilio/sms-reply`): Returns 403 if signature is invalid.
- **Voice status route** (`POST /api/webhooks/twilio/voice-status`): Returns 403 if signature is invalid.
- Both return 500 if `TWILIO_AUTH_TOKEN` is not set.

The signature is computed per the Twilio spec: HMAC-SHA1 of `URL + sorted(key+value)` using the auth token as the key.

### Row-version (CAS) propagation

The escalation coordinator uses optimistic concurrency control (compare-and-swap) on incident records. As of 2026-03-16, recursive calls within `attemptContact()` and `handleCycleExhaustion()` correctly propagate `row_version + 1` after each successful CAS update. This prevents silent locking failures on rapid-fire escalation chains.

**No operator action required** — this was a code-level fix with no configuration changes.

---

## 9. Demo Resolver Isolation (added 2026-03-16)

The `UnitResolver` — which maps a tenant's selected unit to a `building_id` for escalation plan lookup — has a stub implementation for local dev and demos.

| `USE_DEMO_UNIT_RESOLVER` | Behavior                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `true`                   | Stub active: maps any `unit_id` to `{ building_id: DEMO_BUILDING_ID, property_id: 'demo-property-001' }` |
| `false` or absent        | **Fail-closed**: returns `null` for all units. `SELECT_UNIT` will reject with `UNIT_NOT_FOUND`.          |

**Production must never set `USE_DEMO_UNIT_RESOLVER=true`.** The stub bypasses real unit-to-building resolution and would route all tenants to the same escalation plan.

If `DEMO_BUILDING_ID` is not set when the flag is on, it defaults to `example-building-001` and logs a warning if no matching escalation plan exists.

---

## 10. Troubleshooting

### Escalation not starting

1. Check `EMERGENCY_ROUTING_ENABLED=true`.
2. Check that the building has a plan in `emergency_escalation_plans.json`.
3. Check that `building_id` on the session matches a plan's `building_id`.
4. Check logs for `start_rejected` or `BUILDING_ID_MISSING` errors.

### Calls not being placed

1. Check Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`).
2. Check `TWILIO_WEBHOOK_BASE_URL` points to the correct deployment URL.
3. Check logs for `call_failed` entries.

### SMS replies not being processed

1. Verify Twilio's inbound SMS webhook is configured to `POST /api/webhooks/twilio/sms-reply`.
2. Check that the Twilio signature validation is passing (valid auth token configured).
3. Check logs for `reply_received` entries.

### Cron not processing due incidents

1. Check `CRON_SECRET` matches the Vercel Cron configuration.
2. Check `EMERGENCY_ROUTING_ENABLED=true`.
3. Check Vercel Cron dashboard for execution history.
4. Check logs for `process_due_start` / `process_due_skipped`.

### Incident stuck in active state

If an incident appears stuck:

1. Check if `processing_lock_until` is in the future (a cron run may be in progress or crashed).
2. The lock expires after 90 seconds. The next cron run will pick it up.
3. Check for `accept_cas_conflict` logs indicating concurrent processing.

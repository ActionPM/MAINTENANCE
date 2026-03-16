# Emergency Escalation Regression Pass — 2026-03-16

**Branch:** `fix/twilio-emergency-safeguards`
**Commits under test:**

| SHA       | Summary                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| `ddcc28b` | fix(emergency): prevent Twilio self-calls and fix escalation row-version bugs |
| `c1cfa31` | style: fix Prettier formatting in 3 Twilio files                              |
| `b6b2955` | fix(factory): isolate demo UnitResolver behind USE_DEMO_UNIT_RESOLVER flag    |

**Suite baseline:** 172 test files, 0 failures (schemas 11, core 119, mock-erp 1, db 9, evals 8, web 24)

---

## 1. Self-Call Prevention (Voice + SMS)

**What changed:** Twilio SMS and voice providers now normalize phone numbers and throw before calling the Twilio API when `To == From`. The escalation coordinator independently skips contacts matching `outboundFromNumber` and logs a structured skip event.

**Defense layers:**

| Layer                        | File                                                       | Mechanism                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Provider (SMS)               | `apps/web/src/lib/emergency/twilio-sms.ts:21-23`           | `normalizePhoneNumber(to) === normalizePhoneNumber(from)` guard, throws before `fetch()`                                          |
| Provider (Voice)             | `apps/web/src/lib/emergency/twilio-voice.ts:26-30`         | Same guard for `placeCall()`                                                                                                      |
| Coordinator                  | `packages/core/src/risk/escalation-coordinator.ts:283-314` | `samePhoneNumber(contact.phone, config.outboundFromNumber)` — skips contact, increments `current_contact_index`, recurses to next |
| Coordinator (internal alert) | `packages/core/src/risk/escalation-coordinator.ts:867-878` | Skips internal alert SMS when `internalAlertNumber == outboundFromNumber`                                                         |

**Tests (all pass):**

| Test                                                                      | File                                                              | Assertion                                       |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `rejects self-targeted SMS before calling Twilio`                         | `apps/web/src/lib/__tests__/twilio-providers.test.ts:10`          | Throws, `fetch` never called                    |
| `rejects self-targeted calls before calling Twilio`                       | `apps/web/src/lib/__tests__/twilio-providers.test.ts:25`          | Throws, `fetch` never called                    |
| `skips a contact whose phone matches the outbound sender number`          | `packages/core/src/__tests__/risk/escalation-coordinator.test.ts` | Contact skipped, next contact receives call+SMS |
| `skips the internal alert SMS when it matches the outbound sender number` | `packages/core/src/__tests__/risk/escalation-coordinator.test.ts` | No SMS sent to internal alert number            |

**Phone normalization coverage:** Tests use mismatched formats (`+15551111111` vs `+1 (555) 111-1111`) to confirm normalization handles stripped formatting.

---

## 2. Row-Version (CAS) Propagation Fixes

**What changed:** Recursive `attemptContact()` calls and `handleCycleExhaustion()` now correctly propagate `row_version + 1` after successful CAS updates, preventing silent optimistic-locking failures on rapid-fire escalation chains.

**Fix locations:**

| Site                        | Lines                           | Before                                 | After                                                                            |
| --------------------------- | ------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| Phone-dedupe skip recurse   | `escalation-coordinator.ts:333` | `attemptContact(advanced, ...)`        | `attemptContact({...advanced, row_version: incident.row_version + 1}, ...)`      |
| Self-target skip recurse    | `escalation-coordinator.ts:305` | (new code)                             | Same pattern                                                                     |
| Post-contact update return  | `escalation-coordinator.ts:460` | `return updated` (inside error branch) | `return {...updated, row_version: incident.row_version + 1}`                     |
| processDue cycle exhaustion | `escalation-coordinator.ts:743` | `handleCycleExhaustion(locked, ...)`   | `handleCycleExhaustion({...locked, row_version: incident.row_version + 1}, ...)` |

**Tests (all pass):**

| Test                                                                                       | Assertion                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `second ACCEPT is rejected by CAS`                                                         | CAS rejects concurrent accept — only first responder wins |
| `moves an overdue incident to exhausted_retrying after chain exhaustion`                   | processDue correctly transitions through CAS chain        |
| `moves an overdue incident to exhausted_final when max cycles are exhausted`               | Terminal state reached without CAS conflict               |
| `second startIncident for same conversation returns existing incident without extra calls` | Idempotent — no extra voice/SMS on duplicate              |

---

## 3. Signed Webhook Validation

**What changed:** Both Twilio webhook routes (SMS reply, voice status) validate the `x-twilio-signature` header using HMAC-SHA1 with constant-time comparison.

**Implementation:** `apps/web/src/lib/emergency/twilio-signature.ts`

| Property           | Evidence                                                           |
| ------------------ | ------------------------------------------------------------------ |
| Algorithm          | HMAC-SHA1 of `URL + sorted(key+value)` per Twilio spec             |
| Timing-safe        | Constant-time comparison via XOR accumulator (line 28-31)          |
| SMS reply route    | Validates at `sms-reply/route.ts:73-76`, returns 403 on failure    |
| Voice status route | Validates at `voice-status/route.ts:30-34`, returns 403 on failure |
| Auth token source  | `process.env.TWILIO_AUTH_TOKEN` — returns 500 if missing           |

**Tests (all pass):**

| Test                                             | File                         | Assertion                                                          |
| ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------ |
| `returns true for a valid signature`             | `twilio-signature.test.ts`   | HMAC-SHA1 round-trip with known token/URL/params                   |
| `returns false for a tampered signature`         | `twilio-signature.test.ts`   | Bad signature rejected                                             |
| `returns false when params are tampered`         | `twilio-signature.test.ts`   | Correct signature, tampered params → false                         |
| `returns false when URL is tampered`             | `twilio-signature.test.ts`   | Correct signature, wrong URL → false                               |
| `sorts params by key for signature computation`  | `twilio-signature.test.ts`   | Key insertion order does not affect result                         |
| `returns 403 when Twilio signature is invalid`   | `sms-reply-route.test.ts`    | SMS route rejects with 403, `processReplyForIncident` never called |
| `returns 500 when TWILIO_AUTH_TOKEN is not set`  | `sms-reply-route.test.ts`    | SMS route rejects before signature check                           |
| `returns confirmation TwiML when ACCEPT...`      | `sms-reply-route.test.ts`    | Full ACCEPT flow with valid signature                              |
| `returns 403 when Twilio signature is invalid`   | `voice-status-route.test.ts` | Voice route rejects with 403, `processCallOutcome` never called    |
| `returns 500 when TWILIO_AUTH_TOKEN is not set`  | `voice-status-route.test.ts` | Voice route rejects before signature check                         |
| `calls processCallOutcome and returns 200 TwiML` | `voice-status-route.test.ts` | Full happy-path: valid sig → processCallOutcome → 200 TwiML        |
| `returns empty TwiML when incidentId is missing` | `voice-status-route.test.ts` | Missing query param → graceful 200 with empty TwiML                |

---

## 4. Demo Resolver Isolation

**What changed:** The stub `UnitResolver` (which returns hardcoded `building_id` for every unit) is now gated behind `USE_DEMO_UNIT_RESOLVER=true`. Without the flag, the resolver fails closed (returns `null` → `UNIT_NOT_FOUND`).

| Env var                               | Behavior                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `USE_DEMO_UNIT_RESOLVER=true`         | Stub active: maps any `unit_id` → `{ building_id: DEMO_BUILDING_ID, property_id: 'demo-property-001' }` |
| `USE_DEMO_UNIT_RESOLVER` absent/false | Fail-closed: returns `null` for all units                                                               |
| `DEMO_BUILDING_ID`                    | Configures stub's building_id (default: `example-building-001`); warns if no matching escalation plan   |

**File:** `apps/web/src/lib/orchestrator-factory.ts` — `createUnitResolver()` function (exported for testing)

**Tests (all pass):**

| Test                                                       | File                            | Assertion                                             |
| ---------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| `returns null when USE_DEMO_UNIT_RESOLVER is not set`      | `unit-resolver-factory.test.ts` | Fail-closed: every unit → `null`                      |
| `returns null when USE_DEMO_UNIT_RESOLVER is "false"`      | `unit-resolver-factory.test.ts` | Explicit false → same fail-closed behavior            |
| `returns demo scope when USE_DEMO_UNIT_RESOLVER is "true"` | `unit-resolver-factory.test.ts` | Stub returns `{ building_id: DEMO_BUILDING_ID, ... }` |
| `defaults building_id to example-building-001`             | `unit-resolver-factory.test.ts` | Absent `DEMO_BUILDING_ID` → default + console.warn    |

---

## 5. End-to-End Emergency Flow

The full path from risk detection through escalation is covered by layered tests across packages:

| Stage                                   | Test file                        | Count  | Key assertions                                                                                               |
| --------------------------------------- | -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| **Risk scan** (text triggers)           | `trigger-scanner.test.ts`        | 7      | Keywords, regex, multi-word, severity ranking                                                                |
| **Risk scan** (classification triggers) | `trigger-scanner.test.ts`        | 3      | Taxonomy path matching                                                                                       |
| **Risk → session**                      | `session-risk.test.ts`           | 3      | `risk_triggers` stored, `escalation_state` transitions                                                       |
| **Risk → submit handler**               | `submit-risk-scan.test.ts`       | 6      | Mitigation rendered, events recorded, confirmation quick-replies, suppression for `requires_confirmation`    |
| **Risk → WO flags**                     | `wo-risk-flags.test.ts`          | 2      | `risk_flags` populated on created work orders                                                                |
| **Risk → response**                     | `response-risk.test.ts`          | 2      | `risk_summary` in conversation snapshot                                                                      |
| **Risk → integration**                  | `risk-integration.test.ts`       | 3      | Full orchestrator flow: emergency keyword → mitigation → WO flags                                            |
| **Emergency router**                    | `emergency-router.test.ts`       | 6      | Chain iteration, exhaustion, error tolerance                                                                 |
| **Escalation coordinator**              | `escalation-coordinator.test.ts` | 16     | startIncident, processCallOutcome, ACCEPT idempotency, processDue, self-target skip, ref codes, webhook URLs |
| **Mitigation**                          | `mitigation.test.ts`             | 4      | Template resolution, message rendering                                                                       |
| **Event builder**                       | `event-builder.test.ts`          | 4      | Append-only risk events                                                                                      |
| **Barrel export**                       | `barrel-export.test.ts`          | 1      | All risk exports present                                                                                     |
| **SMS reply route**                     | `sms-reply-route.test.ts`        | 1      | ACCEPT → confirmation TwiML                                                                                  |
| **Form decode + parseReply**            | `form-decode.test.ts`            | 12     | URL decoding, `+` as space, ACCEPT/IGNORE parsing, ref codes                                                 |
| **Twilio providers**                    | `twilio-providers.test.ts`       | 2      | Self-call rejection (SMS + voice)                                                                            |
| **Twilio signature**                    | `twilio-signature.test.ts`       | 5      | HMAC-SHA1 validation, tamper detection, key sort                                                             |
| **Voice status route**                  | `voice-status-route.test.ts`     | 4      | 403 rejection, 500 no token, happy path, missing incidentId                                                  |
| **Unit resolver factory**               | `unit-resolver-factory.test.ts`  | 4      | Flag on/off/absent, default building_id                                                                      |
| **Total**                               |                                  | **87** |                                                                                                              |

---

## 6. Summary

| Area                    | Status   | Tests | Gaps |
| ----------------------- | -------- | ----- | ---- |
| Self-call prevention    | **Pass** | 4     | None |
| Row-version CAS         | **Pass** | 4     | None |
| Signed webhooks         | **Pass** | 12    | None |
| Demo resolver isolation | **Pass** | 4     | None |
| End-to-end flow         | **Pass** | 87    | None |

**Overall:** All 172 test files pass (24 web, 119 core, 11 schemas, 9 db, 8 evals, 1 mock-erp). The emergency path has 87 dedicated tests covering risk detection through escalation, webhook signature validation, and demo resolver isolation.

**Open item:** Live shared-environment validation (Vercel preview deployment with real Twilio credentials) has not yet been performed. The above results are from automated unit/integration tests with mocked providers. A live staging pass should be completed and logged as an appendix before final close-out.

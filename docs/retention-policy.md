# Retention Policy

## Event Store

- **Retention**: All events are retained indefinitely in the append-only event store.
- **Immutability**: Events are never updated or deleted. Corrections are appended as new events with reason codes.
- **Event domains**: `conversation_events`, `classification_events`, `followup_events`, `work_order_events`, `risk_events`, `notification_events`, `human_override_events`.
- **Rationale**: Append-only retention supports audit trails, trend analysis, and regulatory compliance. The event log is the system of record for what happened and when.

## Conversation Sessions

- **Active sessions**: Retained while the conversation is in progress.
- **Abandoned/expired sessions**: Transition to `intake_abandoned` (explicit) or `intake_expired` (timeout). Session data is retained for audit but not resumable after expiration.
- **Staleness**: Unseen artifacts expire after 60 minutes. Seen artifacts become stale based on source hash changes, split hash changes, or age + borderline confidence.

## Work Orders

- **Retention**: Work orders are retained indefinitely. Status transitions are tracked in `status_history`.
- **Lifecycle**: `created → action_required → scheduled → resolved | cancelled`. Terminal states are permanent.
- **Idempotency records**: Retained to prevent duplicate WO creation on retried requests.

## Personal Data

- **Tenant identity**: `tenant_user_id` is the primary identifier. Derived from JWT claims.
- **Contact information**: Phone numbers used for SMS notifications and emergency escalation are stored in escalation incident records and notification logs.
- **Message content**: Tenant messages are stored in conversation events. These may contain personal information disclosed by the tenant during intake.
- **Photos**: Draft photo IDs are tracked per conversation. Full photo storage pipeline is deferred past MVP (spec §19).

## Escalation Incidents

- **Retention**: All escalation incidents (contact attempts, acknowledgements, stand-downs, exhaustion events) are retained as append-only records.
- **Contact chain logs**: Each contact attempt is logged with timestamp, method, and outcome.
- **Rationale**: Emergency escalation audit trails are critical for safety compliance.

## Metrics and Observability

- **Runtime metrics**: Stored in Postgres-backed metrics store. Retained for operational analysis.
- **Structured logs**: Emitted to stdout as JSON. Retention depends on the log aggregation infrastructure (not managed by this application).
- **Alert history**: Alert evaluations and delivery records are retained in the metrics store.

## Future Considerations

- PII redaction or anonymization policy for long-term retention will be defined as part of the compliance framework expansion.
- Jurisdiction-specific retention requirements (e.g., RentSafeTO record-keeping) will be layered onto this baseline policy.
- Data export and deletion requests (GDPR/PIPEDA right-to-erasure) will require a separate implementation plan since the append-only model does not support physical deletion by design.

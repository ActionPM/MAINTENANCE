import type {
  EscalationIncident,
  EscalationPlan,
  EscalationPlans,
  EscalationIncidentStatus,
  EscalationAttemptOutcome,
  EscalationContactAttempt,
} from '@wo-agent/schemas';
import type { EscalationIncidentStore } from './escalation-incident-store.js';
import type { VoiceCallProvider, SmsProvider } from './provider-types.js';
import type { RiskEvent } from './event-builder.js';
import type {
  Logger,
  MetricsRecorder,
  AlertSink,
  ObservabilityContext,
} from '../observability/types.js';
import {
  buildIncidentStartedEvent,
  buildVoiceCallInitiatedEvent,
  buildVoiceCallCompletedEvent,
  buildSmsPromptSentEvent,
  buildSmsReplyReceivedEvent,
  buildStandDownSentEvent,
  buildCycleExhaustedEvent,
  buildInternalAlertSentEvent,
  buildIncidentClosedEvent,
} from './event-builder.js';

// --- Structured logging via shared Logger interface ---

/**
 * Module-level logger reference. Set by deps when provided.
 * Falls back to console.log JSON for backward compatibility.
 */
let _logger: Logger | undefined;

function log(entry: {
  readonly component: 'escalation_coordinator';
  readonly event: string;
  readonly request_id?: string;
  readonly [key: string]: unknown;
}): void {
  const timestamp = new Date().toISOString();
  if (_logger) {
    _logger.log({ ...entry, severity: 'info', timestamp });
  } else {
    console.log(JSON.stringify({ ...entry, ts: timestamp }));
  }
}

/** Configuration for the escalation coordinator. */
export interface EscalationCoordinatorConfig {
  readonly maxCyclesDefault: number;
  readonly callTimeoutSeconds: number;
  readonly smsReplyTimeoutSeconds: number;
  readonly outboundFromNumber: string;
  readonly internalAlertNumber: string;
  readonly webhookBaseUrl: string;
  readonly emergencyRoutingEnabled: boolean;
  readonly processingLockDurationMs: number;
}

export const DEFAULT_COORDINATOR_CONFIG: EscalationCoordinatorConfig = {
  maxCyclesDefault: 3,
  callTimeoutSeconds: 60,
  smsReplyTimeoutSeconds: 120,
  outboundFromNumber: '',
  internalAlertNumber: '',
  webhookBaseUrl: '',
  emergencyRoutingEnabled: false,
  processingLockDurationMs: 90_000,
};

/** Dependencies injected into the coordinator. */
export interface EscalationCoordinatorDeps {
  readonly incidentStore: EscalationIncidentStore;
  readonly voiceProvider: VoiceCallProvider;
  readonly smsProvider: SmsProvider;
  readonly config: EscalationCoordinatorConfig;
  readonly idGenerator: () => string;
  readonly clock: () => string;
  /** Callback to persist risk events (append-only). */
  readonly writeRiskEvent: (event: RiskEvent) => Promise<void>;
  readonly logger?: Logger;
  readonly metricsRecorder?: MetricsRecorder;
  readonly alertSink?: AlertSink;
}

// --- Suggested copy templates (plan §3.7) ---

function voiceScript(buildingName: string): string {
  return `<Response><Say>There is an active building emergency at ${buildingName}. You are next in the emergency response chain because this incident has not yet been accepted. Details have been sent by text. Reply ACCEPT to take ownership or IGNORE to pass. If no one accepts, escalation will continue.</Say></Response>`;
}

export function incidentRef(incidentId: string): string {
  return incidentId.slice(0, 8);
}

function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function samePhoneNumber(left: string, right: string): boolean {
  const normalizedLeft = normalizePhoneNumber(left);
  const normalizedRight = normalizePhoneNumber(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

function smsPrompt(buildingName: string, summary: string, incidentId: string): string {
  const ref = incidentRef(incidentId);
  return `Emergency at ${buildingName}. Ref: ${ref}. Reply ACCEPT ${ref} or IGNORE ${ref}. Incident: ${summary}.`;
}

function standDownSms(buildingName: string, acceptorName: string): string {
  return `Emergency at ${buildingName} has been accepted by ${acceptorName}. Please disregard earlier calls or texts for this incident.`;
}

function internalAlertSms(
  buildingName: string,
  cycleNumber: number,
  maxCycles: number,
  incidentId: string,
): string {
  return `ALERT: Emergency escalation at ${buildingName} exhausted cycle ${cycleNumber}/${maxCycles}. No responder has accepted. Incident: ${incidentId}.`;
}

// --- Helper: dedupe phone numbers in a plan's contact chain ---

function _dedupePhones(plan: EscalationPlan): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const contact of plan.contact_chain) {
    if (!seen.has(contact.phone)) {
      seen.add(contact.phone);
      result.push(contact.phone);
    }
  }
  return result;
}

// --- Helper: compute next_action_at offset ---

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return addSeconds(iso, minutes * 60);
}

function buildWebhookUrl(baseUrl: string, pathAndQuery: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${pathAndQuery}`;
}

// --- 4.1: startIncident ---

export interface StartIncidentInput {
  readonly conversationId: string;
  readonly buildingId: string;
  readonly escalationPlans: EscalationPlans;
  readonly summary: string;
}

export async function startIncident(
  input: StartIncidentInput,
  deps: EscalationCoordinatorDeps,
  _ctx?: ObservabilityContext,
): Promise<EscalationIncident> {
  _logger = deps.logger;
  if (!deps.config.emergencyRoutingEnabled) {
    log({
      component: 'escalation_coordinator',
      event: 'start_rejected',
      detail: 'routing_disabled',
      conversation_id: input.conversationId,
    });
    throw new Error('Emergency routing is disabled');
  }

  const plan = input.escalationPlans.plans.find((p) => p.building_id === input.buildingId);
  if (!plan) {
    // Write audit event for missing plan
    await deps.writeRiskEvent({
      event_id: deps.idGenerator(),
      conversation_id: input.conversationId,
      event_type: 'escalation_incident_closed',
      payload: { reason: 'no_plan_for_building', building_id: input.buildingId },
      created_at: deps.clock(),
    });
    throw new Error(`No escalation plan found for building: ${input.buildingId}`);
  }

  const now = deps.clock();
  const incidentId = deps.idGenerator();
  const maxCycles = deps.config.maxCyclesDefault;

  const incident: EscalationIncident = {
    incident_id: incidentId,
    conversation_id: input.conversationId,
    building_id: input.buildingId,
    plan_id: plan.plan_id,
    summary: input.summary,
    status: 'active',
    cycle_number: 1,
    max_cycles: maxCycles,
    current_contact_index: 0,
    next_action_at: now, // immediately start
    processing_lock_until: null,
    last_provider_action: null,
    accepted_by_phone: null,
    accepted_by_contact_id: null,
    accepted_at: null,
    contacted_phone_numbers: [],
    internal_alert_sent_cycles: [],
    attempts: [],
    row_version: 0,
    created_at: now,
    updated_at: now,
  };

  const created = await deps.incidentStore.create(incident);

  if (!created) {
    // Unique constraint: another active incident already exists for this conversation.
    // Return the existing one — this is the atomic duplicate-prevention path.
    const existing = await deps.incidentStore.getActiveByConversation(input.conversationId);
    if (existing) {
      log({
        component: 'escalation_coordinator',
        event: 'duplicate_prevented',
        incident_id: existing.incident_id,
        conversation_id: input.conversationId,
        detail: 'concurrent create blocked by one-active-per-conversation constraint',
      });
      return existing;
    }
    // Should not reach here, but if it does, throw rather than silently proceeding
    throw new Error('Failed to create incident and no existing active incident found');
  }

  log({
    component: 'escalation_coordinator',
    event: 'incident_started',
    incident_id: incidentId,
    conversation_id: input.conversationId,
    detail: `plan=${plan.plan_id} building=${input.buildingId} max_cycles=${maxCycles}`,
  });

  await deps.writeRiskEvent(
    buildIncidentStartedEvent({
      eventId: deps.idGenerator(),
      conversationId: input.conversationId,
      incidentId,
      planId: plan.plan_id,
      buildingId: input.buildingId,
      maxCycles,
      createdAt: now,
    }),
  );

  // Initiate first contact attempt
  return attemptContact(incident, plan, input.summary, deps);
}

// --- Internal: attempt contact at current_contact_index ---

async function attemptContact(
  incident: EscalationIncident,
  plan: EscalationPlan,
  summary: string,
  deps: EscalationCoordinatorDeps,
): Promise<EscalationIncident> {
  const contact = plan.contact_chain[incident.current_contact_index];
  if (!contact) {
    // Chain exhausted for this cycle
    return handleCycleExhaustion(incident, plan, summary, deps);
  }

  if (samePhoneNumber(contact.phone, deps.config.outboundFromNumber)) {
    const advanced: EscalationIncident = {
      ...incident,
      current_contact_index: incident.current_contact_index + 1,
      updated_at: deps.clock(),
    };
    const skippedSaved = await deps.incidentStore.update(advanced, incident.row_version);
    if (!skippedSaved) {
      log({
        component: 'escalation_coordinator',
        event: 'cas_conflict',
        incident_id: incident.incident_id,
        detail: 'self-target skip update lost - concurrent modification',
      });
      return incident;
    }
    log({
      component: 'escalation_coordinator',
      event: 'contact_skipped_invalid_self_target',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      contact_id: contact.contact_id,
      phone: contact.phone,
      detail: 'contact matches outbound sender number',
    });
    return attemptContact(
      { ...advanced, row_version: incident.row_version + 1 },
      plan,
      summary,
      deps,
    );
  }

  // Phone number dedupe: skip if already contacted in this cycle
  if (incident.contacted_phone_numbers.includes(contact.phone)) {
    const advanced: EscalationIncident = {
      ...incident,
      current_contact_index: incident.current_contact_index + 1,
      updated_at: deps.clock(),
    };
    const dedupeSaved = await deps.incidentStore.update(advanced, incident.row_version);
    if (!dedupeSaved) {
      log({
        component: 'escalation_coordinator',
        event: 'cas_conflict',
        incident_id: incident.incident_id,
        detail: 'dedupe skip update lost — concurrent modification',
      });
      return incident;
    }
    return attemptContact(
      { ...advanced, row_version: incident.row_version + 1 },
      plan,
      summary,
      deps,
    );
  }

  // Build idempotency tag
  const actionTag = `call:${contact.contact_id}:cycle-${incident.cycle_number}`;
  if (incident.last_provider_action === actionTag) {
    // Already sent by an earlier overlapping run — skip
    return incident;
  }

  const now = deps.clock();
  const buildingName = plan.building_id;

  // Place voice call
  const twiml = voiceScript(buildingName);
  const statusCallbackUrl = buildWebhookUrl(
    deps.config.webhookBaseUrl,
    `/api/webhooks/twilio/voice-status?incidentId=${encodeURIComponent(incident.incident_id)}&contactIndex=${incident.current_contact_index}`,
  );

  let callSid: string | undefined;
  try {
    const result = await deps.voiceProvider.placeCall(contact.phone, twiml, statusCallbackUrl);
    callSid = result.callSid;
    log({
      component: 'escalation_coordinator',
      event: 'call_placed',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      contact_id: contact.contact_id,
      phone: contact.phone,
      cycle_number: incident.cycle_number,
      detail: `callSid=${callSid}`,
    });
  } catch {
    log({
      component: 'escalation_coordinator',
      event: 'call_failed',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      contact_id: contact.contact_id,
      phone: contact.phone,
      cycle_number: incident.cycle_number,
      detail: 'proceeding to SMS fallback',
    });
    callSid = undefined;
  }

  await deps.writeRiskEvent(
    buildVoiceCallInitiatedEvent({
      eventId: deps.idGenerator(),
      conversationId: incident.conversation_id,
      incidentId: incident.incident_id,
      contactId: contact.contact_id,
      phone: contact.phone,
      cycleNumber: incident.cycle_number,
      callSid,
      createdAt: now,
    }),
  );

  // Send SMS immediately after voice call — SMS is the actionable channel
  // (ACCEPT/IGNORE). Do not defer to processCallOutcome, which depends on the
  // Twilio voice callback arriving. If the callback never fires, SMS must still
  // be sent.
  const smsActionTag = `sms:${contact.contact_id}:cycle-${incident.cycle_number}`;
  const smsBody = smsPrompt(buildingName, summary, incident.incident_id);
  let messageSid: string | undefined;
  try {
    const smsResult = await deps.smsProvider.sendSms(contact.phone, smsBody);
    messageSid = smsResult.messageSid;
    log({
      component: 'escalation_coordinator',
      event: 'sms_prompt_sent',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      contact_id: contact.contact_id,
      phone: contact.phone,
      detail: `messageSid=${messageSid}`,
    });
  } catch {
    log({
      component: 'escalation_coordinator',
      event: 'sms_prompt_failed',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      contact_id: contact.contact_id,
      phone: contact.phone,
    });
    messageSid = undefined;
  }

  await deps.writeRiskEvent(
    buildSmsPromptSentEvent({
      eventId: deps.idGenerator(),
      conversationId: incident.conversation_id,
      incidentId: incident.incident_id,
      contactId: contact.contact_id,
      phone: contact.phone,
      messageSid,
      createdAt: now,
    }),
  );

  // Update incident state — set next_action_at to SMS reply timeout since
  // SMS is now sent inline, not deferred to processCallOutcome.
  const updated: EscalationIncident = {
    ...incident,
    contacted_phone_numbers: [...incident.contacted_phone_numbers, contact.phone],
    last_provider_action: smsActionTag,
    next_action_at: addSeconds(now, deps.config.smsReplyTimeoutSeconds),
    updated_at: now,
  };

  const saved = await deps.incidentStore.update(updated, incident.row_version);
  if (!saved) {
    log({
      component: 'escalation_coordinator',
      event: 'cas_conflict',
      incident_id: incident.incident_id,
      detail: 'attemptContact update lost — concurrent modification',
    });
    return updated;
  }
  return { ...updated, row_version: incident.row_version + 1 };
}

// --- 4.2: processCallOutcome ---

export interface CallOutcomeInput {
  readonly incidentId: string;
  readonly callSid: string;
  readonly callStatus: string; // Twilio status: 'completed' | 'no-answer' | 'busy' | 'failed'
  readonly escalationPlans: EscalationPlans;
  /** The contact_chain index at the time the call was placed. Passed in the
   *  callback URL so the outcome is attributed to the correct contact even if
   *  the chain has since advanced (IGNORE or cron timeout). */
  readonly contactIndex?: number;
}

export async function processCallOutcome(
  input: CallOutcomeInput,
  deps: EscalationCoordinatorDeps,
  _ctx?: ObservabilityContext,
): Promise<void> {
  _logger = deps.logger;
  const incident = await deps.incidentStore.getById(input.incidentId);
  if (!incident || (incident.status !== 'active' && incident.status !== 'exhausted_retrying'))
    return;

  const plan = input.escalationPlans.plans.find((p) => p.plan_id === incident.plan_id);
  if (!plan) return;

  // Use the contact index from the callback URL (set at call-time) to attribute
  // the outcome to the correct contact, even if the chain has since advanced.
  const idx = input.contactIndex ?? incident.current_contact_index;
  const contact = plan.contact_chain[idx];
  if (!contact) return;

  const now = deps.clock();
  let outcome: EscalationAttemptOutcome;

  if (input.callStatus === 'completed') {
    outcome = 'call_answered';
  } else if (input.callStatus === 'no-answer' || input.callStatus === 'busy') {
    outcome = 'call_no_answer';
  } else {
    outcome = 'call_failed';
  }

  const attempt: EscalationContactAttempt = {
    contact_id: contact.contact_id,
    phone: contact.phone,
    cycle_number: incident.cycle_number,
    outcome,
    provider_sid: input.callSid,
    attempted_at: now,
    completed_at: now,
  };

  await deps.writeRiskEvent(
    buildVoiceCallCompletedEvent({
      eventId: deps.idGenerator(),
      conversationId: incident.conversation_id,
      incidentId: incident.incident_id,
      contactId: contact.contact_id,
      outcome,
      callSid: input.callSid,
      createdAt: now,
    }),
  );

  // SMS is now sent inline in attemptContact(), so processCallOutcome only
  // records the voice outcome and attempt. No SMS sending needed here.

  const updated: EscalationIncident = {
    ...incident,
    attempts: [...incident.attempts, attempt],
    updated_at: now,
  };

  const saved = await deps.incidentStore.update(updated, incident.row_version);
  if (!saved) {
    log({
      component: 'escalation_coordinator',
      event: 'cas_conflict',
      incident_id: incident.incident_id,
      detail: 'processCallOutcome update lost — concurrent modification',
    });
  }
}

// --- 4.3: processReply ---

export interface SmsReplyInput {
  readonly fromPhone: string;
  readonly body: string;
  readonly escalationPlans: EscalationPlans;
}

export async function processReply(
  input: SmsReplyInput,
  deps: EscalationCoordinatorDeps,
): Promise<void> {
  // Find active incident that contacted this phone number
  // In production, we'd look up by phone → incident mapping.
  // For now, scan all active incidents.
  const _reply = input.body.trim().toUpperCase();
  const _now = deps.clock();

  // This is a simplified lookup — production would use an index.
  // For the coordinator, we assume the caller resolves the incident.
  // Leaving as no-op here — the webhook route will look up the incident and call this.
}

export interface ProcessReplyForIncidentInput {
  readonly incident: EscalationIncident;
  readonly fromPhone: string;
  readonly reply: 'ACCEPT' | 'IGNORE' | 'unknown';
  readonly rawBody: string;
  readonly escalationPlans: EscalationPlans;
  readonly summary: string;
}

export async function processReplyForIncident(
  input: ProcessReplyForIncidentInput,
  deps: EscalationCoordinatorDeps,
  _ctx?: ObservabilityContext,
): Promise<void> {
  _logger = deps.logger;
  const { incident, fromPhone, reply, rawBody, escalationPlans, summary } = input;
  const now = deps.clock();

  log({
    component: 'escalation_coordinator',
    event: 'reply_received',
    incident_id: incident.incident_id,
    conversation_id: incident.conversation_id,
    phone: fromPhone,
    detail: `reply=${reply}`,
  });

  await deps.writeRiskEvent(
    buildSmsReplyReceivedEvent({
      eventId: deps.idGenerator(),
      conversationId: incident.conversation_id,
      incidentId: incident.incident_id,
      phone: fromPhone,
      reply,
      rawBody,
      createdAt: now,
    }),
  );

  if (reply === 'ACCEPT') {
    // CAS claim — first writer wins
    const plan = escalationPlans.plans.find((p) => p.plan_id === incident.plan_id);
    const contactId =
      plan?.contact_chain.find((c) => c.phone === fromPhone)?.contact_id ?? 'unknown';

    const accepted: EscalationIncident = {
      ...incident,
      status: 'accepted' as EscalationIncidentStatus,
      accepted_by_phone: fromPhone,
      accepted_by_contact_id: contactId,
      accepted_at: now,
      next_action_at: now,
      updated_at: now,
    };

    const success = await deps.incidentStore.update(accepted, incident.row_version);
    if (!success) {
      // CAS conflict — another ACCEPT already won. Re-read to confirm.
      log({
        component: 'escalation_coordinator',
        event: 'accept_cas_conflict',
        incident_id: incident.incident_id,
        conversation_id: incident.conversation_id,
        phone: fromPhone,
      });
      const reread = await deps.incidentStore.getById(incident.incident_id);
      if (reread?.status === 'accepted') return; // Already handled
      // Otherwise retry once
      return;
    }

    log({
      component: 'escalation_coordinator',
      event: 'incident_claimed',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      phone: fromPhone,
      contact_id: contactId,
    });

    // Send stand-down to all previously contacted phones except the acceptor
    await sendStandDownNotifications(accepted, fromPhone, escalationPlans, deps);

    await deps.writeRiskEvent(
      buildIncidentClosedEvent({
        eventId: deps.idGenerator(),
        conversationId: incident.conversation_id,
        incidentId: incident.incident_id,
        finalStatus: 'accepted',
        acceptedByPhone: fromPhone,
        acceptedByContactId: contactId,
        createdAt: now,
      }),
    );
  } else if (reply === 'IGNORE') {
    // Advance to next contact
    const plan = escalationPlans.plans.find((p) => p.plan_id === incident.plan_id);
    if (!plan) return;

    const advanced: EscalationIncident = {
      ...incident,
      current_contact_index: incident.current_contact_index + 1,
      next_action_at: now, // process immediately
      updated_at: now,
    };

    const advanceSaved = await deps.incidentStore.update(advanced, incident.row_version);
    if (!advanceSaved) {
      log({
        component: 'escalation_coordinator',
        event: 'cas_conflict',
        incident_id: incident.incident_id,
        detail: 'IGNORE advance lost — concurrent modification',
      });
      return;
    }
    await attemptContact(advanced, plan, summary, deps);
  }
  // 'unknown' replies are logged but ignored
}

// --- 4.4: processDue ---

export async function processDue(
  escalationPlans: EscalationPlans,
  deps: EscalationCoordinatorDeps,
  _ctx?: ObservabilityContext,
): Promise<number> {
  _logger = deps.logger;
  if (!deps.config.emergencyRoutingEnabled) {
    log({
      component: 'escalation_coordinator',
      event: 'process_due_skipped',
      detail: 'routing_disabled',
    });
    return 0;
  }

  const now = deps.clock();
  const dueIncidents = await deps.incidentStore.getDueIncidents(now);
  log({
    component: 'escalation_coordinator',
    event: 'process_due_start',
    detail: `due_count=${dueIncidents.length}`,
  });
  let processed = 0;

  for (const incident of dueIncidents) {
    // Claim-before-process lock (plan §3.5.1)
    const lockUntil = new Date(
      new Date(now).getTime() + deps.config.processingLockDurationMs,
    ).toISOString();

    const locked: EscalationIncident = {
      ...incident,
      processing_lock_until: lockUntil,
      updated_at: now,
    };

    const claimed = await deps.incidentStore.update(locked, incident.row_version);
    if (!claimed) continue; // Another cron run already claimed it

    const plan = escalationPlans.plans.find((p) => p.plan_id === incident.plan_id);
    if (!plan) continue;

    // Determine what action is due
    const contact = plan.contact_chain[incident.current_contact_index];

    if (!contact) {
      // Chain exhausted for this cycle
      await handleCycleExhaustion(
        { ...locked, row_version: incident.row_version + 1 },
        plan,
        incident.summary,
        deps,
      );
    } else {
      // SMS reply timeout — advance to next contact
      const advanced: EscalationIncident = {
        ...locked,
        current_contact_index: locked.current_contact_index + 1,
        processing_lock_until: null,
        updated_at: deps.clock(),
      };
      // Use locked version (which is incident.row_version + 1 after claim)
      const updatedIncident = await deps.incidentStore.getById(incident.incident_id);
      if (updatedIncident) {
        const advanceSaved = await deps.incidentStore.update(
          { ...advanced, row_version: updatedIncident.row_version },
          updatedIncident.row_version,
        );
        if (advanceSaved) {
          await attemptContact(
            { ...advanced, row_version: updatedIncident.row_version + 1 },
            plan,
            incident.summary,
            deps,
          );
        } else {
          log({
            component: 'escalation_coordinator',
            event: 'cas_conflict',
            incident_id: incident.incident_id,
            detail: 'processDue advance lost — concurrent modification',
          });
        }
      }
    }

    processed++;
  }

  return processed;
}

// --- 4.5: Stand-down notifications ---

async function sendStandDownNotifications(
  incident: EscalationIncident,
  acceptorPhone: string,
  escalationPlans: EscalationPlans,
  deps: EscalationCoordinatorDeps,
): Promise<void> {
  const plan = escalationPlans.plans.find((p) => p.plan_id === incident.plan_id);
  const acceptorContact = plan?.contact_chain.find((c) => c.phone === acceptorPhone);
  const acceptorName = acceptorContact?.name ?? 'a responder';
  const buildingName = incident.building_id;

  const recipients = incident.contacted_phone_numbers.filter((phone) => phone !== acceptorPhone);

  for (const phone of recipients) {
    try {
      await deps.smsProvider.sendSms(phone, standDownSms(buildingName, acceptorName));
    } catch {
      // Log failure but don't block — stand-down is best-effort
    }
  }

  if (recipients.length > 0) {
    await deps.writeRiskEvent(
      buildStandDownSentEvent({
        eventId: deps.idGenerator(),
        conversationId: incident.conversation_id,
        incidentId: incident.incident_id,
        recipientPhones: recipients,
        acceptedByPhone: acceptorPhone,
        createdAt: deps.clock(),
      }),
    );
  }
}

// --- 4.6: Cycle exhaustion + internal alert ---

async function handleCycleExhaustion(
  incident: EscalationIncident,
  plan: EscalationPlan,
  summary: string,
  deps: EscalationCoordinatorDeps,
): Promise<EscalationIncident> {
  const now = deps.clock();
  const willRetry = incident.cycle_number < incident.max_cycles;

  log({
    component: 'escalation_coordinator',
    event: 'cycle_exhausted',
    incident_id: incident.incident_id,
    conversation_id: incident.conversation_id,
    cycle_number: incident.cycle_number,
    detail: `max_cycles=${incident.max_cycles} will_retry=${willRetry}`,
  });

  // Emit escalation exhaustion metric (spec §25, S25-02)
  await deps.metricsRecorder?.record({
    metric_name: 'escalation_cycle_exhausted_total',
    metric_value: 1,
    component: 'escalation_coordinator',
    conversation_id: incident.conversation_id,
    timestamp: now,
  });

  await deps.writeRiskEvent(
    buildCycleExhaustedEvent({
      eventId: deps.idGenerator(),
      conversationId: incident.conversation_id,
      incidentId: incident.incident_id,
      cycleNumber: incident.cycle_number,
      maxCycles: incident.max_cycles,
      willRetry,
      createdAt: now,
    }),
  );

  // Send internal alert on each cycle exhaustion
  if (
    deps.config.internalAlertNumber &&
    samePhoneNumber(deps.config.internalAlertNumber, deps.config.outboundFromNumber)
  ) {
    log({
      component: 'escalation_coordinator',
      event: 'internal_alert_skipped_invalid_self_target',
      incident_id: incident.incident_id,
      conversation_id: incident.conversation_id,
      cycle_number: incident.cycle_number,
      phone: deps.config.internalAlertNumber,
      detail: 'internal alert recipient matches outbound sender number',
    });
  } else if (deps.config.internalAlertNumber) {
    try {
      await deps.smsProvider.sendSms(
        deps.config.internalAlertNumber,
        internalAlertSms(
          incident.building_id,
          incident.cycle_number,
          incident.max_cycles,
          incident.incident_id,
        ),
      );
      log({
        component: 'escalation_coordinator',
        event: 'internal_alert_sent',
        incident_id: incident.incident_id,
        conversation_id: incident.conversation_id,
        cycle_number: incident.cycle_number,
        phone: deps.config.internalAlertNumber,
      });
      await deps.writeRiskEvent(
        buildInternalAlertSentEvent({
          eventId: deps.idGenerator(),
          conversationId: incident.conversation_id,
          incidentId: incident.incident_id,
          cycleNumber: incident.cycle_number,
          alertPhone: deps.config.internalAlertNumber,
          createdAt: now,
        }),
      );
    } catch {
      log({
        component: 'escalation_coordinator',
        event: 'internal_alert_failed',
        incident_id: incident.incident_id,
        conversation_id: incident.conversation_id,
        cycle_number: incident.cycle_number,
        phone: deps.config.internalAlertNumber,
      });
    }
  }

  // Additive alert sink — ops team notification channel (spec §25, S25-04)
  await deps.alertSink?.emit({
    alert_name: 'escalation_cycle_exhausted',
    severity: 'critical',
    message: internalAlertSms(
      incident.building_id,
      incident.cycle_number,
      incident.max_cycles,
      incident.incident_id,
    ),
    component: 'escalation_coordinator',
    timestamp: now,
  });

  if (willRetry) {
    // Retry: restart at top of chain after delay
    const retryDelay = plan.exhaustion_behavior.retry_after_minutes;
    const updated: EscalationIncident = {
      ...incident,
      status: 'exhausted_retrying' as EscalationIncidentStatus,
      cycle_number: incident.cycle_number + 1,
      current_contact_index: 0,
      contacted_phone_numbers: [], // reset for new cycle
      next_action_at: addMinutes(now, retryDelay),
      processing_lock_until: null,
      last_provider_action: null,
      internal_alert_sent_cycles: [...incident.internal_alert_sent_cycles, incident.cycle_number],
      updated_at: now,
    };

    const retrySaved = await deps.incidentStore.update(updated, incident.row_version);
    if (!retrySaved) {
      log({
        component: 'escalation_coordinator',
        event: 'cas_conflict',
        incident_id: incident.incident_id,
        detail: 'cycle retry update lost — concurrent modification',
      });
    }
    return updated;
  } else {
    // Final exhaustion — no more retries
    const final: EscalationIncident = {
      ...incident,
      status: 'exhausted_final' as EscalationIncidentStatus,
      processing_lock_until: null,
      internal_alert_sent_cycles: [...incident.internal_alert_sent_cycles, incident.cycle_number],
      updated_at: now,
    };

    const finalSaved = await deps.incidentStore.update(final, incident.row_version);
    if (!finalSaved) {
      log({
        component: 'escalation_coordinator',
        event: 'cas_conflict',
        incident_id: incident.incident_id,
        detail: 'final exhaustion update lost — concurrent modification',
      });
    }

    await deps.writeRiskEvent(
      buildIncidentClosedEvent({
        eventId: deps.idGenerator(),
        conversationId: incident.conversation_id,
        incidentId: incident.incident_id,
        finalStatus: 'exhausted_final',
        createdAt: now,
      }),
    );

    return final;
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/emergency/twilio-signature';
import { processReplyForIncident, incidentRef } from '@wo-agent/core';
import {
  getEscalationCoordinatorDeps,
  getEscalationPlans,
  getEscalationIncidentStore,
} from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * Parse SMS reply body for ACCEPT/IGNORE + optional incident ref code.
 *
 * Accepted formats (case-insensitive, trimmed):
 *   "ACCEPT 7f3a1b2c" -> { action: 'ACCEPT', ref: '7f3a1b2c' }
 *   "IGNORE 7f3a1b2c" -> { action: 'IGNORE', ref: '7f3a1b2c' }
 *   "ACCEPT" -> { action: 'ACCEPT', ref: null }
 *   "yes" -> { action: 'unknown', ref: null }
 */
function parseReply(body: string): { action: 'ACCEPT' | 'IGNORE' | 'unknown'; ref: string | null } {
  const parts = body.trim().split(/\s+/);
  const action = parts[0]?.toUpperCase();
  const ref = parts[1] ?? null;

  if (action === 'ACCEPT') return { action: 'ACCEPT', ref };
  if (action === 'IGNORE') return { action: 'IGNORE', ref };
  return { action: 'unknown', ref: null };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlResponse(message?: string, status = 200): NextResponse {
  const body = message
    ? `<Response><Message>${escapeXml(message)}</Message></Response>`
    : '<Response/>';

  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  });
}

/**
 * POST /api/webhooks/twilio/sms-reply
 *
 * Twilio inbound SMS webhook (plan section 3.6).
 * Receives ACCEPT/IGNORE replies from emergency responders.
 * Validates Twilio signature, resolves the specific incident by ref code,
 * then invokes coordinator's processReplyForIncident().
 */
export const POST = withObservedRoute('webhooks:twilio:sms-reply', async (req: NextRequest) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ error: 'Twilio not configured' }, { status: 500 });
  }

  // Parse application/x-www-form-urlencoded body.
  // Twilio sends + for spaces, which decodeURIComponent does not handle.
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const pair of text.split('&')) {
    const [key, value] = pair.split('=').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')));
    if (key) params[key] = value ?? '';
  }

  const signature = req.headers.get('x-twilio-signature') ?? '';
  if (!validateTwilioSignature(authToken, signature, req.url, params)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const from = params['From'] ?? '';
  const body = params['Body'] ?? '';
  const { action, ref } = parseReply(body);

  const incidentStore = getEscalationIncidentStore();
  const activeIncidents = await incidentStore.getActiveByContactedPhone(from);

  if (activeIncidents.length === 0) {
    console.warn(`[sms-reply] No active incident for phone=${from}; ignoring`);
    return xmlResponse();
  }

  let target = activeIncidents;
  if (ref) {
    const refLower = ref.toLowerCase();
    target = activeIncidents.filter(
      (incident) => incidentRef(incident.incident_id).toLowerCase() === refLower,
    );

    if (target.length === 0) {
      console.warn(`[sms-reply] Ref code "${ref}" from ${from} did not match any active incident`);
      return xmlResponse();
    }
  } else if (activeIncidents.length > 1) {
    console.warn(
      `[sms-reply] Ambiguous reply from ${from}; ${activeIncidents.length} active incidents without a ref code. Ignoring.`,
    );
    return xmlResponse();
  }

  const incident = target[0];
  const coordDeps = getEscalationCoordinatorDeps();
  if (!coordDeps) {
    console.error('[sms-reply] Escalation providers not configured; cannot process reply');
    return xmlResponse();
  }

  try {
    await processReplyForIncident(
      {
        incident,
        fromPhone: from,
        reply: action,
        rawBody: body,
        escalationPlans: getEscalationPlans(),
        summary: incident.summary,
      },
      coordDeps,
    );

    if (action === 'ACCEPT') {
      const updatedIncident = await incidentStore.getById(incident.incident_id);
      if (updatedIncident?.status === 'accepted' && updatedIncident.accepted_by_phone === from) {
        return xmlResponse('Accepted. You are now marked as the responder for this emergency.');
      }
    }
  } catch (err) {
    console.error(`[sms-reply] processReplyForIncident error for ${incident.incident_id}:`, err);
    // Return 500 so Twilio retries the webhook on transient failures.
    return xmlResponse(undefined, 500);
  }

  return xmlResponse();
});

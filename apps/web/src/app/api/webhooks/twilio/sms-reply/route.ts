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
 *   "ACCEPT 7f3a1b2c"   → { action: 'ACCEPT', ref: '7f3a1b2c' }
 *   "IGNORE 7f3a1b2c"   → { action: 'IGNORE', ref: '7f3a1b2c' }
 *   "ACCEPT"             → { action: 'ACCEPT', ref: null }
 *   "yes"                → { action: 'unknown', ref: null }
 */
function parseReply(body: string): { action: 'ACCEPT' | 'IGNORE' | 'unknown'; ref: string | null } {
  const parts = body.trim().split(/\s+/);
  const action = parts[0]?.toUpperCase();
  const ref = parts[1] ?? null;

  if (action === 'ACCEPT') return { action: 'ACCEPT', ref };
  if (action === 'IGNORE') return { action: 'IGNORE', ref };
  return { action: 'unknown', ref: null };
}

/**
 * POST /api/webhooks/twilio/sms-reply
 *
 * Twilio inbound SMS webhook (plan §3.6).
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
    const [key, value] = pair
      .split('=')
      .map((s) => decodeURIComponent(s.replace(/\+/g, ' ')));
    if (key) params[key] = value ?? '';
  }

  // Validate Twilio signature
  const signature = req.headers.get('x-twilio-signature') ?? '';
  const url = req.url;
  if (!validateTwilioSignature(authToken, signature, url, params)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const from = params['From'] ?? '';
  const body = params['Body'] ?? '';
  const { action, ref } = parseReply(body);

  // Look up active incidents that contacted this phone number
  const incidentStore = getEscalationIncidentStore();
  const activeIncidents = await incidentStore.getActiveByContactedPhone(from);

  if (activeIncidents.length === 0) {
    console.warn(`[sms-reply] No active incident for phone=${from} — ignoring`);
    return new NextResponse('<Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Resolve to a single incident using the ref code
  let target = activeIncidents;
  if (ref) {
    const refLower = ref.toLowerCase();
    target = activeIncidents.filter(
      (inc) => incidentRef(inc.incident_id).toLowerCase() === refLower,
    );
    if (target.length === 0) {
      console.warn(`[sms-reply] Ref code "${ref}" from ${from} did not match any active incident`);
      return new NextResponse('<Response/>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }
  } else if (activeIncidents.length > 1) {
    // No ref code and multiple incidents — ambiguous, cannot safely route
    console.warn(
      `[sms-reply] Ambiguous reply from ${from} — ${activeIncidents.length} active incidents, no ref code. Ignoring.`,
    );
    return new NextResponse('<Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Process reply for the resolved incident (exactly one)
  const incident = target[0];
  const coordDeps = getEscalationCoordinatorDeps();
  if (!coordDeps) {
    console.error('[sms-reply] Escalation providers not configured — cannot process reply');
    return new NextResponse('<Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
  const plans = getEscalationPlans();

  try {
    await processReplyForIncident(
      {
        incident,
        fromPhone: from,
        reply: action,
        rawBody: body,
        escalationPlans: plans,
        summary: incident.summary,
      },
      coordDeps,
    );
  } catch (err) {
    console.error(`[sms-reply] processReplyForIncident error for ${incident.incident_id}:`, err);
    // Return 500 so Twilio retries the webhook on transient failures
    return new NextResponse('<Response/>', {
      status: 500,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Twilio expects 200 OK with TwiML or empty response
  return new NextResponse('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
});

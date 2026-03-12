import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioSignature } from '@/lib/emergency/twilio-signature';
import { processCallOutcome } from '@wo-agent/core';
import { getEscalationCoordinatorDeps, getEscalationPlans } from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * POST /api/webhooks/twilio/voice-status
 *
 * Twilio voice call status callback (plan §3.5).
 * Called when a voice call completes, is no-answer, or fails.
 * Validates Twilio signature, then invokes coordinator's processCallOutcome().
 */
export const POST = withObservedRoute('webhooks:twilio:voice-status', async (req: NextRequest) => {
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

  // Validate Twilio signature
  const signature = req.headers.get('x-twilio-signature') ?? '';
  const url = req.url;
  if (!validateTwilioSignature(authToken, signature, url, params)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const callSid = params['CallSid'] ?? '';
  const callStatus = params['CallStatus'] ?? '';

  // Extract incidentId and contactIndex from callback URL query params (set by coordinator)
  const incidentId = req.nextUrl.searchParams.get('incidentId') ?? '';
  if (!incidentId) {
    console.warn('[voice-status] Missing incidentId query param — cannot route callback');
    return new NextResponse('<Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
  const contactIndexParam = req.nextUrl.searchParams.get('contactIndex');
  const contactIndex = contactIndexParam !== null ? parseInt(contactIndexParam, 10) : undefined;

  const coordDeps = getEscalationCoordinatorDeps();
  if (!coordDeps) {
    console.error('[voice-status] Escalation providers not configured — cannot process callback');
    return new NextResponse('<Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  try {
    const plans = getEscalationPlans();
    await processCallOutcome(
      {
        incidentId,
        callSid,
        callStatus,
        escalationPlans: plans,
        contactIndex,
      },
      coordDeps,
    );
  } catch (err) {
    console.error('[voice-status] processCallOutcome error:', err);
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

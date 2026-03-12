import { NextRequest, NextResponse } from 'next/server';
import { processDue } from '@wo-agent/core';
import { getEscalationCoordinatorDeps, getEscalationPlans } from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/cron/emergency/process-due
 *
 * Vercel Cron-triggered route (plan §3.7).
 * Processes due escalation incidents: SMS timeouts, chain advancement, cycle retries.
 *
 * Must be GET (Vercel cron requirement).
 * Validates `Authorization: Bearer ${CRON_SECRET}` header.
 */
export const GET = withObservedRoute('cron:emergency:process-due', async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Feature flag kill switch
  if (process.env.EMERGENCY_ROUTING_ENABLED !== 'true') {
    return NextResponse.json({ skipped: true, reason: 'Emergency routing disabled' });
  }

  const coordDeps = getEscalationCoordinatorDeps();
  if (!coordDeps) {
    return NextResponse.json(
      { error: 'Escalation providers not configured' },
      { status: 500 },
    );
  }

  try {
    const plans = getEscalationPlans();
    const processed = await processDue(plans, coordDeps);
    return NextResponse.json({ processed });
  } catch (err) {
    console.error('[cron/emergency/process-due] Error:', err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
});

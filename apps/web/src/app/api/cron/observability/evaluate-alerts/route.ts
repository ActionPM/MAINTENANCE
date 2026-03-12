import { NextRequest, NextResponse } from 'next/server';
import { evaluateAlerts } from '@wo-agent/core';
import { getAlertEvaluatorDeps } from '@/lib/orchestrator-factory';
import { withObservedRoute } from '@/lib/observability/with-observed-route';

/**
 * GET /api/cron/observability/evaluate-alerts
 *
 * Vercel Cron-triggered route (spec §25, S25-04).
 * Evaluates windowed metrics and live operational state to emit alerts.
 *
 * Must be GET (Vercel cron requirement).
 * Validates `Authorization: Bearer ${CRON_SECRET}` header.
 */
export const GET = withObservedRoute(
  'cron:observability:evaluate-alerts',
  async (req: NextRequest) => {
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
    if (process.env.OBSERVABILITY_ALERTS_ENABLED !== 'true') {
      return NextResponse.json({ skipped: true, reason: 'Observability alerts disabled' });
    }

    const deps = getAlertEvaluatorDeps();
    if (!deps) {
      return NextResponse.json(
        { error: 'Alert evaluator deps not available (no DATABASE_URL)' },
        { status: 500 },
      );
    }

    try {
      const result = await evaluateAlerts(deps);
      return NextResponse.json(result);
    } catch (err) {
      console.error('[cron/observability/evaluate-alerts] Error:', err);
      return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 });
    }
  },
);

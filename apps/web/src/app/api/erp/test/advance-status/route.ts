import { NextRequest, NextResponse } from 'next/server';
import { getERPAdapter, getERPSyncService } from '../../../../../lib/orchestrator-factory.js';

/**
 * Test-only endpoint to simulate ERP status advancement (spec §23).
 * POST /api/erp/test/advance-status
 * Body: { "work_order_id": "string" }
 *
 * Advances the WO to the next status in the lifecycle and syncs.
 */
export async function POST(request: NextRequest) {
  // Guard: test-only endpoint, only enabled in development/test
  const ALLOWED_ENVS = new Set(['development', 'test']);
  if (!ALLOWED_ENVS.has(process.env.NODE_ENV ?? '')) {
    return NextResponse.json({ error: 'Test endpoint disabled' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { work_order_id?: string };
    if (!body.work_order_id) {
      return NextResponse.json({ error: 'work_order_id is required' }, { status: 400 });
    }

    const adapter = getERPAdapter();
    const extId = adapter.getExtId(body.work_order_id);
    if (!extId) {
      return NextResponse.json({ error: 'Work order not registered with ERP' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const update = adapter.advanceStatus(extId, now);

    // Sync the change to the local WO store
    const syncService = getERPSyncService();
    const syncResult = await syncService.sync(
      new Date(new Date(now).getTime() - 1000).toISOString(), // 1 second before
    );

    return NextResponse.json({
      update,
      sync: { applied: syncResult.applied, failed: syncResult.failed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { WorkOrderStatus, ActorType } from '@wo-agent/schemas';

// Mock auth middleware
vi.mock('@/middleware/auth', () => ({
  authenticateRequest: vi.fn(),
}));

// Mock work order repo
const mockWorkOrderRepo = {
  insertBatch: vi.fn(),
  getById: vi.fn(),
  getByIssueGroup: vi.fn(),
  listAll: vi.fn(),
  updateStatus: vi.fn(),
};

vi.mock('@/lib/orchestrator-factory', () => ({
  getWorkOrderRepo: () => mockWorkOrderRepo,
}));

import { GET as listWorkOrders } from '../route.js';
import { GET as getWorkOrder } from '../[id]/route.js';
import { authenticateRequest } from '@/middleware/auth';

const mockAuth = vi.mocked(authenticateRequest);

const ALICE_AUTH = {
  tenant_user_id: 'tu-alice',
  tenant_account_id: 'ta-acme',
  authorized_unit_ids: ['unit-101'],
};

const BOB_AUTH = {
  tenant_user_id: 'tu-bob',
  tenant_account_id: 'ta-acme',
  authorized_unit_ids: ['unit-201'],
};

function makeWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    work_order_id: 'wo-1',
    issue_group_id: 'ig-1',
    issue_id: 'issue-1',
    conversation_id: 'conv-1',
    client_id: 'client-1',
    property_id: 'prop-1',
    unit_id: 'unit-101',
    tenant_user_id: 'tu-alice',
    tenant_account_id: 'ta-acme',
    status: WorkOrderStatus.CREATED,
    status_history: [
      {
        status: WorkOrderStatus.CREATED,
        changed_at: '2026-01-01T00:00:00Z',
        actor: ActorType.SYSTEM,
      },
    ],
    raw_text: 'Kitchen faucet leaking',
    summary_confirmed: 'Kitchen faucet leaking',
    photos: [],
    classification: { Category: 'maintenance' },
    confidence_by_field: { Category: 0.9 },
    missing_fields: [],
    pets_present: 'unknown',
    needs_human_triage: false,
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'default',
      prompt_version: '1.0.0',
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    row_version: 1,
    ...overrides,
  };
}

describe('GET /api/work-orders (list)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when auth fails', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json(
        { errors: [{ code: 'TOKEN_MISSING', message: 'Missing authorization header' }] },
        { status: 401 },
      ),
    );

    const req = new Request('http://localhost:3000/api/work-orders');
    const res = await listWorkOrders(req as any);
    expect(res.status).toBe(401);
  });

  it('returns only work orders owned by authenticated tenant', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockWorkOrderRepo.listAll.mockResolvedValue([makeWorkOrder()]);

    const req = new Request('http://localhost:3000/api/work-orders');
    const res = await listWorkOrders(req as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.work_orders).toHaveLength(1);
    expect(body.work_orders[0].tenant_user_id).toBe('tu-alice');

    // Verify filters were passed correctly to the repo
    expect(mockWorkOrderRepo.listAll).toHaveBeenCalledWith({
      tenant_user_id: 'tu-alice',
      unit_ids: ['unit-101'],
    });
  });

  it('respects authorized_unit_ids scope', async () => {
    mockAuth.mockResolvedValue(BOB_AUTH);
    mockWorkOrderRepo.listAll.mockResolvedValue([]);

    const req = new Request('http://localhost:3000/api/work-orders');
    const res = await listWorkOrders(req as any);
    expect(res.status).toBe(200);

    expect(mockWorkOrderRepo.listAll).toHaveBeenCalledWith({
      tenant_user_id: 'tu-bob',
      unit_ids: ['unit-201'],
    });
  });
});

describe('GET /api/work-orders/:id (detail)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when auth fails', async () => {
    mockAuth.mockResolvedValue(
      NextResponse.json(
        { errors: [{ code: 'TOKEN_MISSING', message: 'Missing authorization header' }] },
        { status: 401 },
      ),
    );

    const req = new Request('http://localhost:3000/api/work-orders/wo-1');
    const res = await getWorkOrder(req as any, { params: Promise.resolve({ id: 'wo-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when work order does not exist', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockWorkOrderRepo.getById.mockResolvedValue(null);

    const req = new Request('http://localhost:3000/api/work-orders/wo-nonexistent');
    const res = await getWorkOrder(req as any, {
      params: Promise.resolve({ id: 'wo-nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects/hides another tenant's work order (returns 404)", async () => {
    mockAuth.mockResolvedValue(BOB_AUTH);
    mockWorkOrderRepo.getById.mockResolvedValue(makeWorkOrder({ tenant_user_id: 'tu-alice' }));

    const req = new Request('http://localhost:3000/api/work-orders/wo-1');
    const res = await getWorkOrder(req as any, { params: Promise.resolve({ id: 'wo-1' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('returns work order for the owning tenant with unit access', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockWorkOrderRepo.getById.mockResolvedValue(makeWorkOrder());

    const req = new Request('http://localhost:3000/api/work-orders/wo-1');
    const res = await getWorkOrder(req as any, { params: Promise.resolve({ id: 'wo-1' }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.work_order_id).toBe('wo-1');
    expect(body.tenant_user_id).toBe('tu-alice');
  });

  it('returns 404 when tenant owns WO but has lost unit access (membership change)', async () => {
    // Alice owns the WO but her authorized_unit_ids no longer includes the WO's unit
    const aliceNoUnitAccess = {
      tenant_user_id: 'tu-alice',
      tenant_account_id: 'ta-acme',
      authorized_unit_ids: ['unit-999'], // lost access to unit-101
    };
    mockAuth.mockResolvedValue(aliceNoUnitAccess);
    mockWorkOrderRepo.getById.mockResolvedValue(makeWorkOrder());

    const req = new Request('http://localhost:3000/api/work-orders/wo-1');
    const res = await getWorkOrder(req as any, { params: Promise.resolve({ id: 'wo-1' }) });
    expect(res.status).toBe(404);
  });
});

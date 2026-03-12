import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { ConversationState } from '@wo-agent/schemas';

// Mock auth middleware
vi.mock('@/middleware/auth', () => ({
  authenticateRequest: vi.fn(),
}));

// Mock session store
const mockSessionStore = {
  get: vi.fn(),
  getByTenantUser: vi.fn(),
  save: vi.fn(),
};

vi.mock('@/lib/orchestrator-factory', () => ({
  getSessionStore: () => mockSessionStore,
}));

import { GET } from '../[id]/route.js';
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

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-alice',
    tenant_account_id: 'ta-acme',
    state: ConversationState.INTAKE_STARTED,
    unit_id: null,
    authorized_unit_ids: ['unit-101'],
    pinned_versions: {
      taxonomy_version: '1.0.0',
      schema_version: '1.0.0',
      model_id: 'default',
      prompt_version: '1.0.0',
    },
    split_issues: null,
    classification_results: null,
    prior_state_before_error: null,
    followup_turn_number: 0,
    total_questions_asked: 0,
    previous_questions: [],
    pending_followup_questions: null,
    draft_photo_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    last_activity_at: '2026-01-01T00:00:00Z',
    confirmation_entered_at: null,
    source_text_hash: null,
    split_hash: null,
    confirmation_presented: false,
    property_id: null,
    client_id: null,
    building_id: null,
    risk_triggers: [],
    escalation_state: 'none',
    escalation_plan_id: null,
    ...overrides,
  };
}

function makeRequest(id: string) {
  return new Request(`http://localhost:3000/api/conversations/${id}`);
}

describe('GET /api/conversations/:id', () => {
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

    const res = await GET(makeRequest('conv-1') as any, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when conversation does not exist', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockSessionStore.get.mockResolvedValue(null);

    const res = await GET(makeRequest('conv-nonexistent') as any, {
      params: Promise.resolve({ id: 'conv-nonexistent' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('does not return another tenant\'s session (returns 404)', async () => {
    mockAuth.mockResolvedValue(BOB_AUTH);
    mockSessionStore.get.mockResolvedValue(makeSession({ tenant_user_id: 'tu-alice' }));

    const res = await GET(makeRequest('conv-1') as any, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errors[0].code).toBe('NOT_FOUND');
  });

  it('returns ConversationSnapshot shape for the owning tenant', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockSessionStore.get.mockResolvedValue(makeSession());

    const res = await GET(makeRequest('conv-1') as any, {
      params: Promise.resolve({ id: 'conv-1' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.conversation_id).toBe('conv-1');
    expect(body.state).toBe('intake_started');
    expect(body.pinned_versions).toBeDefined();
    expect(body.created_at).toBe('2026-01-01T00:00:00Z');
    expect(body.last_activity_at).toBe('2026-01-01T00:00:00Z');
  });
});

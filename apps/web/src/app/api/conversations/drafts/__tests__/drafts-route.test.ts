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

import { GET } from '../route.js';
import { authenticateRequest } from '@/middleware/auth';

const mockAuth = vi.mocked(authenticateRequest);

const ALICE_AUTH = {
  tenant_user_id: 'tu-alice',
  tenant_account_id: 'ta-acme',
  authorized_unit_ids: ['unit-101'],
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-alice',
    tenant_account_id: 'ta-acme',
    state: ConversationState.SPLIT_PROPOSED,
    unit_id: 'unit-101',
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
    last_activity_at: '2026-01-01T12:00:00Z',
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

function makeRequest() {
  return new Request('http://localhost:3000/api/conversations/drafts');
}

describe('GET /api/conversations/drafts', () => {
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

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  it('returns only resumable drafts for the authenticated tenant', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockSessionStore.getByTenantUser.mockResolvedValue([
      makeSession({ conversation_id: 'conv-1', state: ConversationState.SPLIT_PROPOSED }),
      makeSession({
        conversation_id: 'conv-2',
        state: ConversationState.SUBMITTED, // terminal — not resumable
      }),
      makeSession({
        conversation_id: 'conv-3',
        state: ConversationState.NEEDS_TENANT_INPUT,
        last_activity_at: '2026-01-02T00:00:00Z',
      }),
    ]);

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Only split_proposed and needs_tenant_input are resumable
    expect(body.drafts).toHaveLength(2);
    // Sorted by last_activity_at desc — conv-3 first
    expect(body.drafts[0].conversation_id).toBe('conv-3');
    expect(body.drafts[1].conversation_id).toBe('conv-1');
  });

  it('returns empty array when tenant has no drafts', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockSessionStore.getByTenantUser.mockResolvedValue([]);

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.drafts).toEqual([]);
  });

  it('includes conversation_id, state, unit_id, timestamps in each draft', async () => {
    mockAuth.mockResolvedValue(ALICE_AUTH);
    mockSessionStore.getByTenantUser.mockResolvedValue([
      makeSession({ unit_id: 'unit-101' }),
    ]);

    const res = await GET(makeRequest() as any);
    const body = await res.json();

    expect(body.drafts[0]).toEqual({
      conversation_id: 'conv-1',
      state: 'split_proposed',
      unit_id: 'unit-101',
      created_at: '2026-01-01T00:00:00Z',
      last_activity_at: '2026-01-01T12:00:00Z',
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkOrders } from '../../work-order/wo-creator.js';
import {
  createSession,
  setSessionUnit,
  setSplitIssues,
  setClassificationResults,
  setSessionScope,
} from '../../session/session.js';
import type { ConversationSession } from '../../session/types.js';

const baseSession = (): ConversationSession => {
  let s = createSession({
    conversation_id: 'conv-1',
    tenant_user_id: 'tu-1',
    tenant_account_id: 'ta-1',
    authorized_unit_ids: ['unit-1'],
    pinned_versions: {
      taxonomy_version: '1.0',
      schema_version: '1.0',
      model_id: 'gpt-test',
      prompt_version: '1.0',
      cue_version: '1.2.0',
    },
  });
  s = setSessionUnit(s, 'unit-1');
  s = setSessionScope(s, { property_id: 'prop-1', client_id: 'client-1' });
  s = setSplitIssues(s, [
    { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My kitchen faucet is leaking' },
    { issue_id: 'iss-2', summary: 'Broken window', raw_excerpt: 'Window in bedroom cracked' },
  ]);
  s = setClassificationResults(s, [
    {
      issue_id: 'iss-1',
      classifierOutput: {
        issue_id: 'iss-1',
        classification: { category: 'plumbing', subcategory: 'faucet' },
        model_confidence: { category: 0.9, subcategory: 0.8 },
        missing_fields: [],
        needs_human_triage: false,
      },
      computedConfidence: { category: 0.92, subcategory: 0.85 },
      fieldsNeedingInput: [],
      shouldAskFollowup: false,
      followupTypes: {},
      constraintPassed: true,
      recoverable_via_followup: false,
    },
    {
      issue_id: 'iss-2',
      classifierOutput: {
        issue_id: 'iss-2',
        classification: { category: 'structural', subcategory: 'window' },
        model_confidence: { category: 0.85, subcategory: 0.7 },
        missing_fields: ['severity'],
        needs_human_triage: false,
      },
      computedConfidence: { category: 0.88, subcategory: 0.75 },
      fieldsNeedingInput: [],
      shouldAskFollowup: false,
      followupTypes: {},
      constraintPassed: true,
      recoverable_via_followup: false,
    },
  ]);
  return s;
};

describe('createWorkOrders', () => {
  let idCounter = 0;
  const idGen = () => `gen-${++idCounter}`;
  const clock = () => '2026-03-03T14:00:00Z';

  beforeEach(() => {
    idCounter = 0;
  });

  it('creates one WO per split issue', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    expect(wos).toHaveLength(2);
  });

  it('all WOs share the same issue_group_id', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const groupId = wos[0].issue_group_id;
    expect(groupId).toBeTruthy();
    expect(wos.every((wo) => wo.issue_group_id === groupId)).toBe(true);
  });

  it('each WO has a unique work_order_id', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const ids = new Set(wos.map((wo) => wo.work_order_id));
    expect(ids.size).toBe(2);
  });

  it('maps issue_id correctly', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    expect(wos.map((wo) => wo.issue_id).sort()).toEqual(['iss-1', 'iss-2']);
  });

  it('populates scope fields from session', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.client_id).toBe('client-1');
      expect(wo.property_id).toBe('prop-1');
      expect(wo.unit_id).toBe('unit-1');
      expect(wo.tenant_user_id).toBe('tu-1');
      expect(wo.tenant_account_id).toBe('ta-1');
    }
  });

  it('sets initial status to "created" with history entry', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.status).toBe('created');
      expect(wo.status_history).toHaveLength(1);
      expect(wo.status_history[0]).toEqual({
        status: 'created',
        changed_at: '2026-03-03T14:00:00Z',
        actor: 'system',
      });
    }
  });

  it('maps classification and confidence from results', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const wo1 = wos.find((wo) => wo.issue_id === 'iss-1')!;
    expect(wo1.classification).toEqual({ category: 'plumbing', subcategory: 'faucet' });
    expect(wo1.confidence_by_field).toEqual({ category: 0.92, subcategory: 0.85 });
  });

  it('uses raw_excerpt as raw_text and summary as summary_confirmed', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    const wo1 = wos.find((wo) => wo.issue_id === 'iss-1')!;
    expect(wo1.raw_text).toBe('My kitchen faucet is leaking');
    expect(wo1.summary_confirmed).toBe('Leaky faucet');
  });

  it('does not attach placeholder photos (metadata unavailable at creation time)', () => {
    let session = baseSession();
    session = { ...session, draft_photo_ids: ['photo-1', 'photo-2'] };
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      // Photos are empty at creation — enriched post-creation when upload metadata is available
      expect(wo.photos).toHaveLength(0);
    }
  });

  it('sets row_version to 1', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.row_version).toBe(1);
    }
  });

  it('copies pinned_versions from session', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.pinned_versions).toEqual(session.pinned_versions);
    }
  });

  it('marks needs_human_triage from classification result', () => {
    let session = baseSession();
    session = setClassificationResults(session, [
      {
        issue_id: 'iss-1',
        classifierOutput: {
          issue_id: 'iss-1',
          classification: { category: 'plumbing' },
          model_confidence: { category: 0.4 },
          missing_fields: ['subcategory'],
          needs_human_triage: true,
        },
        computedConfidence: { category: 0.45 },
        fieldsNeedingInput: [],
        shouldAskFollowup: false,
        followupTypes: {},
        constraintPassed: true,
        recoverable_via_followup: false,
      },
    ]);
    session = setSplitIssues(session, [
      { issue_id: 'iss-1', summary: 'Leaky faucet', raw_excerpt: 'My faucet leaks' },
    ]);
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    expect(wos[0].needs_human_triage).toBe(true);
    expect(wos[0].missing_fields).toEqual(['subcategory']);
  });

  it('defaults pets_present to "unknown"', () => {
    const session = baseSession();
    const wos = createWorkOrders({ session, idGenerator: idGen, clock });
    for (const wo of wos) {
      expect(wo.pets_present).toBe('unknown');
    }
  });

  it('throws if session has no unit_id', () => {
    let session = baseSession();
    session = { ...session, unit_id: null };
    expect(() => createWorkOrders({ session, idGenerator: idGen, clock })).toThrow(/unit_id/);
  });

  it('throws if session has no property_id or client_id', () => {
    let session = baseSession();
    session = { ...session, property_id: null };
    expect(() => createWorkOrders({ session, idGenerator: idGen, clock })).toThrow(/property_id/);
  });
});

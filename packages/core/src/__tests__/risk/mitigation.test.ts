import { describe, it, expect } from 'vitest';
import { resolveMitigationTemplate, renderMitigationMessages } from '../../risk/mitigation.js';
import type { RiskProtocols, MatchedTrigger } from '@wo-agent/schemas';

const TEST_PROTOCOLS: RiskProtocols = {
  version: '1.0.0',
  triggers: [
    {
      trigger_id: 'fire-001',
      name: 'Fire',
      grammar: { keyword_any: ['fire'], regex_any: [], taxonomy_path_any: [] },
      requires_confirmation: true,
      severity: 'emergency',
      mitigation_template_id: 'mit-fire',
    },
  ],
  mitigation_templates: [
    {
      template_id: 'mit-fire',
      name: 'Fire Safety',
      message_template: 'If there is an active fire, call 911 immediately.',
      safety_instructions: ['Call 911', 'Evacuate via stairwell'],
    },
  ],
};

describe('resolveMitigationTemplate', () => {
  it('resolves template by ID', () => {
    const template = resolveMitigationTemplate('mit-fire', TEST_PROTOCOLS);
    expect(template).toBeDefined();
    expect(template!.name).toBe('Fire Safety');
  });

  it('returns null for unknown template ID', () => {
    const template = resolveMitigationTemplate('mit-unknown', TEST_PROTOCOLS);
    expect(template).toBeNull();
  });
});

describe('renderMitigationMessages', () => {
  it('renders mitigation messages for matched triggers', () => {
    const matches: MatchedTrigger[] = [
      {
        trigger: TEST_PROTOCOLS.triggers[0],
        matched_keywords: ['fire'],
        matched_regex: [],
        matched_taxonomy_paths: [],
      },
    ];
    const messages = renderMitigationMessages(matches, TEST_PROTOCOLS);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Fire Safety');
    expect(messages[0]).toContain('call 911');
    expect(messages[0]).toContain('Call 911');
    expect(messages[0]).toContain('Evacuate via stairwell');
  });

  it('returns empty array when no matches', () => {
    const messages = renderMitigationMessages([], TEST_PROTOCOLS);
    expect(messages).toHaveLength(0);
  });
});

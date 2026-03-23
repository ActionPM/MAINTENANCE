import { describe, it, expect } from 'vitest';
import { ConversationState } from '@wo-agent/schemas';
import type { DisambiguatorInput } from '@wo-agent/schemas';
import {
  buildDisambiguatorSystemPrompt,
  buildDisambiguatorUserMessage,
} from '../disambiguator-prompt.js';

const baseInput: DisambiguatorInput = {
  message: 'The kitchen sink is leaking too',
  current_issues: [
    {
      issue_id: 'iss-1',
      summary: 'Broken bathroom faucet',
      raw_excerpt: 'My bathroom faucet is broken and dripping constantly',
    },
  ],
  pending_questions: [
    {
      question_id: 'q1',
      field_target: 'Sub_Location',
      prompt: 'Where exactly in the bathroom is the faucet?',
      options: [],
      answer_type: 'text',
    },
  ],
  conversation_state: ConversationState.NEEDS_TENANT_INPUT,
  model_id: 'claude-sonnet-4-20250514',
  prompt_version: '1.0.0',
      cue_version: '1.2.0',
  conversation_id: 'conv-1',
};

describe('buildDisambiguatorSystemPrompt', () => {
  it('includes classification instructions and JSON format', () => {
    const prompt = buildDisambiguatorSystemPrompt();
    expect(prompt).toContain('clarification');
    expect(prompt).toContain('new_issue');
    expect(prompt).toContain('"classification"');
    expect(prompt).toContain('"reasoning"');
  });
});

describe('buildDisambiguatorUserMessage', () => {
  it('includes current issues with summaries and excerpts', () => {
    const msg = buildDisambiguatorUserMessage(baseInput);
    expect(msg).toContain('Broken bathroom faucet');
    expect(msg).toContain('My bathroom faucet is broken and dripping constantly');
  });

  it('includes pending follow-up questions with field targets', () => {
    const msg = buildDisambiguatorUserMessage(baseInput);
    expect(msg).toContain('[Sub_Location]');
    expect(msg).toContain('Where exactly in the bathroom is the faucet?');
  });

  it('includes the tenant message', () => {
    const msg = buildDisambiguatorUserMessage(baseInput);
    expect(msg).toContain('The kitchen sink is leaking too');
  });

  it('shows placeholder when no pending questions', () => {
    const msg = buildDisambiguatorUserMessage({
      ...baseInput,
      pending_questions: null,
    });
    expect(msg).toContain('none — tenant is reviewing the final confirmation');
  });

  it('numbers multiple issues', () => {
    const msg = buildDisambiguatorUserMessage({
      ...baseInput,
      current_issues: [
        { issue_id: 'i1', summary: 'Broken faucet', raw_excerpt: 'faucet broken' },
        { issue_id: 'i2', summary: 'Light out', raw_excerpt: 'light is out' },
      ],
    });
    expect(msg).toContain('1. Broken faucet');
    expect(msg).toContain('2. Light out');
  });
});

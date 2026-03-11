import { describe, it, expect } from 'vitest';
import { buildFollowUpSystemPrompt } from '../../llm/prompts/followup-prompt.js';

describe('follow-up prompt redundancy-prevention rules', () => {
  const prompt = buildFollowUpSystemPrompt();

  it('has a rule about combining confirmation with location', () => {
    expect(prompt).toMatch(/confirm.*location|location.*confirm/i);
  });

  it('has a rule about not asking what the tenant already answered', () => {
    expect(prompt).toMatch(
      /already.*(answer|impl|said|mention)|tenant.*(said|words|description).*answer/i,
    );
  });

  it('has a rule about using only constraint-valid options', () => {
    expect(prompt).toMatch(/constraint.*valid|valid.*option|hierarchi/i);
  });

  it('contains at least 11 numbered rules', () => {
    // Count numbered rules (e.g., "1.", "2.", ..., "11.")
    const ruleNumbers = prompt.match(/^\d+\./gm) ?? [];
    expect(ruleNumbers.length).toBeGreaterThanOrEqual(11);
  });
});

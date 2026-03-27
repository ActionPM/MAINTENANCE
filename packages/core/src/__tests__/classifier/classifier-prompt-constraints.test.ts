import { describe, it, expect } from 'vitest';
import {
  buildClassifierSystemPrompt,
  buildClassifierSystemPromptV1,
  buildClassifierSystemPromptV2,
} from '../../llm/prompts/classifier-prompt.js';
import { taxonomy } from '@wo-agent/schemas';

describe('classifier prompt constraint awareness', () => {
  const prompt = buildClassifierSystemPrompt(taxonomy);

  it('contains HIERARCHICAL CONSTRAINTS section', () => {
    expect(prompt).toContain('HIERARCHICAL CONSTRAINTS');
  });

  it('mentions Location constrains Sub_Location', () => {
    expect(prompt).toMatch(
      /Location.*constrain.*Sub_Location|Sub_Location.*must.*match.*Location/i,
    );
  });

  it('mentions Maintenance_Object constrains Maintenance_Problem', () => {
    expect(prompt).toMatch(
      /Maintenance_Object.*constrain.*Maintenance_Problem|Maintenance_Problem.*must.*valid.*Maintenance_Object/i,
    );
  });

  it('gives toilet + bathroom as an example', () => {
    expect(prompt).toMatch(/toilet.*bathroom/i);
  });

  it('gives fridge + kitchen as an example', () => {
    expect(prompt).toMatch(/fridge.*kitchen/i);
  });

  it('warns against toilet + bedroom as invalid', () => {
    expect(prompt).toMatch(/toilet.*bedroom.*invalid|do not.*toilet.*bedroom/i);
  });
});

describe('classifier prompt Priority guidance (version-gated)', () => {
  it('v1 prompt without flag does NOT include Priority guidance', () => {
    const v1 = buildClassifierSystemPromptV1(taxonomy);
    expect(v1).not.toContain('PRIORITY GUIDANCE');
  });

  it('v1 prompt with includePriorityGuidance includes Priority guidance', () => {
    const v1 = buildClassifierSystemPromptV1(taxonomy, { includePriorityGuidance: true });
    expect(v1).toContain('PRIORITY GUIDANCE');
    expect(v1).toContain('immediate safety risk');
    expect(v1).toContain('dripping faucet');
  });

  it('v2 prompt without flag does NOT include Priority guidance', () => {
    const v2 = buildClassifierSystemPromptV2(taxonomy);
    expect(v2).not.toContain('PRIORITY GUIDANCE');
  });

  it('v2 prompt with includePriorityGuidance includes Priority guidance', () => {
    const v2 = buildClassifierSystemPromptV2(taxonomy, { includePriorityGuidance: true });
    expect(v2).toContain('PRIORITY GUIDANCE');
    expect(v2).toContain('immediate safety risk');
    expect(v2).toContain('dripping faucet');
  });

  it('buildClassifierSystemPrompt dispatches Priority guidance only for >= 2.1.0', () => {
    const v200 = buildClassifierSystemPrompt(taxonomy, '2.0.0');
    const v210 = buildClassifierSystemPrompt(taxonomy, '2.1.0');
    const v100 = buildClassifierSystemPrompt(taxonomy, '1.0.0');

    expect(v200).not.toContain('PRIORITY GUIDANCE');
    expect(v210).toContain('PRIORITY GUIDANCE');
    expect(v100).not.toContain('PRIORITY GUIDANCE');
  });

  it('Priority guidance does NOT list "no heat" as emergency (Batch 2b hold)', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.3.0');
    // "no heat" is a disputed item held in Batch 2b — must NOT appear in emergency examples
    expect(prompt).not.toMatch(/"emergency".*no heat/);
    // "no heat" should appear in "high" examples instead
    expect(prompt).toMatch(/"high".*no heat/);
  });
});

describe('domain hints version gating', () => {
  it('V2 prompt at 2.2.0 includes intercom domain guidance', () => {
    const v2 = buildClassifierSystemPromptV2(taxonomy, { includeDomainHints: true });
    expect(v2).toContain('intercom');
    expect(v2).toContain('DOMAIN ASSIGNMENT HINTS');
  });

  it('V1 prompt at 2.2.0 includes intercom domain guidance', () => {
    const v1 = buildClassifierSystemPromptV1(taxonomy, { includeDomainHints: true });
    expect(v1).toContain('intercom');
    expect(v1).toContain('DOMAIN ASSIGNMENT HINTS');
  });

  it('V2 prompt at 2.2.0 includes key fob / building_access guidance', () => {
    const v2 = buildClassifierSystemPromptV2(taxonomy, { includeDomainHints: true });
    expect(v2).toContain('Key fob');
    expect(v2).toContain('building_access');
  });

  it('V2 prompt at 2.1.0 does NOT include domain guidance (version gate)', () => {
    const v210 = buildClassifierSystemPrompt(taxonomy, '2.1.0');
    expect(v210).not.toContain('DOMAIN ASSIGNMENT HINTS');
  });

  it('V1 prompt at 2.0.0 does NOT include domain guidance (version gate)', () => {
    const v200 = buildClassifierSystemPrompt(taxonomy, '2.0.0');
    expect(v200).not.toContain('DOMAIN ASSIGNMENT HINTS');
  });

  it('V2 prompt at 2.1.0 still includes Priority guidance (no regression)', () => {
    const v210 = buildClassifierSystemPrompt(taxonomy, '2.1.0');
    expect(v210).toContain('PRIORITY GUIDANCE');
  });

  it('V2 prompt at 2.2.0 includes both Priority and Domain hints', () => {
    const v220 = buildClassifierSystemPrompt(taxonomy, '2.2.0');
    expect(v220).toContain('PRIORITY GUIDANCE');
    expect(v220).toContain('DOMAIN ASSIGNMENT HINTS');
  });
});

describe('HVAC hints version gating', () => {
  it('V2 prompt at version 2.3.0 includes "HVAC CLASSIFICATION HINTS"', () => {
    const v230 = buildClassifierSystemPrompt(taxonomy, '2.3.0');
    expect(v230).toContain('HVAC CLASSIFICATION HINTS');
  });

  it('V1 prompt at version 2.3.0 includes "HVAC CLASSIFICATION HINTS"', () => {
    // V1 is used when promptVersion < 2.0.0, but the flag is still passed.
    // Since 2.3.0 >= 2.0.0, the main entry point routes to V2, so test V1 directly.
    const v1 = buildClassifierSystemPromptV1(taxonomy, { includeHvacHints: true });
    expect(v1).toContain('HVAC CLASSIFICATION HINTS');
  });

  it('V2 prompt at version 2.2.0 does NOT include "HVAC CLASSIFICATION HINTS"', () => {
    const v220 = buildClassifierSystemPrompt(taxonomy, '2.2.0');
    expect(v220).not.toContain('HVAC CLASSIFICATION HINTS');
  });

  it('V2 prompt at version 2.3.0 still includes domain hints and Priority guidance', () => {
    const v230 = buildClassifierSystemPrompt(taxonomy, '2.3.0');
    expect(v230).toContain('PRIORITY GUIDANCE');
    expect(v230).toContain('DOMAIN ASSIGNMENT HINTS');
    expect(v230).toContain('HVAC CLASSIFICATION HINTS');
  });

  it('V2 prompt at version 2.3.0 includes needs_object field-confusion guard', () => {
    const v230 = buildClassifierSystemPrompt(taxonomy, '2.3.0');
    expect(v230).toContain('ONLY valid for the Maintenance_Object field');
  });

  it('V2 prompt at version 2.2.0 does NOT include needs_object field-confusion guard', () => {
    const v220 = buildClassifierSystemPrompt(taxonomy, '2.2.0');
    expect(v220).not.toContain('ONLY valid for the Maintenance_Object field');
  });
});

describe('electrical safety hints version gating', () => {
  it('prompt at 2.4.0 includes ELECTRICAL SAFETY ESCALATION block', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.4.0');
    expect(prompt).toContain('ELECTRICAL SAFETY ESCALATION');
    expect(prompt).toContain('sparks, arcing, or electrical fire');
    expect(prompt).toContain('NOT emergency');
  });

  it('prompt at 2.3.0 does NOT include ELECTRICAL SAFETY ESCALATION block', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.3.0');
    expect(prompt).not.toContain('ELECTRICAL SAFETY ESCALATION');
  });

  it('prompt at 2.4.0 still includes all prior blocks (no regression)', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.4.0');
    expect(prompt).toContain('PRIORITY GUIDANCE');
    expect(prompt).toContain('DOMAIN ASSIGNMENT HINTS');
    expect(prompt).toContain('HVAC CLASSIFICATION HINTS');
    expect(prompt).toContain('ELECTRICAL SAFETY ESCALATION');
  });

  it('PRIORITY_GUIDANCE_BLOCK still lists electrical safety as high (backward compat)', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.4.0');
    expect(prompt).toMatch(/"high".*electrical safety/);
  });

  it('electrical safety escalation block explicitly excludes routine failures', () => {
    const prompt = buildClassifierSystemPrompt(taxonomy, '2.4.0');
    expect(prompt).toMatch(/NOT emergency[\s\S]*breaker trips|breaker trips[\s\S]*NOT emergency/i);
  });
});

import { describe, it, expect } from 'vitest';
import { buildClassifierSystemPrompt } from '../../llm/prompts/classifier-prompt.js';
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

import { describe, it, expect } from 'vitest';
import { SystemEvent, ALL_SYSTEM_EVENTS } from '../../state-machine/system-events.js';

describe('SystemEvent', () => {
  it('defines all 6 system events from spec §11.2', () => {
    expect(ALL_SYSTEM_EVENTS).toHaveLength(6);
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_SPLIT_SUCCESS');
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_CLASSIFY_SUCCESS');
    expect(ALL_SYSTEM_EVENTS).toContain('LLM_FAIL');
    expect(ALL_SYSTEM_EVENTS).toContain('START_CLASSIFICATION');
    expect(ALL_SYSTEM_EVENTS).toContain('RETRY_LLM');
    expect(ALL_SYSTEM_EVENTS).toContain('EXPIRE');
  });

  it('has no overlap with ActionType values', async () => {
    const { ALL_ACTION_TYPES } = await import('@wo-agent/schemas');
    for (const evt of ALL_SYSTEM_EVENTS) {
      expect(ALL_ACTION_TYPES).not.toContain(evt);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { scanTextForTriggers } from '../../risk/trigger-scanner.js';
import { loadRiskProtocols } from '@wo-agent/schemas';

const protocols = loadRiskProtocols();

describe('electrical safety risk trigger (safety-001)', () => {
  // Emergency matches: safety-001 fires, has_emergency === true
  it('"sparks coming from the outlet" → safety-001 fires', () => {
    const result = scanTextForTriggers('sparks coming from the outlet', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"arcing noise from the breaker panel" → safety-001 fires', () => {
    const result = scanTextForTriggers('arcing noise from the breaker panel', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"exposed wires in the hallway" → safety-001 fires', () => {
    const result = scanTextForTriggers('exposed wires in the hallway', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"exposed live wires in the bedroom" → safety-001 fires', () => {
    const result = scanTextForTriggers('exposed live wires in the bedroom', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"I got an electrical shock from the switch" → safety-001 fires', () => {
    const result = scanTextForTriggers('I got an electrical shock from the switch', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"electrical fire in the laundry room" → safety-001 fires', () => {
    const result = scanTextForTriggers('electrical fire in the laundry room', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"the outlet is too hot to touch" → safety-001 fires', () => {
    const result = scanTextForTriggers('the outlet is too hot to touch', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"the switch is burning hot" → safety-001 fires', () => {
    const result = scanTextForTriggers('the switch is burning hot', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  it('"outlet is smoking" → safety-001 fires', () => {
    const result = scanTextForTriggers('outlet is smoking', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).toContain('safety-001');
    expect(result.has_emergency).toBe(true);
  });

  // Non-matches: safety-001 does NOT fire
  it('"outlet not working" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('outlet not working', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });

  it('"breaker keeps tripping" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('breaker keeps tripping', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });

  it('"lights flickering in kitchen" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('lights flickering in kitchen', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });

  it('"unsafe electrical wiring" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('unsafe electrical wiring', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });

  it('"no power in whole apartment" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('no power in whole apartment', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });

  it('"shock absorber on the door is broken" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('shock absorber on the door is broken', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });

  it('"I was shocked by the rent increase" → safety-001 does NOT fire', () => {
    const result = scanTextForTriggers('I was shocked by the rent increase', protocols);
    const ids = result.triggers_matched.map((t) => t.trigger.trigger_id);
    expect(ids).not.toContain('safety-001');
  });
});

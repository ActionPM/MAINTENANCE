import { describe, it, expect } from 'vitest';

describe('core type imports used by @wo-agent/db', () => {
  it('can import EventRepository and related types', async () => {
    const core = await import('@wo-agent/core');
    expect(core.InMemoryEventStore).toBeDefined();
  });

  it('can import SessionStore type', async () => {
    // Type-only — just ensure the import resolves
    const core = await import('@wo-agent/core');
    expect(core).toBeDefined();
  });
});

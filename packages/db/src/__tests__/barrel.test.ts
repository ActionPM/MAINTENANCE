import { describe, it, expect } from 'vitest';
import * as db from '../index.js';

describe('@wo-agent/db barrel exports', () => {
  it('exports createPool', () => {
    expect(typeof db.createPool).toBe('function');
  });

  it('exports PostgresEventStore', () => {
    expect(typeof db.PostgresEventStore).toBe('function');
  });

  it('exports PostgresWorkOrderStore', () => {
    expect(typeof db.PostgresWorkOrderStore).toBe('function');
  });

  it('exports PostgresSessionStore', () => {
    expect(typeof db.PostgresSessionStore).toBe('function');
  });

  it('exports PostgresNotificationStore', () => {
    expect(typeof db.PostgresNotificationStore).toBe('function');
  });

  it('exports PostgresNotificationPreferenceStore', () => {
    expect(typeof db.PostgresNotificationPreferenceStore).toBe('function');
  });

  it('exports PostgresIdempotencyStore', () => {
    expect(typeof db.PostgresIdempotencyStore).toBe('function');
  });

  it('exports runMigrations', () => {
    expect(typeof db.runMigrations).toBe('function');
  });
});

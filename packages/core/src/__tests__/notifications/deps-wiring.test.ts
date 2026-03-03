import { describe, it, expect } from 'vitest';
import type { OrchestratorDependencies } from '../../orchestrator/types.js';

describe('OrchestratorDependencies notification wiring', () => {
  it('accepts notificationService as an optional dependency', () => {
    // This test is a compile-time check. If NotificationService is not
    // on OrchestratorDependencies, TypeScript will fail.
    const partial: Pick<OrchestratorDependencies, 'notificationService'> = {
      notificationService: undefined,
    };
    // Optional — undefined is valid
    expect(partial.notificationService).toBeUndefined();
  });
});

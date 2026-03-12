import type { AlertCooldownStore } from './types.js';

/**
 * In-memory alert cooldown store for tests.
 * Uses a Map keyed by `alertName:scope` with Date of last alert.
 */
export class InMemoryAlertCooldownStore implements AlertCooldownStore {
  private readonly entries = new Map<string, Date>();

  async shouldAlert(alertName: string, scope: string, cooldownMinutes: number): Promise<boolean> {
    const key = `${alertName}:${scope}`;
    const last = this.entries.get(key);
    if (!last) return true;
    const elapsed = (Date.now() - last.getTime()) / 60_000;
    return elapsed >= cooldownMinutes;
  }

  async recordAlert(alertName: string, scope: string): Promise<void> {
    const key = `${alertName}:${scope}`;
    this.entries.set(key, new Date());
  }
}

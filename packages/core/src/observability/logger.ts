import type { Logger, LogEntry } from './types.js';

/**
 * Writes structured JSON logs to stdout.
 * Vercel captures stdout as structured logs natively.
 */
export class StdoutJsonLogger implements Logger {
  log(entry: LogEntry): void {
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}

/**
 * Discards all log entries. Used when logging is not configured.
 */
export class NoopLogger implements Logger {
  log(_entry: LogEntry): void {
    // intentionally empty
  }
}

/**
 * Collects log entries in memory for test assertions.
 */
export class InMemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  log(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

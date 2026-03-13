import { NextResponse } from 'next/server';
import { DEFAULT_RATE_LIMITS } from '@wo-agent/schemas';
import type { RateLimitConfig } from '@wo-agent/schemas';

/**
 * In-memory rate limiter for MVP (spec §8).
 * Production should use Redis or similar.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

/**
 * Emit a structured security event on rate-limit violation (spec §8, S08-08).
 * Writes to stdout as JSON for structured log aggregation.
 */
function emitSecurityEvent(userId: string, limitKey: string, count: number, limit: number): void {
  const event = {
    event_type: 'security.rate_limit_exceeded',
    severity: 'warn',
    user_id: userId,
    limit_key: limitKey,
    request_count: count,
    limit,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(event));
}

export function checkRateLimit(
  userId: string,
  limitKey: keyof RateLimitConfig,
  windowMs: number = 60_000,
): NextResponse | null {
  const limit = DEFAULT_RATE_LIMITS[limitKey];
  const key = `${userId}:${limitKey}`;
  const now = Date.now();

  let window = windows.get(key);
  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + windowMs };
    windows.set(key, window);
  }

  window.count++;
  if (window.count > limit) {
    emitSecurityEvent(userId, limitKey, window.count, limit);
    return NextResponse.json(
      { errors: [{ code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' }] },
      { status: 429 },
    );
  }

  return null; // within limit
}

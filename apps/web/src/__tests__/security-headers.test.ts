import { describe, it, expect } from 'vitest';
import nextConfig from '../../next.config.js';

describe('security headers', () => {
  it('has a headers function', () => {
    expect(nextConfig.headers).toBeDefined();
    expect(typeof nextConfig.headers).toBe('function');
  });

  it('returns a catch-all route with all required security headers', async () => {
    const headerEntries = await nextConfig.headers!();
    const catchAll = headerEntries.find((entry) => entry.source === '/:path*');

    expect(catchAll).toBeDefined();

    const headers = catchAll!.headers;
    const headerMap = new Map(headers.map((h) => [h.key, h.value]));

    expect(headerMap.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(headerMap.get('X-Frame-Options')).toBe('DENY');
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerMap.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@wo-agent/core', '@wo-agent/schemas', '@wo-agent/mock-erp', '@wo-agent/db'],
  webpack: (config) => {
    // Map .js imports to .ts/.tsx so webpack resolves TypeScript ESM-style
    // imports (e.g. './foo.js' → './foo.ts') used across workspace packages.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

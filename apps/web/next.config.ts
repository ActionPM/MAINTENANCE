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
};

export default nextConfig;

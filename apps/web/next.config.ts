import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@wo-agent/core', '@wo-agent/schemas'],
};

export default nextConfig;

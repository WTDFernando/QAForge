import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  // The browser only ever talks to this origin; requests are proxied to the NestJS API
  // (single source of truth). This keeps auth cookies first-party and avoids CORS.
  async rewrites() {
    return [
      { source: '/api/auth/:path*', destination: `${API_URL}/api/auth/:path*` },
      { source: '/v1/:path*', destination: `${API_URL}/v1/:path*` },
    ];
  },
};

export default nextConfig;

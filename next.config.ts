import type { NextConfig } from 'next';
import path from 'node:path';

// On Render, Next runs ESLint during `next build`. We relax ESLint for builds
// to avoid blocking deploys on stylistic rules. Local dev still reports lint errors.
const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve?.alias ?? {}),
      '@': path.resolve(__dirname, 'src'),
    };
    return config;
  },
};

export default nextConfig;

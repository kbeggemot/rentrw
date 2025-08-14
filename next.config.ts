import type { NextConfig } from 'next';

// On Render, Next runs ESLint during `next build`. We relax ESLint for builds
// to avoid blocking deploys on stylistic rules. Local dev still reports lint errors.
const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

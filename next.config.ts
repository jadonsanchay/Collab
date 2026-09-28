import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    /**
     * Linting runs as its own CI job via `npm run lint`, against the flat
     * config in `eslint.config.mjs`.
     *
     * Next 15's build-time lint runner passes eslintrc-era options that
     * ESLint 8 rejects outright once a flat config exists, so this step has
     * been printing `Invalid Options: useEslintrc, extensions` and linting
     * nothing. Turning it off removes a gate that only looked like one; the
     * same files are still linted, just by the job that works. Revisit if the
     * ESLint 9 migration deferred in Step 12 happens.
     */
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The `@/*` alias mirrors `tsconfig.json`. `import.meta.url` is unavailable in
// this file because `tsconfig.json` targets CommonJS, and `__dirname` is not
// defined once Vite loads the config as ESM — so the project root is anchored
// to the working directory, which is where `npm test` always runs from.
const projectRoot = path.resolve(process.cwd());

export default defineConfig({
  resolve: {
    alias: {
      '@': projectRoot,
    },
  },
  /**
   * `tsconfig.json` sets `jsx: preserve` because Next.js runs its own
   * transform, and esbuild honours that — which leaves raw JSX in anything
   * Vitest loads. This plugin transforms it instead, so component tests need
   * no React import.
   */
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'build/**', 'e2e/**'],
  },
});

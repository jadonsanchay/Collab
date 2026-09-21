import path from 'path';
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
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**', 'build/**', 'e2e/**'],
  },
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server/index.ts'],
  outDir: 'build',
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  /**
   * Bundling is the whole point. The server imports runtime code from
   * `common/` through the `@/*` alias, and `tsc` emits that verbatim as
   * `require("@/common/...")`, which Node cannot resolve. esbuild reads the
   * alias from `tsconfig.json` and inlines those modules instead.
   *
   * Everything in node_modules stays external: `next` in particular resolves
   * chunks at runtime, and bundling it would break that.
   */
  skipNodeModulesBundle: true,
});

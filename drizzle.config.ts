import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` diffs the schema against the last snapshot and
 * writes SQL to `server/db/migrations`; no database is needed for that. The
 * server applies the folder at startup for both Postgres and PGlite.
 */
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://collab:collab@localhost:5432/collab',
  },
});

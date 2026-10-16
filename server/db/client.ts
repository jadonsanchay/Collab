import { mkdirSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Pool } from 'pg';

import { logger } from '../logger';
import * as schema from './schema';

export type Schema = typeof schema;

/**
 * Both drivers produce a Drizzle database over the same schema, so every
 * query in `server/db` and `server/boards` is written once and runs on
 * hosted Postgres or on the embedded engine.
 */
export type Db = NodePgDatabase<Schema> | PgliteDatabase<Schema>;

export type Database = {
  db: Db;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
};

/**
 * Migrations live in the source tree and are applied at startup. The path
 * is resolved from the working directory rather than `__dirname`, because
 * the server is bundled to `build/` and the folder is not.
 */
export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'server/db/migrations');

export const createPostgres = async (connectionString: string): Promise<Database> => {
  // Hosted Postgres (Neon and friends) drops idle connections from its side;
  // retiring ours first avoids the first query after a quiet spell failing
  // with ECONNRESET. An errored idle client is logged, not fatal.
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  pool.on('error', (error) => logger.warn({ err: error }, 'postgres pool: idle client error'));
  const db = drizzlePg(pool, { schema });

  await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info('postgres ready, migrations applied');

  return {
    db,
    kind: 'postgres',
    close: () => pool.end(),
  };
};

/**
 * Embedded Postgres, in-process. `dataDir` is a directory for durable
 * storage, or omitted for an in-memory instance (tests). No daemon, no
 * container: the zero-infrastructure way to have boards survive a restart.
 */
export const createPglite = async (dataDir?: string): Promise<Database> => {
  // PGlite creates its own directory but not the parents; `.data/pglite`
  // on a fresh checkout would otherwise fail at startup.
  if (dataDir) mkdirSync(dataDir, { recursive: true });

  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;

  const db = drizzlePglite(client, { schema });

  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info({ dataDir: dataDir ?? 'memory' }, 'pglite ready, migrations applied');

  return {
    db,
    kind: 'pglite',
    close: () => client.close(),
  };
};

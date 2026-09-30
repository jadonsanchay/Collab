import { type Config, resolveStorage } from '../config';
import { createPglite, createPostgres, type Database } from '../db/client';
import { logger } from '../logger';
import type { ObjectStorage } from '../storage';
import { DbPersistence } from './dbPersistence';
import type { Persistence } from './persistence';

/** Where the embedded engine keeps its files when `PGLITE_DIR` is not set. */
export const DEFAULT_PGLITE_DIR = '.data/pglite';

/**
 * Builds the durability layer the configuration asks for, or null for
 * memory-only rooms. Connecting and migrating happen here, before the
 * server accepts a socket, so a bad `DATABASE_URL` fails at startup.
 */
export const createPersistence = async (
  config: Config,
  storage?: ObjectStorage,
): Promise<{ persistence: Persistence; database: Database } | null> => {
  const kind = resolveStorage(config);

  if (kind === 'memory') {
    logger.info('storage: memory (rooms are lost on restart)');
    return null;
  }

  if (kind === 'postgres') {
    if (!config.DATABASE_URL) {
      throw new Error('STORAGE=postgres requires DATABASE_URL');
    }

    const database = await createPostgres(config.DATABASE_URL);

    return { persistence: new DbPersistence(database, { storage }), database };
  }

  const database = await createPglite(config.PGLITE_DIR ?? DEFAULT_PGLITE_DIR);

  return { persistence: new DbPersistence(database, { storage }), database };
};

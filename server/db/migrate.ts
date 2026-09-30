import { loadConfig, resolveStorage } from '../config';
import { logger } from '../logger';
import { createPglite, createPostgres } from './client';

/**
 * `npm run db:migrate`: applies pending migrations to the configured
 * database and exits. The server does the same at startup; this exists for
 * deploy pipelines that migrate before the new version starts.
 */
const run = async () => {
  const config = loadConfig();
  const storage = resolveStorage(config);

  if (storage === 'memory') {
    logger.warn('STORAGE resolves to memory; nothing to migrate');
    return;
  }

  const database =
    storage === 'postgres' && config.DATABASE_URL
      ? await createPostgres(config.DATABASE_URL)
      : await createPglite(config.PGLITE_DIR);

  await database.close();
  logger.info({ storage }, 'migrations applied');
};

run().catch((error) => {
  logger.error({ err: error }, 'migration failed');
  process.exit(1);
});

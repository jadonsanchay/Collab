import next from 'next';

import { createAppServer } from './app';
import { createPersistence } from './boards/createPersistence';
import { loadConfig } from './config';
import { logger } from './logger';
import { createRedis } from './redis';
import { createStorage } from './storage';

// Parsed once, up front: a typo in a deploy variable should fail here rather
// than become a NaN inside a timer an hour later.
const config = loadConfig();

const port = config.PORT;
const dev = config.NODE_ENV !== 'production';

const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

const start = async () => {
  await nextApp.prepare();

  // Hot reload rides a WebSocket on the same port; only dev has one, and
  // Next only hands it out once prepared.
  const nextUpgradeHandler = dev ? nextApp.getUpgradeHandler() : null;

  // Connects and migrates before a single socket is accepted, so a bad
  // database setting fails here rather than on the first join.
  const storage = createStorage(config);
  const persisted = await createPersistence(config, storage);
  const redis = config.REDIS_URL ? await createRedis(config.REDIS_URL) : null;

  const readinessChecks = [
    ...(persisted
      ? [
          {
            name: 'database',
            check: async () => {
              await persisted.database.db.execute('select 1');
            },
          },
        ]
      : []),
    ...(redis
      ? [
          {
            name: 'redis',
            check: async () => {
              await redis.client.ping();
            },
          },
        ]
      : []),
  ];

  const { server, boards, snapshots, vectorDocs } = createAppServer({
    nextHandler,
    nextUpgradeHandler,
    config,
    persistence: persisted?.persistence ?? null,
    database: persisted?.database ?? null,
    storage,
    redis,
    readinessChecks,
  });

  server.listen(port, () => {
    logger.info(
      { port, dev, storage: boards.storageKind },
      `Ready on http://localhost:${port}`,
    );
  });

  // A deploy sends SIGTERM: write what is buffered before going away.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();

    try {
      snapshots?.stop();
      await vectorDocs.stop();
      await boards.stop();
      await redis?.close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};

start().catch((error) => {
  logger.error({ err: error }, 'failed to start');
  process.exit(1);
});

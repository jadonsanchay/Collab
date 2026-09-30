import next from 'next';

import { createAppServer } from './app';
import { createPersistence } from './boards/createPersistence';
import { loadConfig } from './config';
import { logger } from './logger';
import { createRedis } from './redis';

// Parsed once, up front: a typo in a deploy variable should fail here rather
// than become a NaN inside a timer an hour later.
const config = loadConfig();

const port = config.PORT;
const dev = config.NODE_ENV !== 'production';

const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

const start = async () => {
  await nextApp.prepare();

  // Connects and migrates before a single socket is accepted, so a bad
  // database setting fails here rather than on the first join.
  const persisted = await createPersistence(config);
  const redis = config.REDIS_URL ? await createRedis(config.REDIS_URL) : null;

  const { server, boards } = createAppServer({
    nextHandler,
    config,
    persistence: persisted?.persistence ?? null,
    redis,
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

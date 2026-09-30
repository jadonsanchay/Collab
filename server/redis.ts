import Redis from 'ioredis';

import { logger } from './logger';

export type RedisClients = {
  /** General commands: rate limits, health checks. */
  client: Redis;
  /** The Socket.IO adapter needs a dedicated pair. */
  pub: Redis;
  sub: Redis;
  close: () => Promise<void>;
};

/**
 * Three connections, all up before the server listens: with `REDIS_URL` set,
 * a Redis that cannot be reached is a startup failure, not a degraded run
 * nobody notices.
 */
export const createRedis = async (url: string): Promise<RedisClients> => {
  const make = () =>
    new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

  const client = make();
  const pub = make();
  const sub = make();

  [client, pub, sub].forEach((connection) => {
    connection.on('error', (error) => {
      logger.warn({ err: error }, 'redis connection error');
    });
  });

  await Promise.all([client.connect(), pub.connect(), sub.connect()]);
  logger.info('redis ready');

  return {
    client,
    pub,
    sub,
    close: async () => {
      await Promise.all([client.quit(), pub.quit(), sub.quit()]);
    },
  };
};

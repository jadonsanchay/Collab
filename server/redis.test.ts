import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import Redis from 'ioredis';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  Features,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from './app';
import { DbPersistence } from './boards/dbPersistence';
import { loadConfig } from './config';
import { createPglite, type Database } from './db/client';
import { createRedis, type RedisClients } from './redis';
import { resetRateLimits } from './socket/rateLimit';
import { makeMove } from './testing/fixtures';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Redis comes from `TEST_REDIS_URL` (CI service container) or from a
 * `redis-server` binary on this machine, started on a spare port for the
 * duration of the file. Without either, the file is skipped rather than
 * failed: memory mode is the default and needs none of this.
 */
const redisBinary = spawnSync('which', ['redis-server']).stdout?.toString().trim();
const redisAvailable = Boolean(process.env.TEST_REDIS_URL || redisBinary);

const startLocalRedis = async (): Promise<{ url: string; stop: () => void }> => {
  if (process.env.TEST_REDIS_URL) return { url: process.env.TEST_REDIS_URL, stop: () => {} };

  const port = 6400 + Math.floor(Math.random() * 1000);
  const child: ChildProcess = spawn(
    redisBinary,
    ['--port', String(port), '--save', '', '--appendonly', 'no', '--loglevel', 'warning'],
    { stdio: 'ignore' },
  );

  const url = `redis://127.0.0.1:${port}`;
  const probe = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- readiness poll
      await probe.connect();
      // eslint-disable-next-line no-await-in-loop
      await probe.ping();
      break;
    } catch {
      probe.disconnect();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }

  probe.disconnect();

  return { url, stop: () => child.kill() };
};

const config = { ...loadConfig({ DEFAULT_ENGINE: 'raster' }), USER_GRACE_MS: 200, ROOM_GRACE_MS: 500, SWEEP_INTERVAL_MS: 50 };

const waitFor = <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${String(event)}`)), 5000);

    socket.once(event, ((...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args as Parameters<ServerToClientEvents[E]>);
    }) as never);
  });

const connect = async (
  server: ReturnType<typeof createAppServer>,
  userId = randomUUID(),
) => {
  const { port } = server.server.address() as AddressInfo;
  const socket: ClientSocket = connectClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { userId, protocolVersion: PROTOCOL_VERSION },
  });

  const features = new Promise<Features>((resolve) => {
    socket.once('features', resolve);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return Object.assign(socket, { userId, features });
};

describe.skipIf(!redisAvailable)('two nodes sharing Redis and one database', () => {
  let local: { url: string; stop: () => void };
  let database: Database;
  let redisA: RedisClients;
  let redisB: RedisClients;
  let nodeA: ReturnType<typeof createAppServer>;
  let nodeB: ReturnType<typeof createAppServer>;

  beforeAll(async () => {
    local = await startLocalRedis();
    database = await createPglite();
    redisA = await createRedis(local.url);
    redisB = await createRedis(local.url);

    const listen = (server: ReturnType<typeof createAppServer>) =>
      new Promise<void>((resolve) => {
        server.server.listen(0, () => resolve());
      });

    nodeA = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: { ...config, NODE_ID: 'node-a' },
      persistence: new DbPersistence(database, { flushMs: 5 }),
      redis: redisA,
    });
    nodeB = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config: { ...config, NODE_ID: 'node-b' },
      persistence: new DbPersistence(database, { flushMs: 5 }),
      redis: redisB,
    });

    await Promise.all([listen(nodeA), listen(nodeB)]);
  }, 60_000);

  afterAll(async () => {
    const stop = async (server: ReturnType<typeof createAppServer>) => {
      server.rooms.stop();
      await server.boards.flush();
      await new Promise<void>((resolve) => {
        server.io.close(() => resolve());
      });
    };

    await Promise.all([stop(nodeA), stop(nodeB)]);
    await Promise.all([redisA.close(), redisB.close()]);
    await database.close();
    local.stop();
    resetRateLimits();
  });

  it('tells each client which node answered', async () => {
    const onA = await connect(nodeA);
    const onB = await connect(nodeB);

    await expect(onA.features).resolves.toMatchObject({ node: 'node-a' });
    await expect(onB.features).resolves.toMatchObject({ node: 'node-b' });

    onA.disconnect();
    onB.disconnect();
  });

  it('relays a move drawn on one node to a client on the other', async () => {
    const alice = await connect(nodeA);
    const bob = await connect(nodeB);

    const created = waitFor(alice, 'created');
    alice.emit('create_room', 'Alice');
    const [roomId] = await created;
    alice.emit('joined_room');
    await waitFor(alice, 'room');

    // Node B has never seen the room; it loads it from the shared database.
    await nodeA.boards.flush();

    const joined = waitFor(bob, 'joined');
    bob.emit('join_room', roomId, 'Bob');
    const [, failed] = await joined;
    expect(failed).toBeFalsy();
    bob.emit('joined_room');
    await waitFor(bob, 'room');

    const relayed = waitFor(bob, 'user_draw');
    alice.emit('draw', makeMove());
    const [move, author] = await relayed;

    expect(author).toBe(alice.userId);
    expect(move.seq).toBe(1);

    alice.disconnect();
    bob.disconnect();
  });

  it('counts a user’s budget once across nodes', async () => {
    const userId = randomUUID();
    const onA = await connect(nodeA, userId);
    const onB = await connect(nodeB, userId);

    const created = waitFor(onA, 'created');
    onA.emit('create_room', 'Same person');
    const [roomId] = await created;
    await nodeA.boards.flush();

    const joined = waitFor(onB, 'joined');
    onB.emit('join_room', roomId, 'Same person');
    await joined;

    // send_msg allows five a second. Spend them all on node A...
    const echoes = Array.from({ length: 5 }, () => waitFor(onA, 'new_msg'));
    for (let i = 0; i < 5; i += 1) onA.emit('send_msg', `message ${i}`);
    await Promise.all(echoes);

    // ...and the sixth, on node B, is refused because the count is shared.
    const limited = waitFor(onB, 'rate_limited');
    onB.emit('send_msg', 'one too many');

    expect((await limited)[0]).toBe('send_msg');

    onA.disconnect();
    onB.disconnect();
  });
});

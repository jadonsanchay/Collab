import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  Move,
  Room,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { loadConfig } from '../config';
import { createPglite, type Database } from '../db/client';
import { makeMove } from '../testing/fixtures';
import { DbPersistence } from './dbPersistence';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const config = { ...loadConfig({}), USER_GRACE_MS: 200, ROOM_GRACE_MS: 500, SWEEP_INTERVAL_MS: 50 };

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

const boot = (persistence: DbPersistence) => {
  const server = createAppServer({
    nextHandler: (_req, res) => {
      res.end('next');
    },
    config,
    persistence,
  });

  return new Promise<typeof server>((resolve) => {
    server.server.listen(0, () => resolve(server));
  });
};

const connect = async (server: ReturnType<typeof createAppServer>, userId = randomUUID()) => {
  const { port } = server.server.address() as AddressInfo;
  const socket: ClientSocket = connectClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { userId, protocolVersion: PROTOCOL_VERSION },
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return Object.assign(socket, { userId });
};

/** Stops a server the way a deploy would: sockets dropped, memory gone, database kept. */
const halt = async (server: ReturnType<typeof createAppServer>) => {
  server.rooms.stop();
  await server.boards.flush();
  await new Promise<void>((resolve) => {
    server.io.close(() => resolve());
  });
};

/**
 * The first user-visible win of Phase 3: a board outlives the process that
 * created it. Two servers share one database in turn, like a deploy.
 */
describe('a board survives a server restart', () => {
  let database: Database;
  let roomId: string;
  let aliceId: string;

  beforeAll(async () => {
    database = await createPglite();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  it('records a board with twenty moves and a chat line on the first server', async () => {
    const server = await boot(new DbPersistence(database, { flushMs: 5 }));
    const alice = await connect(server);
    aliceId = alice.userId;

    const created = waitFor(alice, 'created');
    alice.emit('create_room', 'Alice');
    [roomId] = await created;
    alice.emit('joined_room');
    await waitFor(alice, 'room');

    const echoes: Promise<unknown>[] = [];

    for (let i = 0; i < 20; i += 1) {
      echoes.push(waitFor(alice, 'your_move'));
      alice.emit('draw', makeMove({ path: [[i, i], [i + 5, i + 5]] }));
    }

    await Promise.all(echoes);

    const said = waitFor(alice, 'new_msg');
    alice.emit('send_msg', 'remember this');
    await said;

    alice.disconnect();
    await halt(server);
  });

  it('serves the same board from a fresh server with the sequence continued', async () => {
    const server = await boot(new DbPersistence(database, { flushMs: 5 }));

    try {
      // Nothing is in memory: the room has to come from the database.
      expect(server.rooms.has(roomId)).toBe(false);

      const bob = await connect(server);

      const exists = waitFor(bob, 'room_exists');
      bob.emit('check_room', roomId);
      expect((await exists)[0]).toBe(true);

      const joined = waitFor(bob, 'joined');
      bob.emit('join_room', roomId, 'Bob');
      const [, failed] = await joined;
      expect(failed).toBeFalsy();

      const snapshot = waitFor(bob, 'room');
      bob.emit('joined_room');
      const [room] = await snapshot;
      const typed = room as Room;

      expect(typed.drawed).toHaveLength(20);
      expect(typed.drawed.map((move: Move) => move.seq)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect(typed.drawed.every((move: Move) => move.userId === aliceId)).toBe(true);
      expect(typed.title).toBe('Untitled board');
      expect(typed.chat).toEqual([
        expect.objectContaining({ userId: aliceId, name: 'Alice', body: 'remember this' }),
      ]);

      // New work continues the sequence rather than restarting it.
      const echo = waitFor(bob, 'your_move');
      bob.emit('draw', makeMove());
      const [move] = await echo;
      expect(move.seq).toBe(21);

      bob.disconnect();
    } finally {
      await halt(server);
    }
  });

  it('keeps the new move too, on yet another server', async () => {
    const server = await boot(new DbPersistence(database, { flushMs: 5 }));

    try {
      expect(await server.boards.ensureLoaded(roomId)).toBe(true);
      expect(server.boards.get(roomId)?.drawed).toHaveLength(21);
      expect(await server.boards.ensureLoaded('nope0000')).toBe(false);
    } finally {
      await halt(server);
    }
  });
});

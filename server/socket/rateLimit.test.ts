import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { makeMove } from '../testing/fixtures';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Long enough for a burst to be delivered and broadcast, well under 1s. */
const SETTLE_MS = 400;

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, SETTLE_MS);
  });

describe('rate limiting', () => {
  let server: ReturnType<typeof createAppServer>;
  let alice: ClientSocket;
  let bob: ClientSocket;
  let roomId: string;

  const connect = async (): Promise<ClientSocket> => {
    const { port } = server.server.address() as AddressInfo;
    const socket: ClientSocket = connectClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    return socket;
  };

  beforeAll(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, resolve);
    });

    alice = await connect();
    bob = await connect();

    const created = new Promise<string>((resolve) => {
      alice.once('created', resolve);
    });
    alice.emit('create_room', 'Alice');
    roomId = await created;

    const joined = new Promise<void>((resolve) => {
      bob.once('joined', () => resolve());
    });
    bob.emit('join_room', roomId, 'Bob');
    await joined;
  });

  afterAll(async () => {
    alice.disconnect();
    bob.disconnect();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('broadcasts at most 5 chat messages from a burst of 100', async () => {
    const received: string[] = [];
    bob.on('new_msg', (_userId, msg) => received.push(msg));

    let limitNotices = 0;
    alice.on('rate_limited', () => {
      limitNotices += 1;
    });

    for (let i = 0; i < 100; i += 1) alice.emit('send_msg', `spam ${i}`);

    await settle();

    bob.off('new_msg');
    alice.off('rate_limited');

    expect(received.length).toBeLessThanOrEqual(5);
    // Not zero either: the limit sheds the flood, it does not break chat.
    expect(received.length).toBeGreaterThan(0);
    // The sender is told, so a swallowed message never looks like a bug.
    expect(limitNotices).toBeGreaterThan(0);
  });

  it('caps a burst of 100 draws at 20', async () => {
    const stored = () =>
      server.rooms.get(roomId)?.usersMoves.get(bob.id as string)?.length ?? 0;

    const before = stored();

    for (let i = 0; i < 100; i += 1) bob.emit('draw', makeMove());

    await settle();

    const accepted = stored() - before;

    expect(accepted).toBeLessThanOrEqual(20);
    expect(accepted).toBeGreaterThan(0);
  });

  it('does not notify the sender about dropped draws or cursor moves', async () => {
    let notices = 0;
    bob.on('rate_limited', () => {
      notices += 1;
    });

    for (let i = 0; i < 100; i += 1) bob.emit('mouse_move', i, i);

    await settle();

    bob.off('rate_limited');

    // Only send_msg gets a notice; a toast per dropped cursor packet would be
    // unusable.
    expect(notices).toBe(0);
  });

  it('limits room entry, so a client cannot spin up rooms in a loop', async () => {
    const spammer = await connect();

    try {
      const created: string[] = [];
      spammer.on('created', (id) => created.push(id));

      for (let i = 0; i < 30; i += 1) spammer.emit('create_room', 'Spammer');

      await settle();

      spammer.off('created');

      expect(created.length).toBeLessThanOrEqual(5);
      expect(created.length).toBeGreaterThan(0);
    } finally {
      spammer.disconnect();
    }
  });
});

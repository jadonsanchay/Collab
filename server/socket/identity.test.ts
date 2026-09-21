import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  User,
} from '@/common/types/global';

import { createAppServer } from '../app';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('handshake identity', () => {
  let server: ReturnType<typeof createAppServer>;

  const url = () => {
    const { port } = server.server.address() as AddressInfo;

    return `http://localhost:${port}`;
  };

  /** Resolves with the connection outcome rather than throwing on refusal. */
  const attempt = (auth: Record<string, unknown>) =>
    new Promise<{ connected: boolean; reason?: string }>((resolve) => {
      const socket = connectClient(url(), {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        auth,
      });

      socket.once('connect', () => {
        socket.disconnect();
        resolve({ connected: true });
      });

      socket.once('connect_error', (error) => {
        socket.disconnect();
        resolve({ connected: false, reason: error.message });
      });
    });

  beforeAll(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('accepts a valid user id and protocol version', async () => {
    await expect(
      attempt({ userId: randomUUID(), protocolVersion: PROTOCOL_VERSION }),
    ).resolves.toEqual({ connected: true });
  });

  it('refuses a client speaking a different protocol version', async () => {
    // A tab left open across a deploy. Letting it connect is how two clients
    // end up with quietly different pictures of the same room.
    const result = await attempt({
      userId: randomUUID(),
      protocolVersion: PROTOCOL_VERSION + 1,
    });

    expect(result.connected).toBe(false);
    expect(result.reason).toBe('protocol_mismatch');
  });

  it('refuses a client that sends no protocol version at all', async () => {
    const result = await attempt({ userId: randomUUID() });

    expect(result.connected).toBe(false);
    expect(result.reason).toBe('protocol_mismatch');
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['a non-uuid string', 'alice'],
    ['a number', 42],
  ])('refuses a user id that is %s', async (_label, userId) => {
    const result = await attempt({
      userId,
      protocolVersion: PROTOCOL_VERSION,
    });

    expect(result.connected).toBe(false);
    expect(result.reason).toBe('invalid_user_id');
  });
});

describe('server-assigned colours', () => {
  let server: ReturnType<typeof createAppServer>;

  const connect = async () => {
    const { port } = server.server.address() as AddressInfo;
    const userId = randomUUID();
    const socket: ClientSocket = connectClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { userId, protocolVersion: PROTOCOL_VERSION },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    return Object.assign(socket, { userId });
  };

  const once = <E extends keyof ServerToClientEvents>(
    socket: ClientSocket,
    event: E,
  ) =>
    new Promise<Parameters<ServerToClientEvents[E]>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${String(event)}"`)),
        2000,
      );

      socket.once(event, ((...args: unknown[]) => {
        clearTimeout(timer);
        resolve(args as Parameters<ServerToClientEvents[E]>);
      }) as never);
    });

  beforeAll(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('reports the same colour for a third user to everyone who can see them', async () => {
    const alice = await connect();
    const bob = await connect();
    const carol = await connect();

    try {
      const created = once(alice, 'created');
      alice.emit('create_room', 'Alice');
      const [roomId] = await created;
      alice.emit('joined_room');
      await once(alice, 'room');

      // Bob joins and reads Carol's colour from the snapshot he is sent.
      const bobJoined = once(bob, 'joined');
      bob.emit('join_room', roomId, 'Bob');
      await bobJoined;

      const carolJoined = once(carol, 'joined');
      carol.emit('join_room', roomId, 'Carol');
      await carolJoined;

      // Alice learns Carol's colour from the broadcast; Bob learns it from his
      // own snapshot. Before the server assigned colours, these two paths
      // disagreed, and the same person appeared in different colours.
      const aliceSawCarol = once(alice, 'new_user');
      carol.emit('joined_room');
      const [carolId, , colorFromBroadcast] = await aliceSawCarol;

      const bobSnapshot = once(bob, 'room');
      bob.emit('joined_room');
      const [, , usersJson] = await bobSnapshot;

      const users = new Map<string, User>(JSON.parse(usersJson));

      expect(carolId).toBe(carol.userId);
      expect(users.get(carol.userId)?.color).toBe(colorFromBroadcast);
    } finally {
      alice.disconnect();
      bob.disconnect();
      carol.disconnect();
    }
  });
});

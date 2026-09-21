import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@/common/constants/protocol';
import type {
  ClientToServerEvents,
  Move,
  ServerToClientEvents,
  User,
} from '@/common/types/global';

import { createAppServer } from '../app';
import { loadConfig } from '../config';
import { makeMove } from '../testing/fixtures';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Identified = ClientSocket & { userId: string };

/**
 * Grace windows in milliseconds rather than the production minute, so the
 * expiry paths are exercised for real instead of with fake timers — real
 * sockets and fake timers do not mix well.
 */
const config = {
  ...loadConfig({}),
  USER_GRACE_MS: 120,
  ROOM_GRACE_MS: 150,
  SWEEP_INTERVAL_MS: 20,
};

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('reconnect and resume', () => {
  let server: ReturnType<typeof createAppServer>;

  const connect = async (userId: string = randomUUID()): Promise<Identified> => {
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

  /** Creates a room and returns its id, with the owner already inside. */
  const openRoom = async (owner: Identified) => {
    const created = once(owner, 'created');
    owner.emit('create_room', 'Owner');
    const [roomId] = await created;
    owner.emit('joined_room');
    await once(owner, 'room');

    return roomId;
  };

  beforeEach(async () => {
    server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
      config,
    });

    await new Promise<void>((resolve) => {
      server.server.listen(0, resolve);
    });
  });

  afterEach(async () => {
    server.rooms.stop();
    await new Promise<void>((resolve) => {
      server.io.close(() => resolve());
    });
  });

  it('sends a reconnecting client only the moves it missed', async () => {
    const alice = await connect();
    let bob = await connect();

    const roomId = await openRoom(alice);

    const joined = once(bob, 'joined');
    bob.emit('join_room', roomId, 'Bob');
    await joined;
    bob.emit('joined_room');
    await once(bob, 'room');

    // Bob sees one move, then drops.
    const firstSeen = once(bob, 'user_draw');
    alice.emit('draw', makeMove());
    const [firstMove] = await firstSeen;

    bob.disconnect();
    await wait(20);

    // Two more moves land while Bob is away.
    const second = once(alice, 'your_move');
    alice.emit('draw', makeMove());
    await second;
    const third = once(alice, 'your_move');
    alice.emit('draw', makeMove());
    await third;

    // Bob returns with the same identity, reporting what he already had.
    bob = await connect(bob.userId);
    const delta = once(bob, 'room_delta');
    bob.emit('rejoin_room', roomId, firstMove.seq);
    const [usersMovesJson, drawedJson, usersJson] = await delta;

    const byUser = new Map<string, Move[]>(JSON.parse(usersMovesJson));
    const missed = [...byUser.values()].flat();
    const users = new Map<string, User>(JSON.parse(usersJson));

    // Exactly the gap: not the move he already had, and not the whole board.
    expect(missed.map((move) => move.seq)).toEqual([2, 3]);
    expect(JSON.parse(drawedJson)).toEqual([]);
    expect(users.has(bob.userId)).toBe(true);
    expect(users.has(alice.userId)).toBe(true);

    alice.disconnect();
    bob.disconnect();
  });

  it('keeps the place and the colour of a user who returns in time', async () => {
    const alice = await connect();
    let bob = await connect();

    const roomId = await openRoom(alice);

    const joined = once(bob, 'joined');
    bob.emit('join_room', roomId, 'Bob');
    await joined;

    const announced = once(alice, 'new_user');
    bob.emit('joined_room');
    const [, , colorBefore] = await announced;

    // Alice is told he is offline, not that he left.
    const offline = once(alice, 'user_offline');
    bob.disconnect();
    await expect(offline).resolves.toEqual([bob.userId]);

    bob = await connect(bob.userId);
    const online = once(alice, 'user_online');
    bob.emit('rejoin_room', roomId, 0);
    await once(bob, 'room_delta');

    await expect(online).resolves.toEqual([bob.userId]);
    expect(server.rooms.get(roomId)?.users.get(bob.userId)?.color).toBe(
      colorBefore,
    );

    alice.disconnect();
    bob.disconnect();
  });

  it('announces a real departure only once the grace window expires', async () => {
    const alice = await connect();
    const bob = await connect();

    const roomId = await openRoom(alice);

    const joined = once(bob, 'joined');
    bob.emit('join_room', roomId, 'Bob');
    await joined;
    bob.emit('joined_room');
    await once(alice, 'new_user');

    const gone = once(alice, 'user_disconnected');
    bob.disconnect();

    // The window has to pass first: this is what makes a blip survivable.
    await expect(gone).resolves.toEqual([bob.userId]);
    expect(server.rooms.get(roomId)?.users.has(bob.userId)).toBe(false);

    alice.disconnect();
  });

  it('refuses to resume a session that has already expired', async () => {
    const alice = await connect();
    let bob = await connect();

    const roomId = await openRoom(alice);

    const joined = once(bob, 'joined');
    bob.emit('join_room', roomId, 'Bob');
    await joined;

    bob.disconnect();
    // Longer than the grace window, so the place is given up.
    await wait(config.USER_GRACE_MS + 80);

    bob = await connect(bob.userId);
    const failed = once(bob, 'joined');
    bob.emit('rejoin_room', roomId, 0);

    // Falls back to the name gate rather than resuming a session that is gone.
    await expect(failed).resolves.toEqual(['', true]);

    alice.disconnect();
    bob.disconnect();
  });

  it('frees a room once everyone has gone and the grace period passes', async () => {
    const alice = await connect();
    const roomId = await openRoom(alice);

    alice.emit('draw', makeMove());
    await once(alice, 'your_move');

    alice.disconnect();

    await wait(config.USER_GRACE_MS + config.ROOM_GRACE_MS + 120);

    // Rooms used to be kept until the process restarted.
    expect(server.rooms.has(roomId)).toBe(false);
  });
});

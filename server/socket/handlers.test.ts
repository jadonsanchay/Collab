import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { io as connectClient, type Socket } from 'socket.io-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import type { RoomStore } from '../rooms/RoomStore';
import { MAX_ROOM_USERS } from '../rooms/RoomStore';
import { createAppServer } from '../app';
import { logger } from '../logger';
import { makeMove } from '../testing/fixtures';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const EVENT_TIMEOUT_MS = 2000;

/** Resolves with the arguments of the next `event` on `socket`. */
const waitFor = <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${String(event)}"`)),
      EVENT_TIMEOUT_MS,
    );

    socket.once(event, ((...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args as Parameters<ServerToClientEvents[E]>);
    }) as never);
  });

/** Asserts `event` does not arrive within `ms`. */
const expectNoEvent = async <E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  ms = 250,
): Promise<void> => {
  let fired = false;
  const listener = () => {
    fired = true;
  };

  socket.on(event, listener as never);

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

  socket.off(event, listener as never);

  expect(fired, `expected no "${String(event)}" event`).toBe(false);
};

/**
 * Drives the real server over real sockets with a stubbed Next.js handler, so
 * these assertions cover the handler wiring rather than the room logic (that is
 * `RoomStore.test.ts`). The tests share two connections and run in file order
 * on purpose: the protocol is stateful, so the room has to exist before anyone
 * can draw in it.
 */
describe('socket handlers', () => {
  let httpServer: HttpServer;
  let closeIo: () => Promise<void>;
  let rooms: RoomStore;
  let alice: ClientSocket;
  let bob: ClientSocket;
  let roomId: string;

  const connect = async (): Promise<ClientSocket> => {
    const { port } = httpServer.address() as AddressInfo;
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
    const server = createAppServer({
      nextHandler: (_req, res) => {
        res.end('next');
      },
    });

    httpServer = server.server;
    rooms = server.rooms;
    // `io.close` also closes the HTTP server it is attached to.
    closeIo = () =>
      new Promise<void>((resolve) => {
        server.io.close(() => resolve());
      });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });

    alice = await connect();
    bob = await connect();
  });

  afterAll(async () => {
    alice.disconnect();
    bob.disconnect();
    await closeIo();
  });

  it('creates a room and reports that it exists', async () => {
    const created = waitFor(alice, 'created');
    alice.emit('create_room', 'Alice');
    [roomId] = await created;

    expect(roomId).toHaveLength(4);

    const exists = waitFor(alice, 'room_exists');
    alice.emit('check_room', roomId);

    await expect(exists).resolves.toEqual([true]);
  });

  it('reports a room that does not exist', async () => {
    const exists = waitFor(alice, 'room_exists');
    alice.emit('check_room', 'zzzz');

    await expect(exists).resolves.toEqual([false]);
  });

  it('sends the room snapshot to the creator on joined_room', async () => {
    const snapshot = waitFor(alice, 'room');
    alice.emit('joined_room');
    const [, usersMovesToParse, usersToParse] = await snapshot;

    // Maps do not survive the socket encoder, which is why the handler sends
    // them as JSON alongside the room object.
    expect(JSON.parse(usersToParse)).toEqual([[alice.id, 'Alice']]);
    expect(JSON.parse(usersMovesToParse)).toEqual([[alice.id, []]]);
  });

  it('lets a second client join and announces them to the first', async () => {
    const joined = waitFor(bob, 'joined');
    bob.emit('join_room', roomId, 'Bob');

    await expect(joined).resolves.toEqual([roomId]);

    const newUser = waitFor(alice, 'new_user');
    bob.emit('joined_room');

    await expect(newUser).resolves.toEqual([bob.id, 'Bob']);
  });

  it('rejects a join for an unknown room and echoes the attempted id', async () => {
    const stranger = await connect();

    try {
      const joined = waitFor(stranger, 'joined');
      stranger.emit('join_room', 'zzzz', 'Stranger');

      // The id comes back so the client's modal can name the room it failed to
      // join, rather than quoting an empty string.
      await expect(joined).resolves.toEqual(['zzzz', true]);
    } finally {
      stranger.disconnect();
    }
  });

  it(`rejects a join once a room holds ${MAX_ROOM_USERS} users, echoing the id`, async () => {
    // Uses its own room and its own clients: filling the shared room would
    // race with the disconnects of the tests around it.
    const clients: ClientSocket[] = [];

    /* eslint-disable no-await-in-loop -- the cap depends on how many have
       already joined, so these have to be sequential. */
    try {
      const owner = await connect();
      clients.push(owner);

      const created = waitFor(owner, 'created');
      owner.emit('create_room', 'Owner');
      const [fullRoomId] = await created;

      for (let i = 1; i < MAX_ROOM_USERS; i += 1) {
        const joiner = await connect();
        clients.push(joiner);

        const joined = waitFor(joiner, 'joined');
        joiner.emit('join_room', fullRoomId, `User ${i}`);
        await expect(joined).resolves.toEqual([fullRoomId]);
      }

      expect(rooms.get(fullRoomId)?.users.size).toBe(MAX_ROOM_USERS);

      const tooMany = await connect();
      clients.push(tooMany);

      const rejected = waitFor(tooMany, 'joined');
      tooMany.emit('join_room', fullRoomId, 'One too many');

      await expect(rejected).resolves.toEqual([fullRoomId, true]);
    } finally {
      clients.forEach((client) => client.disconnect());
    }
    /* eslint-enable no-await-in-loop */
  });

  it('echoes a draw to its author and broadcasts it to the room', async () => {
    const yourMove = waitFor(alice, 'your_move');
    const userDraw = waitFor(bob, 'user_draw');

    alice.emit('draw', makeMove({ path: [[1, 1]] }));
    const [echoed] = await yourMove;
    const [broadcast, authorId] = await userDraw;

    // The server owns id and timestamp, so the client's values are replaced.
    expect(echoed.id).not.toBe('');
    expect(echoed.timestamp).toBeGreaterThan(0);
    expect(echoed.path).toEqual([[1, 1]]);
    expect(broadcast).toEqual(echoed);
    expect(authorId).toBe(alice.id);
  });

  it('stores the drawn move against its author', () => {
    expect(rooms.get(roomId)?.usersMoves.get(alice.id as string)).toHaveLength(
      1,
    );
  });

  it('broadcasts an undo and pops the stored move', async () => {
    const undone = waitFor(bob, 'user_undo');
    alice.emit('undo');

    await expect(undone).resolves.toEqual([alice.id]);
    expect(rooms.get(roomId)?.usersMoves.get(alice.id as string)).toEqual([]);
  });

  it('broadcasts a chat message to everyone including the sender', async () => {
    const forBob = waitFor(bob, 'new_msg');
    const forAlice = waitFor(alice, 'new_msg');

    bob.emit('send_msg', 'hello');

    await expect(forBob).resolves.toEqual([bob.id, 'hello']);
    await expect(forAlice).resolves.toEqual([bob.id, 'hello']);
  });

  it('broadcasts mouse movement to others only', async () => {
    const moved = waitFor(bob, 'mouse_moved');
    alice.emit('mouse_move', 12, 34);

    await expect(moved).resolves.toEqual([12, 34, alice.id]);
  });

  it('keeps the moves of a user who leaves, and tells the room', async () => {
    const departing = await connect();
    const joined = waitFor(departing, 'joined');
    departing.emit('join_room', roomId, 'Departing');
    await joined;

    const theirMove = waitFor(departing, 'your_move');
    departing.emit('draw', makeMove());
    await theirMove;

    const disconnected = waitFor(alice, 'user_disconnected');
    departing.emit('leave_room');

    await expect(disconnected).resolves.toEqual([departing.id]);
    // This is the mechanism that keeps a drawing on the board after its author
    // is gone.
    expect(rooms.get(roomId)?.drawed).toHaveLength(1);

    departing.disconnect();
  });

  it('announces a disconnect and drops the user', async () => {
    const leaving = await connect();
    const joined = waitFor(leaving, 'joined');
    leaving.emit('join_room', roomId, 'Leaving');
    await joined;

    const leavingId = leaving.id as string;
    const disconnected = waitFor(alice, 'user_disconnected');
    leaving.disconnect();

    await expect(disconnected).resolves.toEqual([leavingId]);
    expect(rooms.get(roomId)?.users.has(leavingId)).toBe(false);
  });

  // Before Step 2, `getRoomId` fell back to the socket's own id, so these
  // events reached room state that never existed and took the process down.
  describe('a socket that has joined no room', () => {
    let loner: ClientSocket;
    let loggedErrors: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      loner = await connect();
    });

    afterAll(() => {
      loner.disconnect();
    });

    beforeEach(() => {
      // `safeHandler` logs here when a handler throws. Asserting it stays quiet
      // is what separates "the guards returned early" from "it threw and the
      // wrapper swallowed it" — both of which look identical from outside.
      loggedErrors = vi.spyOn(logger, 'error');
    });

    afterEach(() => {
      loggedErrors.mockRestore();
    });

    /**
     * Proves the connection is still served, and that nothing threw on the way
     * here.
     */
    const expectStillServed = async () => {
      const exists = waitFor(loner, 'room_exists');
      loner.emit('check_room', roomId);

      await expect(exists).resolves.toEqual([true]);
      expect(loggedErrors).not.toHaveBeenCalled();
    };

    it('survives a draw and stores nothing', async () => {
      loner.emit('draw', makeMove());

      await expectNoEvent(loner, 'your_move');
      // The old socket-id fallback would have looked up a room under this id.
      expect(rooms.get(loner.id as string)).toBeUndefined();
      await expectStillServed();
    });

    it('survives an undo', async () => {
      loner.emit('undo');

      await expectNoEvent(loner, 'user_undo');
      await expectStillServed();
    });

    it('survives joined_room and sends no snapshot', async () => {
      loner.emit('joined_room');

      await expectNoEvent(loner, 'room');
      await expectStillServed();
    });

    it('survives leave_room', async () => {
      loner.emit('leave_room');

      await expectNoEvent(loner, 'user_disconnected');
      await expectStillServed();
    });

    it('survives mouse_move and send_msg, and broadcasts neither', async () => {
      loner.emit('mouse_move', 1, 2);
      loner.emit('send_msg', 'into the void');

      await expectNoEvent(loner, 'new_msg');
      // Nobody in the real room hears from a socket that never joined it.
      await expectNoEvent(alice, 'new_msg');
      await expectStillServed();
    });
  });
});

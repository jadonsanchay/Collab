import { randomBytes } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROOM_ID_LENGTH, roomIdSchema } from '@/common/schemas/user';

import { makeMove } from '../testing/fixtures';
import { MAX_ROOM_USERS, RoomStore } from './RoomStore';

// Only `randomBytes` is replaced, and only so the collision retry below can be
// driven deliberately. Every other test uses the real generator.
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();

  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

// `randomBytes` is overloaded, and `vi.mocked` picks the callback overload
// that returns void, so the synchronous one is selected explicitly here.
const randomBytesMock = vi.mocked(randomBytes as (size: number) => Buffer);

afterEach(() => {
  // Vitest resets to the implementation `vi.fn` was created with, which is the
  // real `randomBytes`.
  randomBytesMock.mockReset();
  vi.restoreAllMocks();
});

describe('RoomStore.create', () => {
  it('registers the room with the creator as its only user', () => {
    const store = new RoomStore();

    const roomId = store.create('socket-a', 'Alice');
    const room = store.get(roomId);

    expect(store.has(roomId)).toBe(true);
    expect(room?.users.get('socket-a')).toBe('Alice');
    expect(room?.usersMoves.get('socket-a')).toEqual([]);
    expect(room?.drawed).toEqual([]);
  });

  it('generates an 8-character base64url id', () => {
    const store = new RoomStore();

    const roomId = store.create('socket-a', 'Alice');

    expect(roomId).toHaveLength(ROOM_ID_LENGTH);
    expect(roomId).toMatch(/^[A-Za-z0-9_-]{8}$/);
    // The id has to satisfy the schema the server validates incoming ids
    // against, or a room would be unjoinable the moment it is created.
    expect(roomIdSchema.safeParse(roomId).success).toBe(true);
  });

  it('generates distinct ids', () => {
    const store = new RoomStore();

    const ids = new Set(
      Array.from({ length: 500 }, (_, i) => store.create(`socket-${i}`, 'User')),
    );

    expect(ids.size).toBe(500);
  });

  it('retries when the generated id collides with an existing room', () => {
    const store = new RoomStore();
    const collision = Buffer.from([1, 2, 3, 4, 5, 6]);
    const resolution = Buffer.from([9, 9, 9, 9, 9, 9]);
    // Same bytes twice, so the second create has to loop once before landing
    // on the third, different value. Unreachable in practice with 48 bits of
    // entropy, but the retry is the only thing standing between a collision
    // and one room silently replacing another.
    randomBytesMock
      .mockReturnValueOnce(collision)
      .mockReturnValueOnce(collision)
      .mockReturnValueOnce(resolution);

    const first = store.create('socket-a', 'Alice');
    const second = store.create('socket-b', 'Bob');

    expect(second).not.toBe(first);
    expect(store.has(first)).toBe(true);
    expect(store.has(second)).toBe(true);
  });
});

describe('RoomStore.join', () => {
  it('adds the user and initializes their move list', () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');

    expect(store.join(roomId, 'socket-b', 'Bob')).toBe(true);
    expect(store.get(roomId)?.users.get('socket-b')).toBe('Bob');
    expect(store.get(roomId)?.usersMoves.get('socket-b')).toEqual([]);
  });

  it('refuses a room that does not exist', () => {
    const store = new RoomStore();

    expect(store.join('nope', 'socket-b', 'Bob')).toBe(false);
  });

  it(`refuses a room already holding ${MAX_ROOM_USERS} users`, () => {
    const store = new RoomStore();
    const roomId = store.create('socket-0', 'User 0');

    // The creator counts as the first user, so the cap is hit after 11 joins.
    for (let i = 1; i < MAX_ROOM_USERS; i += 1) {
      expect(store.join(roomId, `socket-${i}`, `User ${i}`)).toBe(true);
    }

    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS);
    expect(store.join(roomId, 'one-too-many', 'Nope')).toBe(false);
    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS);
  });
});

describe('RoomStore.leave', () => {
  it("folds the departing user's moves into drawed so the drawing survives", () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');
    const move = makeMove({ id: 'move-1' });
    store.addMove(roomId, 'socket-a', move);

    expect(store.leave(roomId, 'socket-a')).toBe(true);
    expect(store.get(roomId)?.drawed).toEqual([move]);
    expect(store.get(roomId)?.users.has('socket-a')).toBe(false);
  });

  it('reports false for an unknown room', () => {
    const store = new RoomStore();

    expect(store.leave('nope', 'socket-a')).toBe(false);
  });

  it('removes the usersMoves entry so snapshots do not replay the moves twice', () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');
    store.addMove(roomId, 'socket-a', makeMove());

    store.leave(roomId, 'socket-a');

    // The moves live in `drawed` now and nowhere else. A snapshot sends both
    // halves, so an entry left here would render the strokes a second time.
    expect(store.get(roomId)?.usersMoves.has('socket-a')).toBe(false);
    expect(store.get(roomId)?.drawed).toHaveLength(1);
  });
});

describe('RoomStore.addMove', () => {
  it("appends to the user's move list", () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');
    const first = makeMove({ id: 'move-1' });
    const second = makeMove({ id: 'move-2' });

    expect(store.addMove(roomId, 'socket-a', first)).toBe(true);
    expect(store.addMove(roomId, 'socket-a', second)).toBe(true);

    expect(store.get(roomId)?.usersMoves.get('socket-a')).toEqual([
      first,
      second,
    ]);
  });

  it('stores the move once for a socket that has no move list yet', () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');
    const move = makeMove({ id: 'move-1' });

    expect(store.addMove(roomId, 'ghost-socket', move)).toBe(true);

    expect(store.get(roomId)?.usersMoves.get('ghost-socket')).toEqual([move]);
  });

  it('reports false for an unknown room instead of throwing', () => {
    const store = new RoomStore();

    expect(() => store.addMove('nope', 'socket-a', makeMove())).not.toThrow();
    expect(store.addMove('nope', 'socket-a', makeMove())).toBe(false);
  });
});

describe('RoomStore.undoMove', () => {
  it('pops the last move', () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');
    const first = makeMove({ id: 'move-1' });
    store.addMove(roomId, 'socket-a', first);
    store.addMove(roomId, 'socket-a', makeMove({ id: 'move-2' }));

    expect(store.undoMove(roomId, 'socket-a')).toBe(true);

    expect(store.get(roomId)?.usersMoves.get('socket-a')).toEqual([first]);
  });

  it('succeeds on an empty move list, so an undo with nothing to undo still broadcasts', () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');

    expect(store.undoMove(roomId, 'socket-a')).toBe(true);
    expect(store.get(roomId)?.usersMoves.get('socket-a')).toEqual([]);
  });

  it('reports false for an unknown room instead of throwing', () => {
    const store = new RoomStore();

    expect(() => store.undoMove('nope', 'socket-a')).not.toThrow();
    expect(store.undoMove('nope', 'socket-a')).toBe(false);
  });

  it('reports false for a socket with no move list instead of throwing', () => {
    const store = new RoomStore();
    const roomId = store.create('socket-a', 'Alice');

    expect(() => store.undoMove(roomId, 'ghost-socket')).not.toThrow();
    expect(store.undoMove(roomId, 'ghost-socket')).toBe(false);
  });
});

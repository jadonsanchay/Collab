import { randomBytes } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COLORS_ARRAY } from '@/common/constants/colors';
import { ROOM_ID_LENGTH, roomIdSchema } from '@/common/schemas/user';

import { makeMove } from '../testing/fixtures';
import { MAX_ROOM_USERS, RoomStore, type RoomStoreOptions } from './RoomStore';

// Only `randomBytes` is replaced, and only so the collision retry below can be
// driven deliberately. Every other test uses the real generator.
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();

  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

// `randomBytes` is overloaded, and `vi.mocked` picks the callback overload
// that returns void, so the synchronous one is selected explicitly here.
const randomBytesMock = vi.mocked(randomBytes as (size: number) => Buffer);

/** Ids are uuids in production; any distinct strings do here. */
const ALICE = 'user-alice';
const BOB = 'user-bob';

/** One connection per user is all these tests need. */
const socketFor = (userId: string) => `socket-${userId}`;

const stores: RoomStore[] = [];

/** Every store starts a sweeper, so every store has to be stopped. */
const makeStore = (options: Partial<RoomStoreOptions> = {}) => {
  const store = new RoomStore(options);
  stores.push(store);

  return store;
};

afterEach(() => {
  stores.splice(0).forEach((store) => store.stop());

  // Vitest resets to the implementation `vi.fn` was created with, which is the
  // real `randomBytes`.
  randomBytesMock.mockReset();
  vi.restoreAllMocks();
});

describe('RoomStore.create', () => {
  it('registers the room with the creator as its only user', () => {
    const store = makeStore();

    const { roomId, user } = store.create(ALICE, 'Alice', socketFor(ALICE));
    const room = store.get(roomId);

    expect(store.has(roomId)).toBe(true);
    expect(room?.users.get(ALICE)).toEqual({
      userId: ALICE,
      name: 'Alice',
      color: COLORS_ARRAY[0],
      socketId: socketFor(ALICE),
      disconnectedAt: null,
      finalizeTimer: null,
    });
    expect(user.color).toBe(COLORS_ARRAY[0]);
    expect(room?.usersMoves.get(ALICE)).toEqual([]);
    expect(room?.drawed).toEqual([]);
    expect(room?.seq).toBe(0);
  });

  it('generates an 8-character base64url id', () => {
    const store = makeStore();

    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    expect(roomId).toHaveLength(ROOM_ID_LENGTH);
    expect(roomId).toMatch(/^[A-Za-z0-9_-]{8}$/);
    // The id has to satisfy the schema the server validates incoming ids
    // against, or a room would be unjoinable the moment it is created.
    expect(roomIdSchema.safeParse(roomId).success).toBe(true);
  });

  it('generates distinct ids', () => {
    const store = makeStore();

    const ids = new Set(
      Array.from({ length: 500 }, (_, i) => store.create(`user-${i}`, 'User', socketFor(`user-${i}`)).roomId),
    );

    expect(ids.size).toBe(500);
  });

  it('retries when the generated id collides with an existing room', () => {
    const store = makeStore();
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

    const first = store.create(ALICE, 'Alice', socketFor(ALICE)).roomId;
    const second = store.create(BOB, 'Bob', socketFor(BOB)).roomId;

    expect(second).not.toBe(first);
    expect(store.has(first)).toBe(true);
    expect(store.has(second)).toBe(true);
  });
});

describe('RoomStore.join', () => {
  it('adds the user and initializes their move list', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    const joined = store.join(roomId, BOB, 'Bob', socketFor(BOB));

    expect(joined?.name).toBe('Bob');
    expect(store.get(roomId)?.users.get(BOB)?.name).toBe('Bob');
    expect(store.get(roomId)?.usersMoves.get(BOB)).toEqual([]);
  });

  it('gives each user a different colour', () => {
    const store = makeStore();
    const { roomId, user: owner } = store.create(ALICE, 'Alice', socketFor(ALICE));

    const others = Array.from({ length: 5 }, (_, i) =>
      store.join(roomId, `user-${i}`, `User ${i}`, socketFor(`user-${i}`)),
    );

    const colors = [owner.color, ...others.map((user) => user?.color)];

    // This is the whole point of moving colour assignment to the server: two
    // clients cannot disagree about who is which colour if only one party
    // decides.
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('falls back to round robin once the palette runs out', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    // Fill past the palette but within the user cap.
    const assigned = Array.from({ length: MAX_ROOM_USERS - 1 }, (_, i) =>
      store.join(roomId, `user-${i}`, `User ${i}`, socketFor(`user-${i}`)),
    );

    expect(assigned.every((user) => user !== null)).toBe(true);
    expect(
      assigned.every((user) => COLORS_ARRAY.includes(user?.color as string)),
    ).toBe(true);
  });

  it('keeps the original colour when the same user rejoins', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    const first = store.join(roomId, BOB, 'Bob', socketFor(BOB));

    const again = store.join(roomId, BOB, 'Bob with a new name', socketFor(BOB));

    // A reconnect must not change how someone looks to everyone else.
    expect(again?.color).toBe(first?.color);
    expect(again?.name).toBe('Bob with a new name');
    expect(store.get(roomId)?.users.size).toBe(2);
  });

  it('refuses a room that does not exist', () => {
    const store = makeStore();

    expect(store.join('nope', BOB, 'Bob', socketFor(BOB))).toBeNull();
  });

  it(`refuses a room already holding ${MAX_ROOM_USERS} users`, () => {
    const store = makeStore();
    const { roomId } = store.create('user-0', 'User 0', socketFor('user-0'));

    // The creator counts as the first user, so the cap is hit after 11 joins.
    for (let i = 1; i < MAX_ROOM_USERS; i += 1) {
      expect(store.join(roomId, `user-${i}`, `User ${i}`, socketFor(`user-${i}`))).not.toBeNull();
    }

    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS);
    expect(store.join(roomId, 'one-too-many', 'Nope', socketFor('one-too-many'))).toBeNull();
    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS);
  });
});

describe('RoomStore.leave', () => {
  it("folds the departing user's moves into drawed so the drawing survives", () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    const added = store.addMove(roomId, ALICE, makeMove());

    expect(store.leave(roomId, ALICE)).toBe(true);
    expect(store.get(roomId)?.drawed).toEqual([
      added.status === 'stored' ? added.move : null,
    ]);
    expect(store.get(roomId)?.users.has(ALICE)).toBe(false);
  });

  it('removes the usersMoves entry so snapshots do not replay the moves twice', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    store.addMove(roomId, ALICE, makeMove());

    store.leave(roomId, ALICE);

    // The moves live in `drawed` now and nowhere else. A snapshot sends both
    // halves, so an entry left here would render the strokes a second time.
    expect(store.get(roomId)?.usersMoves.has(ALICE)).toBe(false);
    expect(store.get(roomId)?.drawed).toHaveLength(1);
  });

  it('reports false for an unknown room', () => {
    const store = makeStore();

    expect(store.leave('nope', ALICE)).toBe(false);
  });
});

describe('RoomStore.addMove', () => {
  it('stamps each move with an increasing seq', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    const first = store.addMove(roomId, ALICE, makeMove());
    const second = store.addMove(roomId, BOB, makeMove());

    expect(first.status === 'stored' && first.move.seq).toBe(1);
    // Sequence is per room, not per user: it is what gives every client one
    // agreed order for the whole board.
    expect(second.status === 'stored' && second.move.seq).toBe(2);
    expect(store.get(roomId)?.seq).toBe(2);
  });

  it('assigns the id and timestamp itself', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    const result = store.addMove(
      roomId,
      ALICE,
      makeMove({ id: 'forged', timestamp: 1 }),
    );

    expect(result.status).toBe('stored');
    if (result.status !== 'stored') return;

    expect(result.move.id).not.toBe('forged');
    expect(result.move.id).not.toBe('');
    expect(result.move.timestamp).toBeGreaterThan(1);
  });

  it("appends to the user's move list", () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    store.addMove(roomId, ALICE, makeMove());
    store.addMove(roomId, ALICE, makeMove());

    expect(store.get(roomId)?.usersMoves.get(ALICE)).toHaveLength(2);
  });

  it('reports a repeated clientId as a duplicate and stores it once', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    const move = makeMove();

    const first = store.addMove(roomId, ALICE, move);
    const again = store.addMove(roomId, ALICE, move);

    expect(first.status).toBe('stored');
    // This is what makes a resend safe: a client that retries because it never
    // saw the reply does not end up drawing twice.
    expect(again.status).toBe('duplicate');
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toHaveLength(1);
  });

  it('treats a different clientId as a different move', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    store.addMove(roomId, ALICE, makeMove());
    const second = store.addMove(roomId, ALICE, makeMove());

    expect(second.status).toBe('stored');
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toHaveLength(2);
  });

  it('reports no_room for an unknown room instead of throwing', () => {
    const store = makeStore();

    expect(() => store.addMove('nope', ALICE, makeMove())).not.toThrow();
    expect(store.addMove('nope', ALICE, makeMove()).status).toBe('no_room');
  });
});

describe('RoomStore.undoMove', () => {
  it('pops the last move', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    const first = store.addMove(roomId, ALICE, makeMove());
    store.addMove(roomId, ALICE, makeMove());

    expect(store.undoMove(roomId, ALICE)).toBe(true);
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toEqual([
      first.status === 'stored' ? first.move : null,
    ]);
  });

  it('releases the undone clientId so the move can be sent again', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    const move = makeMove();
    store.addMove(roomId, ALICE, move);

    store.undoMove(roomId, ALICE);

    // Redo sends a fresh clientId in practice, but a stale entry here would
    // keep growing the dedupe set for moves that no longer exist.
    expect(store.addMove(roomId, ALICE, move).status).toBe('stored');
  });

  it('succeeds on an empty move list, so an undo with nothing to undo still broadcasts', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    expect(store.undoMove(roomId, ALICE)).toBe(true);
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toEqual([]);
  });

  it('reports false for an unknown room instead of throwing', () => {
    const store = makeStore();

    expect(() => store.undoMove('nope', ALICE)).not.toThrow();
    expect(store.undoMove('nope', ALICE)).toBe(false);
  });

  it('reports false for a user with no move list instead of throwing', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    expect(() => store.undoMove(roomId, 'ghost')).not.toThrow();
    expect(store.undoMove(roomId, 'ghost')).toBe(false);
  });
});

describe('RoomStore grace window', () => {
  it('holds a disconnected user in place instead of removing them', () => {
    const store = makeStore({ userGraceMs: 10_000 });
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    store.addMove(roomId, ALICE, makeMove());

    expect(store.markOffline(roomId, ALICE)).toBe(true);

    // Still a member, still their colour, still their moves. A tunnel is not
    // the same as leaving.
    expect(store.get(roomId)?.users.has(ALICE)).toBe(true);
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toHaveLength(1);
    expect(store.isOffline(roomId, ALICE)).toBe(true);
  });

  it('finalizes the user once the window expires', async () => {
    const finalized: [string, string][] = [];
    const store = makeStore({
      userGraceMs: 20,
      onUserFinalized: (roomId, userId) => finalized.push([roomId, userId]),
    });
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    store.addMove(roomId, ALICE, makeMove());

    store.markOffline(roomId, ALICE);

    await new Promise((resolve) => {
      setTimeout(resolve, 60);
    });

    expect(finalized).toEqual([[roomId, ALICE]]);
    expect(store.get(roomId)?.users.has(ALICE)).toBe(false);
    // The drawing outlives the person who drew it.
    expect(store.get(roomId)?.drawed).toHaveLength(1);
  });

  it('cancels the finalize when the user comes back in time', async () => {
    const finalized: string[] = [];
    const store = makeStore({
      userGraceMs: 40,
      onUserFinalized: (_roomId, userId) => finalized.push(userId),
    });
    const { roomId, user } = store.create(ALICE, 'Alice', socketFor(ALICE));

    store.markOffline(roomId, ALICE);
    const back = store.join(roomId, ALICE, 'Alice', 'a-new-socket');

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    expect(finalized).toEqual([]);
    expect(store.isOffline(roomId, ALICE)).toBe(false);
    // Same place, same colour: this is what identity surviving a drop means.
    expect(back?.color).toBe(user.color);
  });

  it('reports false when there is nobody to mark offline', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    expect(store.markOffline(roomId, 'ghost')).toBe(false);
    expect(store.markOffline('nope', ALICE)).toBe(false);
  });
});

describe('RoomStore.deltaSince', () => {
  it('returns only what came after the given sequence number', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    store.join(roomId, BOB, 'Bob', socketFor(BOB));

    store.addMove(roomId, ALICE, makeMove()); // seq 1
    store.addMove(roomId, BOB, makeMove()); // seq 2
    store.addMove(roomId, BOB, makeMove()); // seq 3

    const delta = store.deltaSince(roomId, 1);
    const byUser = new Map(delta.usersMoves);

    // Alice's only move is at or before the watermark, so she is absent.
    expect(byUser.has(ALICE)).toBe(false);
    expect(byUser.get(BOB)?.map((move) => move.seq)).toEqual([2, 3]);
  });

  it('includes moves whose author has gone', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    store.join(roomId, BOB, 'Bob', socketFor(BOB));
    store.addMove(roomId, BOB, makeMove());

    store.leave(roomId, BOB);

    const delta = store.deltaSince(roomId, 0);

    expect(delta.usersMoves).toEqual([]);
    expect(delta.drawed).toHaveLength(1);
  });

  it('returns everything for a client that has applied nothing', () => {
    const store = makeStore();
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));
    store.addMove(roomId, ALICE, makeMove());
    store.addMove(roomId, ALICE, makeMove());

    expect(store.movesSince(roomId, 0).map((move) => move.seq)).toEqual([1, 2]);
  });

  it('is empty for an unknown room rather than throwing', () => {
    const store = makeStore();

    expect(store.movesSince('nope', 0)).toEqual([]);
    expect(store.deltaSince('nope', 0)).toEqual({ usersMoves: [], drawed: [] });
  });
});

describe('RoomStore room sweeper', () => {
  it('frees a room once it has been empty for the grace period', async () => {
    const store = makeStore({
      userGraceMs: 10,
      roomGraceMs: 30,
      sweepIntervalMs: 10,
    });
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    store.markOffline(roomId, ALICE);

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });

    // Rooms used to live until the process restarted.
    expect(store.has(roomId)).toBe(false);
  });

  it('keeps a room that still has someone in it', async () => {
    const store = makeStore({ roomGraceMs: 10, sweepIntervalMs: 10 });
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    await new Promise((resolve) => {
      setTimeout(resolve, 60);
    });

    expect(store.has(roomId)).toBe(true);
  });

  it('stops sweeping once stopped', () => {
    const store = makeStore({ sweepIntervalMs: 10 });
    const { roomId } = store.create(ALICE, 'Alice', socketFor(ALICE));

    store.stop();

    expect(store.has(roomId)).toBe(true);
  });
});

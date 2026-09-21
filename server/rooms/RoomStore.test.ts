import { randomBytes } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COLORS_ARRAY } from '@/common/constants/colors';
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

/** Ids are uuids in production; any distinct strings do here. */
const ALICE = 'user-alice';
const BOB = 'user-bob';

afterEach(() => {
  // Vitest resets to the implementation `vi.fn` was created with, which is the
  // real `randomBytes`.
  randomBytesMock.mockReset();
  vi.restoreAllMocks();
});

describe('RoomStore.create', () => {
  it('registers the room with the creator as its only user', () => {
    const store = new RoomStore();

    const { roomId, user } = store.create(ALICE, 'Alice');
    const room = store.get(roomId);

    expect(store.has(roomId)).toBe(true);
    expect(room?.users.get(ALICE)).toEqual({
      userId: ALICE,
      name: 'Alice',
      color: COLORS_ARRAY[0],
    });
    expect(user.color).toBe(COLORS_ARRAY[0]);
    expect(room?.usersMoves.get(ALICE)).toEqual([]);
    expect(room?.drawed).toEqual([]);
    expect(room?.seq).toBe(0);
  });

  it('generates an 8-character base64url id', () => {
    const store = new RoomStore();

    const { roomId } = store.create(ALICE, 'Alice');

    expect(roomId).toHaveLength(ROOM_ID_LENGTH);
    expect(roomId).toMatch(/^[A-Za-z0-9_-]{8}$/);
    // The id has to satisfy the schema the server validates incoming ids
    // against, or a room would be unjoinable the moment it is created.
    expect(roomIdSchema.safeParse(roomId).success).toBe(true);
  });

  it('generates distinct ids', () => {
    const store = new RoomStore();

    const ids = new Set(
      Array.from({ length: 500 }, (_, i) => store.create(`user-${i}`, 'User').roomId),
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

    const first = store.create(ALICE, 'Alice').roomId;
    const second = store.create(BOB, 'Bob').roomId;

    expect(second).not.toBe(first);
    expect(store.has(first)).toBe(true);
    expect(store.has(second)).toBe(true);
  });
});

describe('RoomStore.join', () => {
  it('adds the user and initializes their move list', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    const joined = store.join(roomId, BOB, 'Bob');

    expect(joined?.name).toBe('Bob');
    expect(store.get(roomId)?.users.get(BOB)?.name).toBe('Bob');
    expect(store.get(roomId)?.usersMoves.get(BOB)).toEqual([]);
  });

  it('gives each user a different colour', () => {
    const store = new RoomStore();
    const { roomId, user: owner } = store.create(ALICE, 'Alice');

    const others = Array.from({ length: 5 }, (_, i) =>
      store.join(roomId, `user-${i}`, `User ${i}`),
    );

    const colors = [owner.color, ...others.map((user) => user?.color)];

    // This is the whole point of moving colour assignment to the server: two
    // clients cannot disagree about who is which colour if only one party
    // decides.
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('falls back to round robin once the palette runs out', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    // Fill past the palette but within the user cap.
    const assigned = Array.from({ length: MAX_ROOM_USERS - 1 }, (_, i) =>
      store.join(roomId, `user-${i}`, `User ${i}`),
    );

    expect(assigned.every((user) => user !== null)).toBe(true);
    expect(
      assigned.every((user) => COLORS_ARRAY.includes(user?.color as string)),
    ).toBe(true);
  });

  it('keeps the original colour when the same user rejoins', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');
    const first = store.join(roomId, BOB, 'Bob');

    const again = store.join(roomId, BOB, 'Bob with a new name');

    // A reconnect must not change how someone looks to everyone else.
    expect(again?.color).toBe(first?.color);
    expect(again?.name).toBe('Bob with a new name');
    expect(store.get(roomId)?.users.size).toBe(2);
  });

  it('refuses a room that does not exist', () => {
    const store = new RoomStore();

    expect(store.join('nope', BOB, 'Bob')).toBeNull();
  });

  it(`refuses a room already holding ${MAX_ROOM_USERS} users`, () => {
    const store = new RoomStore();
    const { roomId } = store.create('user-0', 'User 0');

    // The creator counts as the first user, so the cap is hit after 11 joins.
    for (let i = 1; i < MAX_ROOM_USERS; i += 1) {
      expect(store.join(roomId, `user-${i}`, `User ${i}`)).not.toBeNull();
    }

    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS);
    expect(store.join(roomId, 'one-too-many', 'Nope')).toBeNull();
    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS);
  });
});

describe('RoomStore.leave', () => {
  it("folds the departing user's moves into drawed so the drawing survives", () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');
    const added = store.addMove(roomId, ALICE, makeMove());

    expect(store.leave(roomId, ALICE)).toBe(true);
    expect(store.get(roomId)?.drawed).toEqual([
      added.status === 'stored' ? added.move : null,
    ]);
    expect(store.get(roomId)?.users.has(ALICE)).toBe(false);
  });

  it('removes the usersMoves entry so snapshots do not replay the moves twice', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');
    store.addMove(roomId, ALICE, makeMove());

    store.leave(roomId, ALICE);

    // The moves live in `drawed` now and nowhere else. A snapshot sends both
    // halves, so an entry left here would render the strokes a second time.
    expect(store.get(roomId)?.usersMoves.has(ALICE)).toBe(false);
    expect(store.get(roomId)?.drawed).toHaveLength(1);
  });

  it('reports false for an unknown room', () => {
    const store = new RoomStore();

    expect(store.leave('nope', ALICE)).toBe(false);
  });
});

describe('RoomStore.addMove', () => {
  it('stamps each move with an increasing seq', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    const first = store.addMove(roomId, ALICE, makeMove());
    const second = store.addMove(roomId, BOB, makeMove());

    expect(first.status === 'stored' && first.move.seq).toBe(1);
    // Sequence is per room, not per user: it is what gives every client one
    // agreed order for the whole board.
    expect(second.status === 'stored' && second.move.seq).toBe(2);
    expect(store.get(roomId)?.seq).toBe(2);
  });

  it('assigns the id and timestamp itself', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

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
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    store.addMove(roomId, ALICE, makeMove());
    store.addMove(roomId, ALICE, makeMove());

    expect(store.get(roomId)?.usersMoves.get(ALICE)).toHaveLength(2);
  });

  it('reports a repeated clientId as a duplicate and stores it once', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');
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
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    store.addMove(roomId, ALICE, makeMove());
    const second = store.addMove(roomId, ALICE, makeMove());

    expect(second.status).toBe('stored');
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toHaveLength(2);
  });

  it('reports no_room for an unknown room instead of throwing', () => {
    const store = new RoomStore();

    expect(() => store.addMove('nope', ALICE, makeMove())).not.toThrow();
    expect(store.addMove('nope', ALICE, makeMove()).status).toBe('no_room');
  });
});

describe('RoomStore.undoMove', () => {
  it('pops the last move', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');
    const first = store.addMove(roomId, ALICE, makeMove());
    store.addMove(roomId, ALICE, makeMove());

    expect(store.undoMove(roomId, ALICE)).toBe(true);
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toEqual([
      first.status === 'stored' ? first.move : null,
    ]);
  });

  it('releases the undone clientId so the move can be sent again', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');
    const move = makeMove();
    store.addMove(roomId, ALICE, move);

    store.undoMove(roomId, ALICE);

    // Redo sends a fresh clientId in practice, but a stale entry here would
    // keep growing the dedupe set for moves that no longer exist.
    expect(store.addMove(roomId, ALICE, move).status).toBe('stored');
  });

  it('succeeds on an empty move list, so an undo with nothing to undo still broadcasts', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    expect(store.undoMove(roomId, ALICE)).toBe(true);
    expect(store.get(roomId)?.usersMoves.get(ALICE)).toEqual([]);
  });

  it('reports false for an unknown room instead of throwing', () => {
    const store = new RoomStore();

    expect(() => store.undoMove('nope', ALICE)).not.toThrow();
    expect(store.undoMove('nope', ALICE)).toBe(false);
  });

  it('reports false for a user with no move list instead of throwing', () => {
    const store = new RoomStore();
    const { roomId } = store.create(ALICE, 'Alice');

    expect(() => store.undoMove(roomId, 'ghost')).not.toThrow();
    expect(store.undoMove(roomId, 'ghost')).toBe(false);
  });
});

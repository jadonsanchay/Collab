import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage, Move } from '@/common/types/global';

import { type HydratedRoom, RoomStore } from '../rooms/RoomStore';
import { makeMove } from '../testing/fixtures';
import { BoardStore } from './BoardStore';
import type { Persistence } from './persistence';

/** Records every call; `stored` is what `loadRoom` answers with. */
const fakePersistence = (stored: Record<string, HydratedRoom> = {}) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const persistence: Persistence = {
    kind: 'fake',
    loadRoom: vi.fn(async (roomId: string) => stored[roomId] ?? null),
    createRoom: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'createRoom', args });
    }),
    appendMove: record('appendMove'),
    removeMoves: record('removeMoves'),
    renameRoom: record('renameRoom'),
    appendChat: record('appendChat'),
    flush: async () => {},
    close: async () => {},
  };

  return { persistence, calls };
};

const alice = randomUUID();
const bob = randomUUID();

describe('BoardStore without persistence', () => {
  let rooms: RoomStore;
  let boards: BoardStore;

  beforeEach(() => {
    rooms = new RoomStore({ sweepIntervalMs: 60_000 });
    boards = new BoardStore(rooms);
  });

  afterEach(() => rooms.stop());

  it('is memory-only and never finds an unknown room', async () => {
    expect(boards.persistent).toBe(false);
    expect(boards.storageKind).toBe('memory');
    expect(await boards.ensureLoaded('nowhere1')).toBe(false);
  });

  it('delegates the room lifecycle to the in-memory store', async () => {
    const { roomId } = await boards.create(alice, 'Alice', 's1', 'Sprint board');

    expect(await boards.ensureLoaded(roomId)).toBe(true);
    expect(boards.get(roomId)?.title).toBe('Sprint board');
    expect(boards.join(roomId, bob, 'Bob', 's2')).not.toBeNull();

    const stored = boards.addMove(roomId, bob, makeMove());
    expect(stored.status).toBe('stored');
    expect(boards.undoMove(roomId, bob)).toBe(true);
    expect(boards.movesSince(roomId, 0)).toEqual([]);
  });
});

describe('BoardStore with persistence', () => {
  let rooms: RoomStore;

  beforeEach(() => {
    rooms = new RoomStore({ sweepIntervalMs: 60_000 });
  });

  afterEach(() => rooms.stop());

  it('records room creation with the owner', async () => {
    const { persistence, calls } = fakePersistence();
    const boards = new BoardStore(rooms, persistence);

    const { roomId } = await boards.create(alice, 'Alice', 's1');

    expect(calls[0]).toEqual({
      method: 'createRoom',
      args: [roomId, { title: 'Untitled board', ownerId: alice, ownerName: 'Alice' }],
    });
  });

  it('records stored moves, but not duplicates', async () => {
    const { persistence, calls } = fakePersistence();
    const boards = new BoardStore(rooms, persistence);
    const { roomId } = await boards.create(alice, 'Alice', 's1');

    const payload = makeMove();
    const first = boards.addMove(roomId, alice, payload);
    boards.addMove(roomId, alice, payload);

    const appended = calls.filter((call) => call.method === 'appendMove');

    expect(appended).toHaveLength(1);
    expect((appended[0].args[1] as Move).id).toBe(first.status === 'stored' ? first.move.id : '');
  });

  it('records which move an undo removed, and nothing when there was none', async () => {
    const { persistence, calls } = fakePersistence();
    const boards = new BoardStore(rooms, persistence);
    const { roomId } = await boards.create(alice, 'Alice', 's1');

    const stored = boards.addMove(roomId, alice, makeMove());
    const id = stored.status === 'stored' ? stored.move.id : '';

    expect(boards.undoMove(roomId, alice)).toBe(true);
    expect(boards.undoMove(roomId, alice)).toBe(true);

    const removals = calls.filter((call) => call.method === 'removeMoves');

    expect(removals).toEqual([{ method: 'removeMoves', args: [roomId, [id], 'undo'] }]);
  });

  it('records bulk removals with the ids actually removed', async () => {
    const { persistence, calls } = fakePersistence();
    const boards = new BoardStore(rooms, persistence);
    const { roomId } = await boards.create(alice, 'Alice', 's1');

    const a = boards.addMove(roomId, alice, makeMove());
    const idA = a.status === 'stored' ? a.move.id : '';

    boards.removeMoves(roomId, [idA, 'missing']);
    boards.removeMoves(roomId, ['missing']);

    expect(calls.filter((call) => call.method === 'removeMoves')).toEqual([
      { method: 'removeMoves', args: [roomId, [idA], 'remove'] },
    ]);
  });

  it('records renames and chat', async () => {
    const { persistence, calls } = fakePersistence();
    const boards = new BoardStore(rooms, persistence);
    const { roomId } = await boards.create(alice, 'Alice', 's1');
    const message: ChatMessage = {
      id: 'm1',
      userId: alice,
      name: 'Alice',
      body: 'hi',
      createdAt: 1,
    };

    expect(boards.rename(roomId, '  Retro  ')).toBe(true);
    expect(boards.appendChat(roomId, message)).toBe(true);
    expect(boards.rename('nowhere1', 'x')).toBe(false);

    expect(calls.filter((call) => call.method === 'renameRoom')).toEqual([
      { method: 'renameRoom', args: [roomId, 'Retro'] },
    ]);
    expect(calls.filter((call) => call.method === 'appendChat')).toEqual([
      { method: 'appendChat', args: [roomId, message] },
    ]);
  });

  it('hydrates a cold room from the record, once, even under concurrent joins', async () => {
    const moves = [
      makeMove({ id: 'm2', seq: 2, userId: bob }),
      makeMove({ id: 'm1', seq: 1, userId: alice }),
    ];
    const { persistence } = fakePersistence({
      cold1234: { title: 'Cold board', ownerId: alice, seq: 2, moves, chat: [] },
    });
    const boards = new BoardStore(rooms, persistence);

    const [first, second] = await Promise.all([
      boards.ensureLoaded('cold1234'),
      boards.ensureLoaded('cold1234'),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(persistence.loadRoom).toHaveBeenCalledTimes(1);

    const room = boards.get('cold1234');

    expect(room?.title).toBe('Cold board');
    expect(room?.ownerId).toBe(alice);
    expect(room?.drawed.map((move) => move.id)).toEqual(['m1', 'm2']);
    expect(room?.seq).toBe(2);
    expect(room?.users.size).toBe(0);
    expect(room?.emptySince).not.toBeNull();

    // The next move continues the sequence and a replayed clientId is a duplicate.
    expect(boards.join('cold1234', bob, 'Bob', 's2')).not.toBeNull();
    const next = boards.addMove('cold1234', bob, makeMove());
    expect(next.status === 'stored' && next.move.seq).toBe(3);
    expect(boards.addMove('cold1234', bob, { ...makeMove(), clientId: moves[0].clientId }).status).toBe(
      'duplicate',
    );
  });

  it('answers false for a room the record does not know', async () => {
    const { persistence } = fakePersistence();
    const boards = new BoardStore(rooms, persistence);

    expect(await boards.ensureLoaded('unknown1')).toBe(false);
    expect(boards.has('unknown1')).toBe(false);
  });

  it('keeps a room usable when the record fails to load or save', async () => {
    const failing: Persistence = {
      kind: 'failing',
      loadRoom: async () => {
        throw new Error('db down');
      },
      createRoom: async () => {
        throw new Error('db down');
      },
      appendMove: () => {},
      removeMoves: () => {},
      renameRoom: () => {},
      appendChat: () => {},
      flush: async () => {},
      close: async () => {},
    };
    const boards = new BoardStore(rooms, failing);

    expect(await boards.ensureLoaded('cold1234')).toBe(false);

    const { roomId } = await boards.create(alice, 'Alice', 's1');

    expect(boards.has(roomId)).toBe(true);
  });
});

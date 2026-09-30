import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeMove } from '../testing/fixtures';
import { RoomStore } from './RoomStore';

/**
 * Phase 2 additions to the move model: every stored move carries its
 * author's `userId` for good, and optional server-side `meta`.
 */
describe('RoomStore moves carry their author', () => {
  let store: RoomStore;
  let roomId: string;
  const alice = randomUUID();
  const bob = randomUUID();

  beforeEach(() => {
    store = new RoomStore({ sweepIntervalMs: 60_000 });
    roomId = store.create(alice, 'Alice', 'socket-a').roomId;
    store.join(roomId, bob, 'Bob', 'socket-b');
  });

  afterEach(() => store.stop());

  it('stamps the author on every stored move', () => {
    const result = store.addMove(roomId, bob, makeMove({ userId: 'forged' }));

    expect(result.status).toBe('stored');
    if (result.status !== 'stored') return;

    expect(result.move.userId).toBe(bob);
    expect(result.move.meta).toBeUndefined();
  });

  it('attaches meta when the server supplies it', () => {
    const result = store.addMove(roomId, alice, makeMove(), {
      requestId: 'req-1',
    });

    expect(result.status).toBe('stored');
    if (result.status !== 'stored') return;

    expect(result.move.meta).toEqual({ requestId: 'req-1' });
  });

  it('keeps the author on moves that fold into drawed when they leave', () => {
    store.addMove(roomId, bob, makeMove());
    store.addMove(roomId, bob, makeMove());

    store.leave(roomId, bob);

    const room = store.get(roomId);

    expect(room?.drawed).toHaveLength(2);
    expect(room?.drawed.every((move) => move.userId === bob)).toBe(true);
    expect(room?.usersMoves.has(bob)).toBe(false);
  });

  it('returns departed users’ moves with their author from movesSince', () => {
    store.addMove(roomId, bob, makeMove());
    store.leave(roomId, bob);

    const moves = store.movesSince(roomId, 0);

    expect(moves).toHaveLength(1);
    expect(moves[0].userId).toBe(bob);
  });
});

describe('RoomStore.removeMoves', () => {
  let store: RoomStore;
  let roomId: string;
  const alice = randomUUID();
  const bob = randomUUID();

  const stored = (result: ReturnType<RoomStore['addMove']>) => {
    if (result.status !== 'stored') throw new Error(`expected stored, got ${result.status}`);

    return result.move;
  };

  beforeEach(() => {
    store = new RoomStore({ sweepIntervalMs: 60_000 });
    roomId = store.create(alice, 'Alice', 'socket-a').roomId;
    store.join(roomId, bob, 'Bob', 'socket-b');
  });

  afterEach(() => store.stop());

  it('removes moves across authors and the departed pool, and reports them', () => {
    const a1 = stored(store.addMove(roomId, alice, makeMove()));
    const a2 = stored(store.addMove(roomId, alice, makeMove()));
    const b1 = stored(store.addMove(roomId, bob, makeMove()));
    const b2 = stored(store.addMove(roomId, bob, makeMove()));
    store.leave(roomId, bob);

    const removed = store.removeMoves(roomId, [a1.id, b2.id, 'not-a-move']);

    expect(removed.map((move) => move.id).sort()).toEqual([a1.id, b2.id].sort());

    const remaining = store.movesSince(roomId, 0).map((move) => move.id);
    expect(remaining.sort()).toEqual([a2.id, b1.id].sort());
  });

  it('releases the client ids of removed moves so a resend is accepted again', () => {
    const payload = makeMove();
    const first = stored(store.addMove(roomId, alice, payload));

    expect(store.addMove(roomId, alice, payload).status).toBe('duplicate');

    store.removeMoves(roomId, [first.id]);

    expect(store.addMove(roomId, alice, payload).status).toBe('stored');
  });

  it('is a no-op for an unknown room or an empty list', () => {
    stored(store.addMove(roomId, alice, makeMove()));

    expect(store.removeMoves('nowhere1', ['x'])).toEqual([]);
    expect(store.removeMoves(roomId, [])).toEqual([]);
    expect(store.movesSince(roomId, 0)).toHaveLength(1);
  });
});

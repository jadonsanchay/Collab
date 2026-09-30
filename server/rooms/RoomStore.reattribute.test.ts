import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeMove } from '../testing/fixtures';
import { RoomStore } from './RoomStore';

describe('RoomStore.reattribute', () => {
  let store: RoomStore;
  const guest = randomUUID();
  const account = randomUUID();
  const bob = randomUUID();

  beforeEach(() => {
    store = new RoomStore({ sweepIntervalMs: 60_000 });
  });

  afterEach(() => store.stop());

  it('relabels moves, merges move lists in sequence order, and renames the member and owner', () => {
    const { roomId } = store.create(guest, 'Guest', 's1');
    store.join(roomId, bob, 'Bob', 's2');

    store.addMove(roomId, guest, makeMove()); // seq 1
    store.addMove(roomId, bob, makeMove()); // seq 2
    store.addMove(roomId, guest, makeMove()); // seq 3
    store.appendChat(roomId, { id: 'c', userId: guest, name: 'Guest', body: 'hi', createdAt: 1 });
    store.leave(roomId, bob); // bob's move folds into drawed

    store.reattribute(guest, account);

    const room = store.get(roomId);

    expect(room?.ownerId).toBe(account);
    expect(room?.users.has(guest)).toBe(false);
    expect(room?.users.get(account)?.name).toBe('Guest');
    expect(room?.usersMoves.has(guest)).toBe(false);
    expect(room?.usersMoves.get(account)?.map((move) => move.seq)).toEqual([1, 3]);
    expect(room?.usersMoves.get(account)?.every((move) => move.userId === account)).toBe(true);
    expect(room?.drawed[0].userId).toBe(bob);
    expect(room?.chat[0].userId).toBe(account);
  });

  it('keeps an existing account member and merges the guest’s moves into theirs', () => {
    const { roomId } = store.create(account, 'Alice', 's1');
    store.join(roomId, guest, 'Guest', 's2');
    store.addMove(roomId, guest, makeMove()); // seq 1
    store.addMove(roomId, account, makeMove()); // seq 2

    store.reattribute(guest, account);

    const room = store.get(roomId);

    expect(room?.users.get(account)?.name).toBe('Alice');
    expect(room?.usersMoves.get(account)?.map((move) => move.seq)).toEqual([1, 2]);
  });

  it('does nothing for the same id', () => {
    const { roomId } = store.create(guest, 'Guest', 's1');
    store.reattribute(guest, guest);

    expect(store.get(roomId)?.ownerId).toBe(guest);
  });
});

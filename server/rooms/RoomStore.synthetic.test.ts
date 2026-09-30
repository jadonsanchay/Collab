import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AI_USER_COLOR, AI_USER_ID, AI_USER_NAME } from '@/common/constants/ai';

import { MAX_ROOM_USERS, RoomStore } from './RoomStore';
import { toPublicUsers } from './types';

describe('synthetic room members', () => {
  let store: RoomStore;
  let roomId: string;
  const owner = randomUUID();

  beforeEach(() => {
    store = new RoomStore({ sweepIntervalMs: 60_000 });
    roomId = store.create(owner, 'Owner', 'socket-owner').roomId;
  });

  afterEach(() => store.stop());

  it('does not count toward the room cap', () => {
    expect(
      store.addSyntheticUser(roomId, AI_USER_ID, AI_USER_NAME, AI_USER_COLOR),
    ).not.toBeNull();

    // Owner plus eleven more fills the human cap with Sketch present.
    for (let i = 1; i < MAX_ROOM_USERS; i += 1) {
      expect(store.join(roomId, randomUUID(), `User ${i}`, `s${i}`)).not.toBeNull();
    }

    expect(store.join(roomId, randomUUID(), 'Thirteenth', 's13')).toBeNull();
    expect(store.get(roomId)?.users.size).toBe(MAX_ROOM_USERS + 1);
  });

  it('is never reported offline despite having no socket', () => {
    store.addSyntheticUser(roomId, AI_USER_ID, AI_USER_NAME, AI_USER_COLOR);

    const room = store.get(roomId);
    if (!room) throw new Error('room missing');

    const sketch = toPublicUsers(room.users).find(([id]) => id === AI_USER_ID);

    expect(sketch?.[1]).toEqual({ name: AI_USER_NAME, color: AI_USER_COLOR, offline: false });
    expect(store.markOffline(roomId, AI_USER_ID)).toBe(false);
  });

  it('returns the existing record when added twice', () => {
    const first = store.addSyntheticUser(roomId, AI_USER_ID, AI_USER_NAME, AI_USER_COLOR);
    const second = store.addSyntheticUser(roomId, AI_USER_ID, 'Other', '#000000');

    expect(second).toBe(first);
    expect(store.get(roomId)?.users.get(AI_USER_ID)?.name).toBe(AI_USER_NAME);
  });

  it('does not keep an empty room alive, and leaving later does not restart the clock', () => {
    store.addSyntheticUser(roomId, AI_USER_ID, AI_USER_NAME, AI_USER_COLOR);

    store.leave(roomId, owner);

    const room = store.get(roomId);
    const emptySince = room?.emptySince;

    expect(emptySince).not.toBeNull();

    store.leave(roomId, AI_USER_ID);

    expect(room?.emptySince).toBe(emptySince);
    expect(room?.users.size).toBe(0);
  });

  it('is null for an unknown room', () => {
    expect(store.addSyntheticUser('nowhere1', AI_USER_ID, AI_USER_NAME, AI_USER_COLOR)).toBeNull();
  });
});

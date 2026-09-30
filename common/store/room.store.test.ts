import { beforeEach, describe, expect, it } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';

import { DEFAULT_ROOM, useRoomStore } from './room.store';

describe('room store removeMoves', () => {
  beforeEach(() => {
    useRoomStore.setState({
      room: {
        ...DEFAULT_ROOM,
        id: 'room',
        myMoves: [makeMove({ id: 'm1' }), makeMove({ id: 'm2' })],
        usersMoves: new Map([
          ['bob', [makeMove({ id: 'b1' }), makeMove({ id: 'b2' })]],
        ]),
        movesWithoutUser: [makeMove({ id: 'd1' })],
      },
    });
  });

  it('drops the named moves from every list and leaves the rest', () => {
    useRoomStore.getState().removeMoves(['m2', 'b1', 'd1', 'missing']);

    const { room } = useRoomStore.getState();

    expect(room.myMoves.map((move) => move.id)).toEqual(['m1']);
    expect(room.usersMoves.get('bob')?.map((move) => move.id)).toEqual(['b2']);
    expect(room.movesWithoutUser).toEqual([]);
  });

  it('replaces references rather than mutating in place', () => {
    const before = useRoomStore.getState().room;

    useRoomStore.getState().removeMoves(['b2']);

    const after = useRoomStore.getState().room;

    expect(after).not.toBe(before);
    expect(after.usersMoves).not.toBe(before.usersMoves);
    expect(before.usersMoves.get('bob')).toHaveLength(2);
  });

  it('keeps the same state for an empty id list', () => {
    const before = useRoomStore.getState().room;

    useRoomStore.getState().removeMoves([]);

    expect(useRoomStore.getState().room).toBe(before);
  });
});

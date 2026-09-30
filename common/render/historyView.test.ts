import { describe, expect, it } from 'vitest';

import { makeMove } from '@/server/testing/fixtures';

import { maxSeq, visibleMoves } from './historyView';

const moves = [
  makeMove({ id: 'a1', seq: 1, userId: 'alice' }),
  makeMove({ id: 'b2', seq: 2, userId: 'bob' }),
  makeMove({ id: 'a3', seq: 3, userId: 'alice' }),
  makeMove({ id: 'b5', seq: 5, userId: 'bob' }),
];

describe('visibleMoves', () => {
  it('returns the same array when live with no filter', () => {
    expect(visibleMoves(moves, { cursorSeq: null, userFilter: null })).toBe(moves);
  });

  it('shows exactly the moves with seq <= cursor', () => {
    expect(visibleMoves(moves, { cursorSeq: 3, userFilter: null }).map((m) => m.id)).toEqual([
      'a1',
      'b2',
      'a3',
    ]);
    expect(visibleMoves(moves, { cursorSeq: 0, userFilter: null })).toEqual([]);
    expect(visibleMoves(moves, { cursorSeq: 4, userFilter: null })).toHaveLength(3);
  });

  it('filters by author, live or in history', () => {
    expect(
      visibleMoves(moves, { cursorSeq: null, userFilter: new Set(['bob']) }).map((m) => m.id),
    ).toEqual(['b2', 'b5']);
    expect(
      visibleMoves(moves, { cursorSeq: 2, userFilter: new Set(['bob']) }).map((m) => m.id),
    ).toEqual(['b2']);
  });

  it('reports the highest sequence number', () => {
    expect(maxSeq(moves)).toBe(5);
    expect(maxSeq([])).toBe(0);
  });
});
